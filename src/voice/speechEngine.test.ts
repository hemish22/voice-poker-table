import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSpeechEngine, type EngineStatus } from './speechEngine';

/** Stand-in for the browser's SpeechRecognition so we can script failures. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false; interimResults = false; maxAlternatives = 1; lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false; aborted = false;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started = true; queueMicrotask(() => {}); }
  stop() { this.aborted = true; }
  abort() { this.aborted = true; }
  // helpers
  begin() { this.onstart?.(); }
  fail(error: string) { this.onerror?.({ error }); }
  end() { this.onend?.(); }
}

const live = () => FakeRecognition.instances.filter((r) => !r.aborted);
const last = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!;

describe('WebSpeechEngine keeps listening', () => {
  let statuses: [EngineStatus, string | undefined][];
  let engine: WebSpeechEngine;
  const visListeners: (() => void)[] = [];
  let visible = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.instances = [];
    statuses = [];
    visListeners.length = 0;
    visible = 'visible';
    Object.assign(globalThis, {
      window: globalThis,
      SpeechRecognition: FakeRecognition,
      document: {
        get visibilityState() { return visible; },
        addEventListener: (_: string, fn: () => void) => { visListeners.push(fn); },
        removeEventListener: () => {},
      },
    });
    engine = new WebSpeechEngine('en-US');
    engine.onStatus = (s, d) => statuses.push([s, d]);
  });
  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('restarts after the browser ends the session (silence timeout)', () => {
    engine.start();
    last().begin();
    vi.advanceTimersByTime(10_000); // a healthy session, then the browser ends it
    last().end();
    vi.advanceTimersByTime(400);
    expect(FakeRecognition.instances.length).toBe(2);
    expect(live().length).toBe(1);
    expect(statuses.some(([s]) => s === 'error')).toBe(false);
  });

  it('survives many consecutive network errors instead of switching itself off', () => {
    engine.start();
    for (let i = 0; i < 10; i++) {
      last().begin();
      last().fail('network');
      last().end();
      vi.advanceTimersByTime(6000);
    }
    expect(statuses.some(([s]) => s === 'error')).toBe(false);
    expect(live().length).toBe(1);
    expect(statuses.some(([s]) => s === 'reconnecting')).toBe(true);
  });

  it('survives no-speech and aborted errors', () => {
    engine.start();
    for (const err of ['no-speech', 'aborted', 'no-speech']) {
      last().begin();
      last().fail(err);
      last().end();
      vi.advanceTimersByTime(6000);
    }
    expect(statuses.some(([s]) => s === 'error')).toBe(false);
    expect(live().length).toBe(1);
  });

  it('a one-off audio-capture glitch is retried', () => {
    engine.start();
    last().begin();
    last().fail('audio-capture');
    last().end();
    vi.advanceTimersByTime(6000);
    expect(statuses.some(([s]) => s === 'error')).toBe(false);
    expect(live().length).toBe(1);
  });

  it('blocked microphone permission is a real stop, reported once, with no retry loop', () => {
    engine.start();
    last().fail('not-allowed');
    last().end();
    vi.advanceTimersByTime(30_000);
    expect(statuses.filter(([s]) => s === 'error').length).toBe(1);
    expect(FakeRecognition.instances.length).toBe(1);
  });

  it('stop() cancels a pending restart', () => {
    engine.start();
    last().begin();
    last().end();
    engine.stop();
    vi.advanceTimersByTime(10_000);
    expect(live().length).toBe(0);
  });

  it('comes back when the tab becomes visible again', () => {
    engine.start();
    last().begin();
    visible = 'hidden';
    last().fail('aborted');
    last().end();
    vi.advanceTimersByTime(6000);
    visible = 'visible';
    visListeners.forEach((fn) => fn());
    vi.advanceTimersByTime(400);
    expect(live().length).toBe(1);
  });

  it('passes alternatives and final flag through', () => {
    const got: [string[], boolean][] = [];
    engine.onResult = (a, f) => got.push([a, f]);
    engine.start();
    last().begin();
    const alt = (t: string) => ({ transcript: t });
    last().onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 2, 0: alt(' raise to 50 '), 1: alt('rays to 50') } } });
    expect(got).toEqual([[['raise to 50', 'rays to 50'], true]]);
  });
});
