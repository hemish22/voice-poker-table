import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup } from '../engine/testutil';
import type { TableState } from '../engine/types';
import type { Speaker } from '../voice/speaker';
import { Session } from './session';
import { MemoryStore } from './storage';
import { VoiceController } from './voice';

/** Table with A up first (heads-up button/SB), 1000 each. */
function make(state: TableState = setup([1000, 1000]), speaker: Speaker | null = null) {
  const session = new Session(new MemoryStore(), { state, history: [], savedAt: 0 });
  const voice = new VoiceController(session, null, speaker, { wakeWord: false });
  return { session, voice };
}

describe('voice confirmation flow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a command only opens a confirmation; nothing changes until "confirm"', () => {
    const { session, voice } = make();
    const before = session.state;
    voice.hear(['raise to fifty'], true);
    expect(voice.snapshot().pending?.description.text).toBe('A: RAISE TO 50');
    expect(session.state).toBe(before);
    voice.hear(['confirm'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state.hand!.streetBet).toBe(50);
    expect(session.state.players['p1']!.stack).toBe(950);
  });

  it('"cancel" discards the command', () => {
    const { session, voice } = make();
    const before = session.state;
    voice.hear(['all in'], true);
    expect(voice.snapshot().pending).not.toBeNull();
    voice.hear(['cancel'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state).toBe(before);
  });

  it('while a confirmation is open, other speech is ignored and cannot replace the command', () => {
    const { session, voice } = make();
    voice.hear(['raise to fifty'], true);
    voice.hear(['fold'], true);
    voice.hear(['raise to nine hundred'], true);
    voice.hear(['okay'], true);
    expect(voice.snapshot().pending?.intent).toEqual({ kind: 'act', action: { type: 'raise', to: 50 } });
    expect(session.state.hand!.streetBet).toBe(10);
    voice.hear(['confirm'], true);
    expect(session.state.hand!.streetBet).toBe(50);
  });

  it('tolerates a misheard confirm word via alternatives', () => {
    const { session, voice } = make();
    voice.hear(['call'], true);
    voice.hear(['conform', 'confirm'], true);
    expect(session.state.players['p1']!.stack).toBe(990);
  });

  it('auto-cancels after the timeout', () => {
    const { session, voice } = make();
    voice.hear(['fold'], true);
    vi.advanceTimersByTime(8001);
    expect(voice.snapshot().pending).toBeNull();
    expect(voice.snapshot().message).toMatch(/Timed out/);
    voice.hear(['confirm'], true);
    expect(session.state.hand!.street).toBe('preflop');
  });

  it('illegal commands never open a confirmation and say why', () => {
    const { voice } = make();
    voice.hear(['check'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(voice.snapshot().message).toMatch(/5 to call/);
    expect(voice.snapshot().messageKind).toBe('error');
    voice.hear(['raise to 12'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(voice.snapshot().message).toMatch(/Minimum raise/);
  });

  it('a button tap while a confirmation is open cancels it', () => {
    const { session, voice } = make();
    voice.hear(['fold'], true);
    session.dispatch({ kind: 'act', action: { type: 'call' } });
    expect(voice.snapshot().pending).toBeNull();
    voice.hear(['confirm'], true);
    expect(session.state.hand!.toActId).toBe('p2'); // still just the call, no fold applied
  });

  it('ignores interim transcripts but shows them', () => {
    const { voice } = make();
    voice.hear(['rai'], false);
    expect(voice.snapshot().heard).toBe('rai');
    expect(voice.snapshot().pending).toBeNull();
  });

  it('ignores speech while the speaker is talking (no hearing itself)', () => {
    let busy = true;
    const speaker: Speaker = { speak: () => {}, get busy() { return busy; } };
    const { voice } = make(undefined, speaker);
    voice.hear(['fold'], true);
    expect(voice.snapshot().pending).toBeNull();
    busy = false;
    voice.hear(['fold'], true);
    expect(voice.snapshot().pending).not.toBeNull();
  });

  it('questions answer immediately with no confirmation', () => {
    const { voice } = make();
    voice.hear(["what's the pot"], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(voice.snapshot().message).toBe('The pot is 15');
  });

  it('plays a whole hand by voice including the winner', () => {
    const { session, voice } = make();
    const say = (t: string) => { voice.hear([t], true); voice.hear(['confirm'], true); };
    say('call'); say('check'); // preflop
    for (let i = 0; i < 3; i++) { say('check'); say('check'); } // flop, turn, river (BB first heads-up)
    expect(session.state.hand!.street).toBe('showdown');
    say('A wins');
    expect(session.state.hand!.street).toBe('complete');
    expect(session.state.players['p1']!.stack).toBe(1010);
    say('deal');
    expect(session.state.handNumber).toBe(2);
  });

  it('undo by voice also needs confirmation', () => {
    const { session, voice } = make();
    voice.hear(['call'], true); voice.hear(['confirm'], true);
    voice.hear(['undo'], true);
    expect(session.state.players['p1']!.stack).toBe(990);
    voice.hear(['confirm'], true);
    expect(session.state.players['p1']!.stack).toBe(995);
  });
});

describe('wake word "table"', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeWake() {
    const session = new Session(new MemoryStore(), { state: setup([1000, 1000]), history: [], savedAt: 0 });
    const voice = new VoiceController(session, null, null, { wakeWord: true });
    return { session, voice };
  }

  it('ignores table talk without the wake word', () => {
    const { voice, session } = makeWake();
    const before = session.state;
    voice.hear(['I call that a bad beat'], true);
    voice.hear(['fold'], true);
    voice.hear(['raise to fifty'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state).toBe(before);
  });

  it('"table raise 50" opens a confirmation in one breath', () => {
    const { voice } = makeWake();
    voice.hear(['table raise 50'], true);
    expect(voice.snapshot().pending?.description.text).toBe('A: RAISE TO 50');
  });

  it('works with hey/okay lead-ins and mis-heard wake words', () => {
    for (const phrase of ['hey table call', 'okay table call', 'Tablet, call', 'table call']) {
      const { voice } = makeWake();
      voice.hear([phrase], true);
      expect(voice.snapshot().pending?.description.text, phrase).toMatch(/CALL/);
    }
  });

  it('a bare "table" arms the next utterance; it expires after a few seconds', () => {
    const { voice } = makeWake();
    voice.hear(['table'], true);
    expect(voice.snapshot().armed).toBe(true);
    voice.hear(['raise to sixty'], true);
    expect(voice.snapshot().pending?.description.text).toBe('A: RAISE TO 60');
    voice.hear(['cancel'], true);

    voice.hear(['table'], true);
    vi.advanceTimersByTime(6500);
    expect(voice.snapshot().armed).toBe(false);
    voice.hear(['fold'], true);
    expect(voice.snapshot().pending).toBeNull();
  });

  it('armed window is single-use', () => {
    const { voice } = makeWake();
    voice.hear(['table'], true);
    voice.hear(['call'], true);
    voice.hear(['cancel'], true);
    voice.hear(['fold'], true);
    expect(voice.snapshot().pending).toBeNull();
  });

  it('confirm and cancel work with or without "table"', () => {
    const a = makeWake();
    a.voice.hear(['table call'], true);
    a.voice.hear(['confirm'], true);
    expect(a.session.state.players['p1']!.stack).toBe(990);

    const b = makeWake();
    b.voice.hear(['table call'], true);
    b.voice.hear(['table confirm'], true);
    expect(b.session.state.players['p1']!.stack).toBe(990);

    const c = makeWake();
    c.voice.hear(['table call'], true);
    c.voice.hear(['table cancel'], true);
    expect(c.voice.snapshot().pending).toBeNull();
    expect(c.session.state.players['p1']!.stack).toBe(995);
  });

  it('a stray command heard while a confirmation is open still cannot replace it', () => {
    const { voice } = makeWake();
    voice.hear(['table raise to fifty'], true);
    voice.hear(['table fold'], true);
    expect(voice.snapshot().pending?.description.text).toBe('A: RAISE TO 50');
  });

  it('questions and winners also need the wake word', () => {
    const { voice } = makeWake();
    voice.hear(["what's the pot"], true);
    expect(voice.snapshot().message).toBe('');
    voice.hear(["table what's the pot"], true);
    expect(voice.snapshot().message).toBe('The pot is 15');
  });

  it('can be switched off for open mic', () => {
    const { voice } = makeWake();
    voice.setWakeWord(false);
    voice.hear(['fold'], true);
    expect(voice.snapshot().pending).not.toBeNull();
  });
});

describe('yes / no confirmation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('"yes" runs the command, "no" drops it', () => {
    const a = make();
    a.voice.hear(['raise to fifty'], true);
    a.voice.hear(['yes'], true);
    expect(a.session.state.hand!.streetBet).toBe(50);

    const b = make();
    b.voice.hear(['raise to fifty'], true);
    b.voice.hear(['no'], true);
    expect(b.voice.snapshot().pending).toBeNull();
    expect(b.session.state.hand!.streetBet).toBe(10);
  });

  it('works with the wake word and with mishearings', () => {
    const session = new Session(new MemoryStore(), { state: setup([1000, 1000]), history: [], savedAt: 0 });
    const voice = new VoiceController(session, null, null, { wakeWord: true });
    voice.hear(['table call'], true);
    voice.hear(['table yes'], true);
    expect(session.state.players['p1']!.stack).toBe(990);
    voice.hear(['table fold'], true);
    voice.hear(['know', 'no'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state.hand!.street).toBe('preflop');
  });

  it('other speech while the question is open is ignored and prompts for yes or no', () => {
    const { voice } = make();
    voice.hear(['call'], true);
    voice.hear(['hello everyone'], true);
    expect(voice.snapshot().pending).not.toBeNull();
    expect(voice.snapshot().message).toBe('Say "yes" or "no"');
  });
});

describe('engines that resend earlier words', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const withWake = () => {
    const session = new Session(new MemoryStore(), { state: setup([1000, 1000]), history: [], savedAt: 0 });
    return { session, voice: new VoiceController(session, null, null, { wakeWord: true }) };
  };

  it('"table call 50" followed by "table call 50 yes" confirms on the first yes', () => {
    const { session, voice } = withWake();
    voice.hear(['table raise to fifty'], true);
    expect(voice.snapshot().pending).not.toBeNull();
    vi.advanceTimersByTime(2000);
    voice.hear(['table raise to fifty yes'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state.hand!.streetBet).toBe(50);
  });

  it('same for no', () => {
    const { session, voice } = withWake();
    voice.hear(['table raise to fifty'], true);
    voice.hear(['table raise to fifty no'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state.hand!.streetBet).toBe(10);
  });

  it('a command after the answer is not polluted by the old words', () => {
    const { voice } = withWake();
    voice.hear(['table call'], true);
    voice.hear(['table call yes'], true);
    voice.hear(['table call yes table check'], true);
    expect(voice.snapshot().pending?.description.text).toMatch(/CHECK|check/i);
  });

  it('a re-delivered identical transcript is ignored, a deliberate repeat later is not', () => {
    const { voice } = withWake();
    voice.hear(['table call'], true);
    voice.hear(['table call'], true); // instant duplicate: no second prompt, no error
    expect(voice.snapshot().pending).not.toBeNull();
    voice.hear(['no'], true);
    vi.advanceTimersByTime(3000);
    voice.hear(['table call'], true); // the person says it again
    expect(voice.snapshot().pending).not.toBeNull();
  });

  it('plain separate utterances still work', () => {
    const { session, voice } = withWake();
    voice.hear(['table call'], true);
    voice.hear(['yes'], true);
    expect(session.state.players['p1']!.stack).toBe(990);
  });
});

describe('answering while the app is still speaking', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a plain "yes" or "no" cuts in; "confirm" (our own prompt) and other words do not', () => {
    const busy = { value: false };
    const speaker: Speaker = { speak: () => { busy.value = true; }, get busy() { return busy.value; } };
    const session = new Session(new MemoryStore(), { state: setup([1000, 1000]), history: [], savedAt: 0 });
    const voice = new VoiceController(session, null, speaker, { wakeWord: false });
    voice.hear(['call'], true); // starts "…Confirm?" and marks the speaker busy
    expect(busy.value).toBe(true);
    voice.hear(['confirm'], true); // could be our own voice: ignored
    voice.hear(['hello'], true);
    expect(voice.snapshot().pending).not.toBeNull();
    voice.hear(['yes'], true);
    expect(voice.snapshot().pending).toBeNull();
    expect(session.state.players['p1']!.stack).toBe(990);
  });

  it('a "yes" while speaking does nothing when no question is open', () => {
    const speaker: Speaker = { speak: () => {}, get busy() { return true; } };
    const session = new Session(new MemoryStore(), { state: setup([1000, 1000]), history: [], savedAt: 0 });
    const voice = new VoiceController(session, null, speaker, { wakeWord: false });
    const before = session.state;
    voice.hear(['yes'], true);
    expect(session.state).toBe(before);
  });
});
