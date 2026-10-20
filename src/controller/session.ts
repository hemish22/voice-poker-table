import { act, awardPot, startHand } from '../engine/hand';
import { createTable, MAX_CHIPS } from '../engine/seats';
import type { Action, Result, TableState } from '../engine/types';
import { fail, ok } from '../engine/types';
import type { Saved, Store } from './storage';

/** Every input path (buttons, voice) goes through these intents. */
export type Intent =
  | { kind: 'act'; action: Action }
  | { kind: 'award'; pot: number; winners: string[] }
  | { kind: 'startHand'; buttonSeat?: number }
  | { kind: 'undo' };

const MAX_HISTORY = 60;

export class Session {
  state: TableState;
  private history: TableState[];
  private listeners = new Set<() => void>();
  private queued: Saved | null = null;
  private flushing = false;

  constructor(private store: Store, saved: Saved | null = null) {
    this.state = saved?.state ?? createTable();
    this.history = saved?.history ?? [];
  }

  static async open(store: Store): Promise<Session> {
    let saved: Saved | null = null;
    try {
      saved = await store.load();
    } catch {
      /* unreadable save: start fresh rather than block the table */
    }
    // Tables saved before the limit was raised still carry the old 1,000 default.
    if (saved && saved.state.settings.maxBuyIn === 1000) {
      saved = { ...saved, state: { ...saved.state, settings: { ...saved.state.settings, maxBuyIn: MAX_CHIPS } } };
    }
    return new Session(store, saved);
  }

  /** Latest-wins write queue: rapid commits never reorder or pile up. */
  private persist(): void {
    this.queued = { state: this.state, history: this.history, savedAt: Date.now() };
    if (this.flushing) return;
    this.flushing = true;
    void (async () => {
      while (this.queued) {
        const next = this.queued;
        this.queued = null;
        try {
          await this.store.save(next);
        } catch {
          /* storage failed: play continues, export still works */
        }
      }
      this.flushing = false;
    })();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private commit(next: TableState): void {
    this.history = [...this.history, this.state].slice(-MAX_HISTORY);
    this.state = next;
    this.persist();
    this.emit();
  }

  /** Check an intent against the rules without changing anything. */
  preview(intent: Intent, base: TableState = this.state): Result<TableState> {
    switch (intent.kind) {
      case 'act': {
        const who = base.hand?.toActId;
        if (!who) return fail('No one is up to act');
        return act(base, who, intent.action);
      }
      case 'award':
        return awardPot(base, intent.pot, intent.winners);
      case 'startHand':
        return startHand(base, intent.buttonSeat === undefined ? {} : { buttonSeat: intent.buttonSeat });
      case 'undo': {
        const prev = this.history[this.history.length - 1];
        return prev ? ok(prev) : fail('Nothing to undo');
      }
    }
  }

  /** Single entry point for table play. Returns an error message or null. */
  dispatch(intent: Intent): string | null {
    const r = this.preview(intent);
    if (!r.ok) return r.error;
    if (intent.kind === 'undo') this.undo();
    else this.commit(r.state);
    return null;
  }

  /** Run several intents as one undoable step (e.g. award every pot, then deal). All or nothing. */
  dispatchAll(intents: Intent[]): string | null {
    let state = this.state;
    for (const intent of intents) {
      if (intent.kind === 'undo') return 'Cannot undo inside a batch';
      const r = this.preview(intent, state);
      if (!r.ok) return r.error;
      state = r.state;
    }
    this.commit(state);
    return null;
  }

  /** Seat, buy-in and settings changes (tap-only). Returns an error message or null. */
  admin(fn: (s: TableState) => Result<TableState>): string | null {
    const r = fn(this.state);
    if (!r.ok) return r.error;
    this.commit(r.state);
    return null;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const prev = this.history[this.history.length - 1];
    if (!prev) return;
    this.history = this.history.slice(0, -1);
    this.state = prev;
    this.persist();
    this.emit();
  }

  reset(): void {
    this.history = [];
    this.state = createTable();
    this.persist();
    this.emit();
  }

  exportJson(): string {
    return JSON.stringify(this.state, null, 2);
  }

  importJson(text: string): string | null {
    try {
      const parsed = JSON.parse(text) as TableState;
      if (!parsed.settings || !Array.isArray(parsed.seats) || !parsed.players) return 'Not a table file';
      this.commit(parsed);
      return null;
    } catch {
      return 'Could not read file';
    }
  }
}
