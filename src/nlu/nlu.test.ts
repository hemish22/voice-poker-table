import { describe, expect, it } from 'vitest';
import { setup } from '../engine/testutil';
import { run } from '../engine/testutil';
import { extractAmount } from './numbers';
import { parseCommand, parseConfirmation, tokenize } from './parse';
import { awardPot } from '../engine/hand';

const amt = (s: string) => extractAmount(tokenize(s));

describe('spoken amounts', () => {
  it.each([
    ['fifty', 50], ['two hundred fifty', 250], ['two fifty', 250], ['one twenty five', 125], ['one fifteen', 115],
    ['250', 250], ['1,200', 1200], ['2k', 2000], ['two k', 2000], ['fifteen hundred', 1500],
    ['one thousand two hundred', 1200], ['two thousand', 2000], ['twenty five', 25], ['three hundred and ten', 310],
    ['2 50', 250], ['to two hundred', 200], ['seventy', 70], ['a hundred', 100], ['hundred', 100],
  ])('%s -> %i', (spoken, n) => {
    expect(amt(spoken)).toBe(n);
  });

  it('returns null with no number', () => {
    expect(amt('raise it')).toBeNull();
  });
});

describe('confirmation answers (yes / no, plus confirm / cancel)', () => {
  it.each([
    ['yes', 'confirm'], ['Yes.', 'confirm'], ['yeah', 'confirm'], ['yep', 'confirm'], ['yes please', 'confirm'], ['confirm', 'confirm'],
    ['no', 'cancel'], ['No.', 'cancel'], ['nope', 'cancel'], ['nah', 'cancel'], ['know', 'cancel'], ['no that', 'cancel'],
    ['cancel', 'cancel'], ['cancer', 'cancel'], ['council', 'cancel'],
  ])('%s', (t, want) => expect(parseConfirmation(t)).toBe(want));

  it.each(['okay', 'sure', 'raise to fifty', 'yes no', 'confirm cancel', 'i think yes this is fine', '', 'maybe', 'fold'])('ignores %j', (t) => {
    expect(parseConfirmation(t)).toBeNull();
  });
});

describe('betting commands', () => {
  // A(btn) B(SB) C(BB): preflop A is up facing 10, min raise to 20.
  const s0 = setup([1000, 1000, 1000]);
  const act = (text: string, s = s0) => parseCommand(text, s);
  const action = (text: string, s = s0) => {
    const p = act(text, s);
    return p.kind === 'intent' && p.intent.kind === 'act' ? p.intent.action : p;
  };

  it('simple actions', () => {
    expect(action('call')).toEqual({ type: 'call' });
    expect(action("I'll call")).toEqual({ type: 'call' });
    expect(action('fold')).toEqual({ type: 'fold' });
    expect(action('check')).toEqual({ type: 'check' });
    expect(action('all in')).toEqual({ type: 'allIn' });
    expect(action("I'm all-in")).toEqual({ type: 'allIn' });
  });

  it('misheard homophones', () => {
    expect(action('rays to fifty')).toEqual({ type: 'raise', to: 50 });
    expect(action('czech')).toEqual({ type: 'check' });
    expect(action('folk')).toEqual({ type: 'fold' });
    expect(action('cal')).toEqual({ type: 'call' });
  });

  it('raise to / raise N / bet N / make it N (RULES D3: bare raise = raise to)', () => {
    expect(action('raise to two fifty')).toEqual({ type: 'raise', to: 250 });
    expect(action('raise 60')).toEqual({ type: 'raise', to: 60 });
    expect(action('bet forty')).toEqual({ type: 'raise', to: 40 });
    expect(action('make it one hundred')).toEqual({ type: 'raise', to: 100 });
    expect(action('raise to 1,200.')).toEqual({ type: 'raise', to: 1200 });
  });

  it('raise by N adds to the current bet', () => {
    expect(action('raise by fifty')).toEqual({ type: 'raise', to: 60 }); // facing 10
  });

  it('min / pot / half pot shortcuts use engine numbers', () => {
    expect(action('min raise')).toEqual({ type: 'raise', to: 20 });
    expect(action('minimum raise')).toEqual({ type: 'raise', to: 20 });
    expect(action('pot')).toEqual({ type: 'raise', to: 35 }); // 10 + (pot 15 + call 10)
    expect(action('raise pot')).toEqual({ type: 'raise', to: 35 });
    expect(action('half pot')).toEqual({ type: 'raise', to: 22 }); // 10 + floor(25/2)
  });

  it('first verb wins, so "call all in" is a call', () => {
    expect(action('call all in')).toEqual({ type: 'call' });
  });

  it('a bare raise is the minimum raise', () => {
    expect(action('raise')).toEqual({ type: 'raise', to: 20 });
  });

  it('mangled short utterances: lone "in"/"all" are all-in, lone "four" is fold', () => {
    expect(action('in')).toEqual({ type: 'allIn' });
    expect(action('all')).toEqual({ type: 'allIn' });
    expect(action('up in')).toEqual({ type: 'allIn' });
    expect(action('four')).toEqual({ type: 'fold' });
    expect(action('raise to four hundred')).toEqual({ type: 'raise', to: 400 });
  });

  it('ignores chatter and non-commands', () => {
    expect(act('nice hand').kind).toBe('none');
    expect(act('').kind).toBe('none');
    expect(act('make sure you count that').kind).toBe('none');
  });

  it('unknown names are ignored, the command still parses', () => {
    expect(act('Bob call').kind).toBe('intent');
  });

  it('names: the actor passes, another player is rejected', () => {
    const p = parseCommand('B call', s0);
    expect(p.kind).toBe('reject'); // B is not up, A is
    expect(parseCommand('A call', s0).kind).toBe('intent');
  });

  it('no betting command when nobody is to act', () => {
    const idle = setup([1000, 1000]);
    const done = run(idle, ['A', 'fold']);
    expect(parseCommand('call', done).kind).toBe('none');
  });

  it('deal / undo', () => {
    const idle = run(setup([1000, 1000]), ['A', 'fold']);
    expect(parseCommand('deal', idle)).toEqual({ kind: 'intent', intent: { kind: 'startHand' } });
    expect(parseCommand('next hand', idle)).toEqual({ kind: 'intent', intent: { kind: 'startHand' } });
    expect(parseCommand('undo', s0)).toEqual({ kind: 'intent', intent: { kind: 'undo' } });
    expect(parseCommand('deal', s0).kind).toBe('reject'); // hand running
  });

  it('questions answer without changing anything', () => {
    expect(parseCommand("what's the pot", s0)).toEqual({ kind: 'query', answer: 'The pot is 15' });
    expect(parseCommand('how much to call', s0)).toEqual({ kind: 'query', answer: '10 to call' });
    expect(parseCommand("who's up", s0)).toEqual({ kind: 'query', answer: 'A is up' });
  });
});

describe('winner declarations', () => {
  // A 100, B 300, C 500 all in: main 300 (A,B,C), side 400 (B,C)
  const show = run(setup([100, 300, 500]), ['A', 'allIn'], ['B', 'allIn'], ['C', 'allIn']);

  it('names a winner for a pot (default: first open pot)', () => {
    const p = parseCommand('A wins', show);
    expect(p).toEqual({ kind: 'intent', intent: { kind: 'award', pot: 0, winners: ['p1'] } });
  });

  it('main / side pot selection', () => {
    expect(parseCommand('C wins the main pot', show)).toEqual({ kind: 'intent', intent: { kind: 'award', pot: 0, winners: ['p3'] } });
    expect(parseCommand('C wins side pot one', show)).toEqual({ kind: 'intent', intent: { kind: 'award', pot: 1, winners: ['p3'] } });
    expect(parseCommand('B wins side pot 1', show)).toEqual({ kind: 'intent', intent: { kind: 'award', pot: 1, winners: ['p2'] } });
  });

  it('split between two names', () => {
    const p = parseCommand('B and C split the main pot', show);
    expect(p).toEqual({ kind: 'intent', intent: { kind: 'award', pot: 0, winners: ['p2', 'p3'] } });
  });

  it('player not eligible for the pot is rejected', () => {
    const r = awardPot(show, 0, ['p1']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parseCommand('A wins side pot one', r.state).kind).toBe('reject');
  });

  it('rejects before showdown', () => {
    expect(parseCommand('A wins', setup([100, 100, 100])).kind).toBe('reject');
  });
});
