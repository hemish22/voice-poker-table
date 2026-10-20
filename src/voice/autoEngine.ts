import type { EngineStatus, SpeechEngine } from './speechEngine';

export type EngineMode = 'auto' | 'online' | 'offline';

/**
 * Picks the speech engine. Automatic mode prefers the browser's own recognizer, but goes offline
 * for Brave (which blocks Google's speech service) and whenever the online engine can't connect.
 */
export class AutoEngine implements SpeechEngine {
  onResult: SpeechEngine['onResult'] = null;
  onStatus: SpeechEngine['onStatus'] = null;

  private active: SpeechEngine | null = null;
  private wanted = false;
  private lang = 'en-US';
  private vocab: string[] | null = null;
  private brave: Promise<boolean>;

  constructor(
    private online: SpeechEngine | null,
    private offline: SpeechEngine | null,
    private mode: EngineMode,
    /** Told when automatic mode gives up on the online engine, so the choice can be remembered. */
    private onFallback?: () => void,
  ) {
    this.brave = (navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }).brave?.isBrave?.() ?? Promise.resolve(false);
    for (const e of [online, offline]) {
      if (!e) continue;
      e.onResult = (a, f) => {
        if (e === this.active) this.onResult?.(a, f);
      };
      e.onStatus = (s, d) => this.fromEngine(e, s, d);
    }
  }

  get label(): string | undefined {
    return this.active?.label;
  }

  setMode(mode: EngineMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.wanted) {
      this.stop();
      this.start();
    }
  }

  setLang(lang: string): void {
    this.lang = lang;
    this.online?.setLang(lang);
  }

  setVocabulary(words: string[]): void {
    this.vocab = words;
    this.offline?.setVocabulary?.(words);
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void this.pick().then((engine) => {
      if (!this.wanted) return;
      if (!engine) return this.onStatus?.('error', 'Voice control needs a browser with microphone support');
      this.begin(engine);
    });
  }

  stop(): void {
    const was = this.wanted;
    this.wanted = false;
    const current = this.active;
    this.active = null;
    current?.stop();
    if (was) this.onStatus?.('stopped');
  }

  private async pick(): Promise<SpeechEngine | null> {
    if (this.mode === 'offline') return this.offline ?? this.online;
    if (this.mode === 'online') return this.online ?? this.offline;
    if (!this.online) return this.offline;
    if (this.offline && (await this.brave)) return this.offline;
    return this.online;
  }

  private begin(engine: SpeechEngine): void {
    this.active = engine;
    if (engine === this.online) engine.setLang(this.lang);
    if (this.vocab) engine.setVocabulary?.(this.vocab);
    engine.start();
  }

  private fromEngine(engine: SpeechEngine, status: EngineStatus, detail?: string): void {
    if (engine !== this.active || !this.wanted) return;
    // Online engine can't reach its speech service: switch to offline instead of retrying forever.
    if (this.mode === 'auto' && engine === this.online && this.offline && (status === 'reconnecting' || (status === 'error' && /unreachable|network/i.test(detail ?? '')))) {
      this.active = null;
      engine.stop();
      this.mode = 'offline';
      this.onFallback?.();
      this.begin(this.offline);
      return;
    }
    this.onStatus?.(status, detail);
  }
}
