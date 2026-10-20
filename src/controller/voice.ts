import { describeIntent, type Description } from '../nlu/describe';
import { parseCommand, parseConfirmation, type Parsed } from '../nlu/parse';
import { splitWake } from '../nlu/wake';
import { vocabulary } from '../nlu/vocabulary';
import type { EngineMode } from '../voice/autoEngine';
import type { SpeechEngine } from '../voice/speechEngine';
import type { Speaker } from '../voice/speaker';
import type { TableState } from '../engine/types';
import type { Intent, Session } from './session';

export interface VoiceSnapshot {
  supported: boolean;
  enabled: boolean;
  listening: boolean;
  reconnecting: boolean;
  /** The offline voice model is still loading. */
  loading: boolean;
  /** Which engine is active: "browser" or "offline". */
  engineLabel: string;
  engineMode: EngineMode;
  /** The wake word was just heard: the next utterance is a command even without it. */
  armed: boolean;
  wakeWord: boolean;
  heard: string;
  message: string;
  messageKind: 'info' | 'error';
  pending: { intent: Intent; description: Description; expiresAt: number; ms: number } | null;
  speakBack: boolean;
  lang: string;
}

export interface VoiceOptions {
  /** How long a confirmation stays open before it cancels itself. */
  confirmMs?: number;
  lang?: string;
  speakBack?: boolean;
  /** Require "table" before a command. On by default so table talk can't trigger anything. */
  wakeWord?: boolean;
  engineMode?: EngineMode;
  /** Called when a preference changes so the UI layer can persist it. */
  onSettingsChange?: (s: { lang: string; speakBack: boolean; wakeWord: boolean; engine: EngineMode }) => void;
  /** Called when the person turns the mic on or off (not when it drops by itself). */
  onMicChoice?: (on: boolean) => void;
}

/** A transcript that restarts with the previous one is the same speech plus new words (engines can do this). */
const REPEAT_WINDOW_MS = 30_000;
/** An identical transcript this soon after the last is a re-delivery, not the person saying it again. */
const REDELIVERY_MS = 600;

const wordsOf = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/** How long the next utterance counts as a command after a bare "table". */
const ARM_MS = 6000;

interface Pending {
  intent: Intent;
  description: Description;
  stateRef: TableState;
  timer: ReturnType<typeof setTimeout>;
  expiresAt: number;
}

/**
 * Voice flow: hear -> parse -> check the rules -> show a confirmation -> only then act.
 * While a confirmation is open, only "yes" / "no" are listened for.
 */
export class VoiceController {
  private enabled = false;
  private listening = false;
  private reconnecting = false;
  private loading = false;
  private engineMode: EngineMode;
  private vocabKey = '';
  private armedUntil = 0;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSource: { words: string[]; at: number } | null = null;
  private wakeWord: boolean;
  private heard = '';
  private message = '';
  private messageKind: 'info' | 'error' = 'info';
  private pending: Pending | null = null;
  private lang: string;
  private speakBack: boolean;
  private confirmMs: number;
  private listeners = new Set<() => void>();
  private snap: VoiceSnapshot;

  constructor(
    private session: Session,
    private engine: SpeechEngine | null,
    private speaker: Speaker | null,
    private opts: VoiceOptions = {},
  ) {
    this.lang = opts.lang ?? 'en-US';
    this.speakBack = opts.speakBack ?? true;
    this.confirmMs = opts.confirmMs ?? 8000;
    this.wakeWord = opts.wakeWord ?? true;
    this.engineMode = opts.engineMode ?? 'auto';
    this.snap = this.build();
    if (engine) {
      engine.onResult = (alts, isFinal) => this.hear(alts, isFinal);
      engine.onStatus = (status, detail) => {
        this.listening = status === 'listening';
        this.reconnecting = status === 'reconnecting';
        this.loading = status === 'loading';
        if (status === 'loading') {
          this.message = detail ?? 'Loading voice…';
          this.messageKind = 'info';
        }
        if (status === 'listening') this.message = this.messageKind === 'error' ? '' : this.message;
        if (status === 'reconnecting') {
          this.message = detail ?? 'Reconnecting…';
          this.messageKind = 'info';
        }
        if (status === 'error') {
          this.enabled = false;
          this.say(detail ?? 'Microphone error', 'error');
        } else this.emit();
      };
    }
    this.syncVocabulary();
    // Any change to the table (button tap, undo) invalidates an open confirmation.
    session.subscribe(() => {
      this.syncVocabulary();
      if (this.pending && this.session.state !== this.pending.stateRef) {
        this.clearPending();
        this.say('Table changed, command cancelled', 'info');
      }
    });
  }

  get supported(): boolean {
    return this.engine !== null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): VoiceSnapshot {
    return this.snap;
  }

  private build(): VoiceSnapshot {
    const p = this.pending;
    return {
      supported: this.supported,
      enabled: this.enabled,
      listening: this.listening,
      reconnecting: this.reconnecting,
      loading: this.loading,
      engineLabel: this.engine?.label ?? '',
      engineMode: this.engineMode,
      armed: Date.now() < this.armedUntil,
      wakeWord: this.wakeWord,
      heard: this.heard,
      message: this.message,
      messageKind: this.messageKind,
      pending: p ? { intent: p.intent, description: p.description, expiresAt: p.expiresAt, ms: this.confirmMs } : null,
      speakBack: this.speakBack,
      lang: this.lang,
    };
  }

  private emit(): void {
    this.snap = this.build();
    this.listeners.forEach((fn) => fn());
  }

  private say(text: string, kind: 'info' | 'error', speak = false): void {
    this.message = text;
    this.messageKind = kind;
    if (speak && this.speakBack) this.speaker?.speak(text);
    this.emit();
  }

  /** The person pressed the mic button: remember the choice so it survives a refresh. */
  toggle(): void {
    if (this.enabled) this.disable();
    else this.enable();
    this.opts.onMicChoice?.(this.enabled);
  }

  enable(): void {
    if (!this.engine) return this.say('Voice control needs Chrome, Edge or Safari', 'error');
    this.enabled = true;
    this.message = '';
    this.engine.start();
    this.emit();
  }

  disable(): void {
    this.enabled = false;
    this.listening = false;
    this.reconnecting = false;
    this.loading = false;
    this.disarm();
    this.clearPending();
    this.engine?.stop();
    this.message = '';
    this.emit();
  }

  setLang(lang: string): void {
    this.lang = lang;
    this.engine?.setLang(lang);
    this.opts.onSettingsChange?.({ lang, speakBack: this.speakBack, wakeWord: this.wakeWord, engine: this.engineMode });
    this.emit();
  }

  setSpeakBack(on: boolean): void {
    this.speakBack = on;
    this.opts.onSettingsChange?.({ lang: this.lang, speakBack: on, wakeWord: this.wakeWord, engine: this.engineMode });
    this.emit();
  }

  setWakeWord(on: boolean): void {
    this.wakeWord = on;
    this.disarm();
    this.opts.onSettingsChange?.({ lang: this.lang, speakBack: this.speakBack, wakeWord: on, engine: this.engineMode });
    this.emit();
  }

  setEngineMode(mode: EngineMode): void {
    this.engineMode = mode;
    (this.engine as { setMode?: (m: EngineMode) => void } | null)?.setMode?.(mode);
    this.opts.onSettingsChange?.({ lang: this.lang, speakBack: this.speakBack, wakeWord: this.wakeWord, engine: mode });
    this.emit();
  }

  /** Offline recognition only hears words it's told to expect, so keep player names current. */
  private syncVocabulary(): void {
    if (!this.engine?.setVocabulary) return;
    const words = vocabulary(Object.values(this.session.state.players));
    const key = words.join(' ');
    if (key === this.vocabKey) return;
    this.vocabKey = key;
    this.engine.setVocabulary(words);
  }

  private disarm(): void {
    this.armedUntil = 0;
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /** Feed one utterance (alternatives best-first). Public so tests and a keyboard fallback can drive it. */
  hear(alternatives: string[], isFinal: boolean): void {
    const first = alternatives[0] ?? '';
    this.heard = first;
    if (!isFinal) return this.emit();
    // Our own voice is playing. Only a plain yes/no may cut in (our prompt never contains one);
    // everything else is dropped without being remembered as handled.
    if (this.speaker?.busy) {
      const answer = this.pending ? alternatives.map((a) => parseConfirmation(splitWake(a).rest, true) ?? parseConfirmation(a, true)).find(Boolean) : null;
      if (answer === 'confirm') return this.confirm();
      if (answer === 'cancel') return this.cancel();
      return this.emit();
    }

    // Keep only the new words when the engine re-sends what we already handled: "table call 50" + "yes".
    const now = Date.now();
    const prev = this.lastSource;
    this.lastSource = { words: wordsOf(first), at: now };
    const fresh = alternatives
      .map((alt) => {
        const w = wordsOf(alt);
        if (!prev || now - prev.at > REPEAT_WINDOW_MS) return alt;
        if (w.length === prev.words.length && w.every((x, i) => x === prev.words[i])) return now - prev.at < REDELIVERY_MS ? null : alt;
        if (w.length > prev.words.length && prev.words.every((x, i) => w[i] === x)) return w.slice(prev.words.length).join(' ');
        return alt;
      })
      .filter((alt): alt is string => alt !== null);
    if (fresh.length === 0) return this.emit();
    this.heard = fresh[0]!;

    const split = fresh.map((alt) => ({ alt, ...splitWake(alt) }));

    // An open confirmation takes only yes / no, with or without "table" in front.
    if (this.pending) {
      for (const s of split) {
        const c = parseConfirmation(s.woke ? s.rest : s.alt);
        if (c === 'confirm') return this.confirm();
        if (c === 'cancel') return this.cancel();
      }
      return this.say('Say "yes" or "no"', 'info');
    }

    const armed = Date.now() < this.armedUntil;
    const open = !this.wakeWord || armed;
    // Words without the wake word are table talk: ignore them.
    const texts = split
      .map((s) => (s.woke ? s.rest : open ? s.alt : null))
      .filter((x): x is string => x !== null && x.trim() !== '');
    if (texts.length === 0) {
      if (split.some((s) => s.woke)) return this.arm();
      return this.emit();
    }
    this.disarm();

    const state = this.session.state;
    const parsed = texts.map((text) => parseCommand(text, state));
    const best: Parsed =
      parsed.find((p) => p.kind === 'intent') ?? parsed.find((p) => p.kind === 'query') ?? parsed.find((p) => p.kind === 'reject') ?? { kind: 'none' };

    switch (best.kind) {
      case 'none':
        return this.say(`Heard "${texts[0]}": no command`, 'info');
      case 'query':
        return this.say(best.answer, 'info', true);
      case 'reject':
        return this.say(best.reason, 'error', true);
      case 'intent': {
        const r = this.session.preview(best.intent);
        if (!r.ok) return this.say(r.error, 'error', true);
        const description = describeIntent(best.intent, state);
        const expiresAt = Date.now() + this.confirmMs;
        this.pending = {
          intent: best.intent,
          description,
          stateRef: state,
          expiresAt,
          timer: setTimeout(() => {
            this.clearPending();
            this.say('Timed out: command cancelled', 'info');
          }, this.confirmMs),
        };
        this.message = '';
        if (this.speakBack) this.speaker?.speak(`${description.speech}. Confirm?`);
        return this.emit();
      }
    }
  }

  /** Heard just "table": treat the next utterance as the command. */
  private arm(): void {
    this.armedUntil = Date.now() + ARM_MS;
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = setTimeout(() => {
      this.armedUntil = 0;
      this.armTimer = null;
      this.emit();
    }, ARM_MS);
    this.say('Yes? Say your command', 'info');
  }

  confirm(): void {
    const p = this.pending;
    if (!p) return;
    this.clearPending();
    const err = this.session.dispatch(p.intent);
    if (err) return this.say(err, 'error', true);
    this.say(`Done: ${p.description.text}`, 'info', false);
    if (this.speakBack) this.speaker?.speak(`${p.description.speech}. ${this.nextPrompt(this.session.state)}`.trim());
  }

  cancel(): void {
    if (!this.pending) return;
    this.clearPending();
    this.say('Cancelled', 'info');
  }

  private nextPrompt(s: TableState): string {
    const h = s.hand;
    if (!h) return '';
    if (h.toActId) return `${s.players[h.toActId]?.name} to act`;
    if (h.street === 'showdown') return 'Showdown. Name the winner';
    if (h.street === 'complete') return 'Hand over';
    return '';
  }
}
