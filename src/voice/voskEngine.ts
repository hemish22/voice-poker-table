import { createModel, type KaldiRecognizer, type Model } from 'vosk-browser';
import { vocabulary } from '../nlu/vocabulary';
import type { EngineStatus, SpeechEngine } from './speechEngine';

const MODEL_URL = '/models/vosk-model-small-en-us-0.15.tar.gz';

/**
 * Offline recognition: a small English model runs in a web worker, restricted to the
 * poker vocabulary, so it needs no internet and works in browsers without cloud speech (Brave, Firefox).
 */
export class VoskEngine implements SpeechEngine {
  readonly label = 'offline';
  onResult: SpeechEngine['onResult'] = null;
  onStatus: SpeechEngine['onStatus'] = null;

  private modelPromise: Promise<Model> | null = null;
  private wanted = false;
  private vocab: string[] = vocabulary([]);
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rec: KaldiRecognizer | null = null;
  private model: Model | null = null;
  private run = 0;
  /** Restrict decoding to the poker vocabulary. Off = free decoding, parsed by the same NLU. */
  private useGrammar = true;

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof Worker !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof WebAssembly === 'object';
  }

  setLang(): void {
    /* the bundled model is English only */
  }

  /** Switch between vocabulary-restricted and free decoding. */
  setGrammar(on: boolean): void {
    this.useGrammar = on;
    if (this.wanted && this.model && this.ctx) this.makeRecognizer(this.model, this.ctx);
  }

  setVocabulary(words: string[]): void {
    const next = [...new Set(words)];
    if (next.length === this.vocab.length && next.every((w) => this.vocab.includes(w))) return;
    this.vocab = next;
    if (this.wanted && this.model && this.ctx) this.makeRecognizer(this.model, this.ctx);
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    const run = ++this.run;
    void this.boot(run).catch((err: unknown) => {
      if (run !== this.run) return;
      this.wanted = false;
      this.teardownAudio();
      this.emit('error', err instanceof Error ? err.message : 'Offline voice failed to start');
    });
  }

  stop(): void {
    const was = this.wanted;
    this.wanted = false;
    this.run += 1;
    this.teardownAudio();
    if (was) this.emit('stopped');
  }

  private emit(status: EngineStatus, detail?: string): void {
    this.onStatus?.(status, detail);
  }

  private loadModel(): Promise<Model> {
    this.modelPromise ??= createModel(MODEL_URL).catch((e: unknown) => {
      this.modelPromise = null; // allow a retry on the next start
      throw new Error(`Could not load the offline voice model (${e instanceof Error ? e.message : 'unknown error'})`);
    });
    return this.modelPromise;
  }

  private async boot(run: number): Promise<void> {
    this.emit('loading', this.model ? 'Starting offline voice…' : 'Loading offline voice (first time only, about 40 MB)…');
    const model = await this.loadModel();
    this.model = model;
    if (run !== this.run) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      throw new Error(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access was blocked. Allow it in the browser address bar, then tap Mic.'
          : 'No working microphone found',
      );
    }
    if (run !== this.run) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.resume();
    this.source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but works in every browser we target, with no extra worker file.
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    this.makeRecognizer(model, ctx);
    this.node.onaudioprocess = (e) => {
      try {
        if ((window as unknown as { __voskDebug?: boolean }).__voskDebug) {
          const d = e.inputBuffer.getChannelData(0);
          let peak = 0;
          for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
          (window as unknown as { __peak?: number }).__peak = Math.max((window as unknown as { __peak?: number }).__peak ?? 0, peak);
        }
        this.rec?.acceptWaveform(e.inputBuffer);
      } catch {
        /* recognizer was just replaced; drop this chunk */
      }
    };
    const mute = ctx.createGain();
    mute.gain.value = 0; // the node must be connected to run, but we never want to hear the mic
    this.source.connect(this.node);
    this.node.connect(mute);
    mute.connect(ctx.destination);
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (run === this.run && this.wanted) {
        this.wanted = false;
        this.teardownAudio();
        this.emit('error', 'The microphone was disconnected');
      }
    });
    this.emit('listening');
  }

  private makeRecognizer(model: Model, ctx: AudioContext): void {
    this.rec?.remove();
    const rec = this.useGrammar
      ? new model.KaldiRecognizer(ctx.sampleRate, JSON.stringify([...this.vocab, '[unk]']))
      : new model.KaldiRecognizer(ctx.sampleRate);
    rec.on('result', (m) => {
      if (m.event !== 'result') return;
      if ((window as unknown as { __voskDebug?: boolean }).__voskDebug) console.log('vosk result', JSON.stringify(m.result.text));
      const text = clean(m.result.text);
      if (text) this.onResult?.([text], true);
    });
    rec.on('partialresult', (m) => {
      if (m.event !== 'partialresult') return;
      if ((window as unknown as { __voskDebug?: boolean }).__voskDebug) console.log('vosk partial', JSON.stringify(m.result.partial));
      const text = clean(m.result.partial);
      if (text) this.onResult?.([text], false);
    });
    this.rec = rec;
  }

  /** Test hook: push raw samples at the recognizer as if they came from the microphone. */
  feedSamples(samples: Float32Array, sampleRate: number): void {
    const target = this.ctx?.sampleRate ?? sampleRate;
    let data = samples;
    if (target !== sampleRate) {
      // Linear resample to the rate the recognizer was created with.
      const ratio = sampleRate / target;
      data = new Float32Array(Math.floor(samples.length / ratio));
      for (let i = 0; i < data.length; i++) {
        const pos = i * ratio;
        const a = samples[Math.floor(pos)] ?? 0;
        const b = samples[Math.min(samples.length - 1, Math.floor(pos) + 1)] ?? a;
        data[i] = a + (b - a) * (pos - Math.floor(pos));
      }
    }
    this.rec?.acceptWaveformFloat(data, target);
  }

  private teardownAudio(): void {
    try { this.node?.disconnect(); } catch { /* already disconnected */ }
    try { this.source?.disconnect(); } catch { /* already disconnected */ }
    if (this.node) this.node.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.rec?.remove(); } catch { /* model may be gone */ }
    void this.ctx?.close().catch(() => {});
    this.node = this.source = this.stream = this.rec = this.ctx = null;
  }
}

/** Drop the recognizer's "[unk]" placeholder for words outside the grammar. */
const clean = (text: string): string => text.replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim();
