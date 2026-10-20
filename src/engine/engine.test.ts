import { describe, expect, it } from 'vitest';
import { awardPot } from './hand';
import { legalActions } from './legal';
import { buildPots } from './pots';
import { chipTotal, id, run, setup, stackOf, toAct, tryAct } from './testutil';

describe('E1/E2 order of play', () => {
  it('heads-up: button is SB, acts first preflop, last postflop (B2)', () => {
    let s = setup([1000, 1000]);
    expect(s.hand!.sbId).toBe(id('A'));
    expect(toAct(s)).toBe('A');
    s = run(s, ['A', 'call'], ['B', 'check']);
    expect(s.hand!.street).toBe('flop');
    expect(toAct(s)).toBe('B');
    s = run(s, ['B', 'check'], ['A', 'check']);
    expect(s.hand!.street).toBe('turn');
    expect(toAct(s)).toBe('B');
  });

  it('3-handed: UTG = button preflop, SB first postflop (B1, A1, A2)', () => {
    let s = setup([1000, 1000, 1000]);
    expect(s.hand!.sbId).toBe(id('B'));
    expect(s.hand!.bbId).toBe(id('C'));
    expect(toAct(s)).toBe('A');
    s = run(s, ['A', 'call'], ['B', 'call'], ['C', 'check']);
    expect(s.hand!.street).toBe('flop');
    expect(toAct(s)).toBe('B');
  });

  it('4-handed: UTG is left of BB', () => {
    const s = setup([1000, 1000, 1000, 1000]);
    expect(s.hand!.bbId).toBe(id('C'));
    expect(toAct(s)).toBe('D');
  });
});

describe('E3/E4 minimums', () => {
  it('min raise chain follows largest increment (R1, L5)', () => {
    let s = setup([1000, 1000, 1000, 1000]);
    expect(legalActions(s)!.minTo).toBe(20);
    s = run(s, ['D', 'raise', 30]);
    expect(legalActions(s)!.minTo).toBe(50);
    expect(tryAct(s, 'A', { type: 'raise', to: 49 }).ok).toBe(false);
    s = run(s, ['A', 'raise', 50]);
    expect(legalActions(s)!.minTo).toBe(70);
  });

  it('opening bet minimum is the big blind (L4)', () => {
    let s = setup([1000, 1000]);
    s = run(s, ['A', 'call'], ['B', 'check']);
    expect(legalActions(s)!.isBet).toBe(true);
    expect(tryAct(s, 'B', { type: 'raise', to: 5 }).ok).toBe(false);
    s = run(s, ['B', 'raise', 10]);
    expect(legalActions(s)!.minTo).toBe(20);
  });
});

describe('E5-E7 short all-in and reopening (R2, R3, R5)', () => {
  // Flop, 3 players A(btn) B(SB) C(BB). Preflop everybody limps; B/C/A act on flop in order B,C,A.
  const flop = (stacks: number[]) => {
    let s = setup(stacks);
    s = run(s, ['A', 'call'], ['B', 'call'], ['C', 'check']);
    return s; // flop, B to act
  };

  it('short all-in does not reopen betting to someone who already acted', () => {
    // B bets 100; C all-in to 150 (short, +50); A calls 150; B has acted -> only call/fold
    let s = flop([1000, 1000, 160]);
    s = run(s, ['B', 'raise', 100], ['C', 'allIn']);
    expect(s.players[id('C')]!.stack).toBe(0);
    s = run(s, ['A', 'call']);
    expect(toAct(s)).toBe('B');
    const l = legalActions(s)!;
    expect(l.toCall).toBe(50);
    expect(l.canRaise).toBe(false);
    expect(l.notReopened).toBe(true);
    expect(tryAct(s, 'B', { type: 'raise', to: 400 }).ok).toBe(false);
    expect(tryAct(s, 'B', { type: 'allIn' }).ok).toBe(false);
    expect(tryAct(s, 'B', { type: 'call' }).ok).toBe(true);
  });

  it('someone who has not acted yet may still raise after a short all-in (R3)', () => {
    let s = flop([1000, 1000, 160]);
    s = run(s, ['B', 'raise', 100], ['C', 'allIn']);
    expect(legalActions(s)!.minTo).toBe(250); // 150 + 100
    expect(legalActions(s)!.canRaise).toBe(true);
  });

  it('full all-in raise reopens betting (R2, E6)', () => {
    let s = flop([1000, 1000, 310]);
    s = run(s, ['B', 'raise', 100], ['C', 'allIn'], ['A', 'call']);
    expect(toAct(s)).toBe('B');
    expect(legalActions(s)!.canRaise).toBe(true);
    expect(legalActions(s)!.minTo).toBe(500); // 300 + 200
  });

  it('A raise by someone else that is a full raise relative to your last action reopens (R5, E7)', () => {
    // B bets 100, C all-in 150 (short), A raises to 250 (+100 full), B facing 150 more -> may re-raise
    let s = flop([1000, 1000, 160]);
    s = run(s, ['B', 'raise', 100], ['C', 'allIn'], ['A', 'raise', 250]);
    expect(toAct(s)).toBe('B');
    expect(legalActions(s)!.canRaise).toBe(true);
  });

  it('cumulative short all-ins that add a full raise reopen for earlier actors (R5)', () => {
    // B bets 100. C all-in to 150, D all-in to 210 -> from B: 110 >= 100 facing a full raise
    let s = setup([1000, 1000, 160, 210], {}, 0);
    // preflop: D=UTG? seats A(btn) B(SB) C(BB) D(UTG)
    s = run(s, ['D', 'call'], ['A', 'call'], ['B', 'call'], ['C', 'check']);
    expect(s.hand!.street).toBe('flop');
    s = run(s, ['B', 'raise', 100], ['C', 'allIn'], ['D', 'allIn'], ['A', 'call']);
    expect(toAct(s)).toBe('B');
    expect(legalActions(s)!.canRaise).toBe(true);
  });
});

describe('E8-E10, E15 pots', () => {
  it('side pots with refund 100/300/500 (P1, P3, PTE)', () => {
    let s = setup([100, 300, 500]); // A btn UTG, B SB, C BB
    s = run(s, ['A', 'allIn'], ['B', 'allIn'], ['C', 'allIn']);
    const h = s.hand!;
    expect(h.street).toBe('showdown');
    expect(h.runout).toBe(true);
    expect(h.pots.map((p) => p.amount)).toEqual([300, 400]);
    expect(h.pots[0]!.eligible.sort()).toEqual([id('A'), id('B'), id('C')]);
    expect(h.pots[1]!.eligible.sort()).toEqual([id('B'), id('C')]);
    expect(h.refunds[id('C')]).toBe(200);
    expect(stackOf(s, 'C')).toBe(200);
    expect(chipTotal(s)).toBe(900);
    // E15: A wins main, C wins side + refund
    s = awardPot(s, 0, [id('A')]).ok ? (awardPot(s, 0, [id('A')]) as { state: typeof s }).state : s;
    const r = awardPot(s, 1, [id('C')]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.hand!.street).toBe('complete');
      expect(stackOf(r.state, 'A')).toBe(300);
      expect(stackOf(r.state, 'B')).toBe(0);
      expect(stackOf(r.state, 'C')).toBe(600);
      expect(chipTotal(r.state)).toBe(900);
    }
  });

  it('dead money from folded blinds stays in the pot (P2)', () => {
    const hp = (idn: string, total: number, folded = false) => ({
      id: idn, seat: 0, folded, allIn: false, streetBet: 0, total, acted: true, betAtLastAction: 0,
    });
    const pots = buildPots([hp('a', 40), hp('b', 40), hp('sb', 5, true), hp('bb', 10, true)]);
    expect(pots).toEqual([{ amount: 95, eligible: ['a', 'b'] }]);
  });

  it('uncalled heads-up bet is returned (P3, E10)', () => {
    // flop: B (stack 60 after blinds/limp) calls all-in vs A's 100
    let s = setup([1000, 70]);
    s = run(s, ['A', 'call'], ['B', 'check']); // pot 20, stacks 990 / 60
    s = run(s, ['B', 'raise', 10]);
    s = run(s, ['A', 'raise', 100]);
    s = run(s, ['B', 'call']); // B has 50 left, calls 90 -> all-in for 50 more
    expect(s.hand!.street).toBe('showdown');
    const total = s.hand!.pots.reduce((n, p) => n + p.amount, 0);
    expect(total).toBe(140); // 70 each; A put in 110
    expect(s.hand!.refunds[id('A')]).toBe(40);
  });

  it('odd chip goes to first winner left of the button (P5, E14)', () => {
    // 4 players limp, 40 pot... use 3 handed with odd: stacks lead to pot 101? simulate through splitPot
    let s = setup([1000, 1000, 1000, 1000]);
    s = run(s, ['D', 'call'], ['A', 'call'], ['B', 'call'], ['C', 'check']);
    s = run(s, ['B', 'check'], ['C', 'check'], ['D', 'check'], ['A', 'check']);
    s = run(s, ['B', 'check'], ['C', 'check'], ['D', 'check'], ['A', 'check']);
    s = run(s, ['B', 'check'], ['C', 'check'], ['D', 'check'], ['A', 'check']);
    expect(s.hand!.street).toBe('showdown');
    expect(s.hand!.pots[0]!.amount).toBe(40);
    const r = awardPot(s, 0, [id('B'), id('D'), id('A')]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 40 / 3 = 13 r1 -> B (first left of button) gets 14
      expect(stackOf(r.state, 'B') - 990).toBe(14);
      expect(stackOf(r.state, 'D') - 990).toBe(13);
      expect(stackOf(r.state, 'A') - 990).toBe(13);
    }
  });
});

describe('E11-E13 round flow', () => {
  it('BB option: limpers called, BB may raise and reopen (S2)', () => {
    let s = setup([1000, 1000, 1000]);
    s = run(s, ['A', 'call'], ['B', 'call']);
    expect(s.hand!.street).toBe('preflop');
    expect(toAct(s)).toBe('C');
    s = run(s, ['C', 'raise', 40]);
    expect(toAct(s)).toBe('A');
    expect(legalActions(s)!.canRaise).toBe(true);
  });

  it('all-in preflop, others fold: no betting later, runout (S4, E12)', () => {
    let s = setup([100, 100, 1000]);
    s = run(s, ['A', 'allIn'], ['B', 'allIn']);
    s = run(s, ['C', 'call']);
    expect(s.hand!.street).toBe('showdown'); // C is only one with chips: no one to bet against
    expect(s.hand!.runout).toBe(true);
  });

  it('everyone folds to BB: BB takes the pot, no showdown (S3, E13)', () => {
    let s = setup([1000, 1000, 1000]);
    s = run(s, ['A', 'fold'], ['B', 'fold']);
    expect(s.hand!.street).toBe('complete');
    expect(stackOf(s, 'C')).toBe(1005);
    expect(stackOf(s, 'B')).toBe(995);
    expect(chipTotal(s)).toBe(3000);
  });

  it('turn order is enforced', () => {
    const s = setup([1000, 1000, 1000]);
    const r = tryAct(s, 'B', { type: 'call' });
    expect(r.ok).toBe(false);
  });
});

describe('E17 legality', () => {
  it("can't check facing a bet, can't call with nothing owed", () => {
    let s = setup([1000, 1000]);
    expect(tryAct(s, 'A', { type: 'check' }).ok).toBe(false);
    s = run(s, ['A', 'call'], ['B', 'check']);
    expect(tryAct(s, 'B', { type: 'call' }).ok).toBe(false);
  });

  it('under-min raise rejected but all-in for less accepted (L5/L6)', () => {
    let s = setup([1000, 1000, 25]);
    s = run(s, ['A', 'raise', 100]);
    expect(tryAct(s, 'B', { type: 'raise', to: 150 }).ok).toBe(false); // min 190
    s = run(s, ['B', 'call']);
    const c = tryAct(s, 'C', { type: 'allIn' });
    expect(c.ok).toBe(true); // BB stack 15 -> calls all-in for less
    if (c.ok) expect(c.state.players[id('C')]!.stack).toBe(0);
  });
});

describe('blinds edge cases', () => {
  it('short big blind is all-in and others still owe the full BB (B4)', () => {
    const s = setup([1000, 1000, 6]);
    expect(s.hand!.players[2]!.allIn).toBe(true);
    expect(legalActions(s)!.toCall).toBe(10);
  });

  it('button moves one live seat and heads-up never gives BB twice (B3)', () => {
    let s = setup([1000, 1000, 1000]);
    s = run(s, ['A', 'fold'], ['B', 'fold']); // C wins
    // hand 2: button -> B, SB C, BB A
    const { startHand } = require_hand();
    const r2 = startHand(s);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.state.hand!.buttonSeat).toBe(1);
      expect(r2.state.hand!.bbId).toBe(id('A'));
    }
  });
});

function require_hand() {
  return { startHand: (s: ReturnType<typeof setup>) => startHandImport(s) };
}
import { startHand as startHandImport } from './hand';

describe('E18 chip conservation fuzz', () => {
  it('random legal play never creates or destroys chips', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let game = 0; game < 300; game++) {
      const n = 2 + Math.floor(rnd() * 5);
      const stacks = Array.from({ length: n }, () => 20 + Math.floor(rnd() * 400));
      const total = stacks.reduce((a, b) => a + b, 0);
      let s = setup(stacks);
      for (let hand = 0; hand < 4; hand++) {
        let guard = 0;
        while (s.hand!.street !== 'showdown' && s.hand!.street !== 'complete') {
          if (++guard > 200) throw new Error('stuck');
          const l = legalActions(s)!;
          const who = s.hand!.toActId!;
          const opts: import('./types').Action[] = [{ type: 'fold' }];
          if (l.canCheck) opts.push({ type: 'check' });
          if (l.canCall) opts.push({ type: 'call' });
          if (l.canRaise) {
            opts.push({ type: 'allIn' });
            if (l.minTo <= l.maxTo) opts.push({ type: 'raise', to: l.minTo + Math.floor(rnd() * (l.maxTo - l.minTo + 1)) });
          }
          const pick = opts[Math.floor(rnd() * opts.length)]!;
          const r = tryAct(s, s.players[who]!.name, pick);
          if (!r.ok) throw new Error(`legal action rejected: ${JSON.stringify(pick)} ${r.error}`);
          s = r.state;
          expect(chipTotal(s)).toBe(total);
        }
        // award every open pot to its first eligible player
        while (s.hand!.street === 'showdown') {
          const idx = s.hand!.pots.findIndex((p) => !p.paid);
          const r = awardPot(s, idx, [s.hand!.pots[idx]!.eligible[0]!]);
          if (!r.ok) throw new Error(r.error);
          s = r.state;
        }
        expect(chipTotal(s)).toBe(total);
        const alive = Object.values(s.players).filter((p) => p.stack > 0).length;
        if (alive < 2) break;
        const nr = startHandImport(s);
        if (!nr.ok) break;
        s = nr.state;
      }
    }
  });
});

import { addPlayer, createTable, rebuy, updateSettings } from './seats';

describe('buy-in limits', () => {
  it('accepts buy-ins up to 999,999 by default and rejects more', () => {
    const t = createTable();
    expect(t.settings.maxBuyIn).toBe(999_999);
    const ok = addPlayer(t, 'Rich', 0, 999_999);
    expect(ok.ok).toBe(true);
    expect(addPlayer(t, 'Richer', 1, 1_000_000).ok).toBe(false);
  });

  it("can't raise the max past 999,999 in settings", () => {
    expect(updateSettings(createTable(), { maxBuyIn: 1_000_000 }).ok).toBe(false);
    expect(updateSettings(createTable(), { maxBuyIn: 500_000 }).ok).toBe(true);
  });

  it('top-up is capped by the max buy-in', () => {
    const t = createTable();
    const a = addPlayer(t, 'A', 0, 999_000);
    if (!a.ok) throw new Error(a.error);
    expect(rebuy(a.state, 'p1', 1000).ok).toBe(false);
    expect(rebuy(a.state, 'p1', 999).ok).toBe(true);
  });
});

describe('last action labels (display only)', () => {
  it('tracks what each player did this street; folds persist, others reset on a new street', () => {
    let s = setup([1000, 1000, 1000]);
    s = run(s, ['A', 'raise', 30], ['B', 'fold'], ['C', 'call']);
    const h = s.hand!;
    expect(h.street).toBe('flop');
    const la = (n: string) => h.players.find((p) => p.id === id(n))!.lastAction;
    expect(la('B')).toBe('fold');
    expect(la('A')).toBeUndefined();
    expect(la('C')).toBeUndefined();
    s = run(s, ['C', 'raise', 40]);
    expect(s.hand!.players.find((p) => p.id === id('C'))!.lastAction).toBe('bet');
    s = run(s, ['A', 'allIn']);
    expect(s.hand!.players.find((p) => p.id === id('A'))!.lastAction).toBe('allIn');
  });
});

describe('community card count', () => {
  it('opens 3, 4, 5 cards as streets advance and all 5 at a run-out', () => {
    let s = setup([1000, 1000]);
    expect(s.hand!.board).toBe(0);
    s = run(s, ['A', 'call'], ['B', 'check']);
    expect(s.hand!.board).toBe(3);
    s = run(s, ['B', 'check'], ['A', 'check']);
    expect(s.hand!.board).toBe(4);
    s = run(s, ['B', 'check'], ['A', 'check']);
    expect(s.hand!.board).toBe(5);
    const shove = run(setup([100, 100]), ['A', 'allIn'], ['B', 'call']);
    expect(shove.hand!.board).toBe(5);
    expect(shove.hand!.runout).toBe(true);
  });

  it('keeps the count when everyone folds early', () => {
    let s = setup([1000, 1000]);
    s = run(s, ['A', 'call'], ['B', 'check'], ['B', 'raise', 20], ['A', 'fold']);
    expect(s.hand!.street).toBe('complete');
    expect(s.hand!.board).toBe(3);
  });
});
