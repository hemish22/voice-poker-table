export type EngineStatus = 'loading' | 'listening' | 'reconnecting' | 'stopped' | 'error';

/** Anything that turns microphone audio into text. Web Speech now; an offline engine can slot in later. */
export interface SpeechEngine {
  /** Called with alternative transcripts for one utterance, best first. */
  onResult: ((alternatives: string[], isFinal: boolean) => void) | null;
  onStatus: ((status: EngineStatus, detail?: string) => void) | null;
  start(): void;
  stop(): void;
  setLang(lang: string): void;
  /** Words the recognizer should expect (engines that can restrict vocabulary use this). */
  setVocabulary?(words: string[]): void;
  /** Short name for the UI, e.g. "offline". */
  readonly label?: string;
}

interface RecognitionAlt { transcript: string }
interface RecognitionResult { isFinal: boolean; length: number; [i: number]: RecognitionAlt | undefined }
interface RecognitionEvent { resultIndex: number; results: { length: number; [i: number]: RecognitionResult | undefined } }
interface Recognition {
  continuous: boolean; interimResults: boolean; maxAlternatives: number; lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const webSpeechSupported = (): boolean => typeof window !== 'undefined' && ctor() !== undefined;

/** Permission problems won't fix themselves, so these stop the mic. Everything else is retried forever. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);
const MAX_BACKOFF_MS = 5000;
/** A session that dies sooner than this without any speech counts as a failed start. */
const HEALTHY_MS = 3000;

export class WebSpeechEngine implements SpeechEngine {
  readonly label = 'browser';
  onResult: SpeechEngine['onResult'] = null;
  onStatus: SpeechEngine['onStatus'] = null;
  private rec: Recognition | null = null;
  private alive = false;
  private wanted = false;
  private lang: string;
  private failures = 0;
  private startedAt = 0;
  private gotResult = false;
  private lastError = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private onVisible = () => {
    // Browsers kill recognition in background tabs; resume as soon as we're back.
    if (this.wanted && !this.alive && document.visibilityState === 'visible') {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.spawn(), 250);
    }
  };

  constructor(lang: string) {
    this.lang = lang;
  }

  setLang(lang: string): void {
    this.lang = lang;
    if (this.wanted) {
      this.stop();
      this.start();
    }
  }

  start(): void {
    if (!ctor()) return this.onStatus?.('error', 'Speech recognition is not supported in this browser');
    if (this.wanted) return;
    this.wanted = true;
    this.failures = 0;
    this.lastError = '';
    document.addEventListener('visibilitychange', this.onVisible);
    this.spawn();
  }

  stop(): void {
    const wasWanted = this.wanted;
    this.wanted = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.detach();
    if (wasWanted) this.onStatus?.('stopped');
  }

  private detach(): void {
    const rec = this.rec;
    this.rec = null;
    this.alive = false;
    if (!rec) return;
    rec.onend = rec.onerror = rec.onresult = rec.onstart = null;
    try { rec.abort(); } catch { /* already stopped */ }
  }

  private fatal(detail: string): void {
    this.wanted = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.detach();
    this.onStatus?.('error', detail);
  }

  private spawn(): void {
    const Ctor = ctor();
    if (!Ctor || !this.wanted) return;
    this.detach();
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.lang = this.lang;
    this.gotResult = false;
    this.alive = true;

    rec.onstart = () => {
      this.startedAt = Date.now();
      this.onStatus?.('listening');
    };
    rec.onresult = (e) => {
      this.gotResult = true;
      this.failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const alts: string[] = [];
        for (let j = 0; j < res.length; j++) {
          const a = res[j];
          if (a) alts.push(a.transcript.trim());
        }
        if (alts.length) this.onResult?.(alts, res.isFinal);
      }
    };
    rec.onerror = (e) => {
      if (FATAL.has(e.error)) {
        return this.fatal(
          e.error === 'language-not-supported' ? 'This language is not supported for voice' : 'Microphone access was blocked. Allow it in the browser address bar, then tap Mic.',
        );
      }
      if (e.error === 'audio-capture' && this.failures >= 6) return this.fatal('No working microphone found');
      this.lastError = e.error;
    };
    rec.onend = () => {
      this.alive = false;
      if (!this.wanted) return;
      const lived = Date.now() - this.startedAt;
      this.failures = this.gotResult || lived >= HEALTHY_MS ? 0 : this.failures + 1;
      if (document.visibilityState === 'hidden') return; // onVisible resumes us
      if (this.failures >= 2) {
        this.onStatus?.('reconnecting', this.lastError === 'network' ? 'Speech service unreachable, retrying…' : 'Mic interrupted, retrying…');
      }
      const delay = this.failures === 0 ? 250 : Math.min(250 * 2 ** this.failures, MAX_BACKOFF_MS);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.spawn(), delay);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      // start() throws if the old session is still winding down; try again shortly.
      this.alive = false;
      this.failures += 1;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.spawn(), Math.min(250 * 2 ** this.failures, MAX_BACKOFF_MS));
    }
  }
}
