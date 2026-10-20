import { PokerEngine } from '@pokertools/engine';
import { describe, expect, it } from 'vitest';
import { act, startHand } from './hand';
import { legalActions } from './legal';
import { addPlayer, createTable } from './seats';
import type { Action, TableState } from './types';

/**
 * Differential test against @pokertools/engine (MIT, independent implementation).
 * Same table, same blinds, same random (partly illegal) actions: both engines
 * must agree on accept/reject, who acts next, and every stack.
 */
function build(stacks: number[]) {
  const ref = new PokerEngine({ smallBlind: 5, bigBlind: 10, maxPlayers: 9 });
  let mine = createTable({ smallBlind: 5, bigBlind: 10, minBuyIn: 1, maxBuyIn: 1e6 });
  stacks.forEach((st, i) => {
    ref.sit(i, `p${i + 1}`, String.fromCharCode(65 + i), st);
    const r = addPlayer(mine, String.fromCharCode(65 + i), i, st);
    if (!r.ok) throw new Error(r.error);
    mine = r.state;
  });
  ref.deal();
  const r = startHand(mine, { buttonSeat: ref.state.buttonSeat ?? 0 });
  if (!r.ok) throw new Error(r.error);
  return { ref, mine: r.state };
}

/** Reference has no ALL_IN: all-in is BET/RAISE for the whole stack, or CALL if it doesn't exceed the bet. */
const toRef = (s: TableState, a: Action, pid: string) => {
  const l = legalActions(s)!;
  const facing = s.hand!.streetBet > 0;
  const wager = (to: number) => ({ type: facing ? 'RAISE' : 'BET', playerId: pid, amount: to });
  switch (a.type) {
    case 'fold': return { type: 'FOLD', playerId: pid };
    case 'check': return { type: 'CHECK', playerId: pid };
    case 'call': return { type: 'CALL', playerId: pid };
    case 'raise': return wager(a.to);
    case 'allIn': return l.maxTo <= s.hand!.streetBet ? { type: 'CALL', playerId: pid } : wager(l.maxTo);
  }
};

describe('differential vs @pokertools/engine', () => {
  it('agrees on legality, turn order and stacks over random hands', () => {
    let seed = 987654321;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const diffs: string[] = [];
    let compared = 0;
    for (let game = 0; game < 400; game++) {
      const n = 2 + Math.floor(rnd() * 5);
      const stacks = Array.from({ length: n }, () => 15 + Math.floor(rnd() * 300));
      const { ref, mine: m0 } = build(stacks);
      let mine: TableState = m0;
      const trace: string[] = [];
      let steps = 0;
      while (mine.hand!.toActId && ref.state.actionTo !== null && ++steps < 100) {
        const seat = mine.players[mine.hand!.toActId]!.seat;
        if (seat !== ref.state.actionTo) {
          diffs.push(`g${game} actor mismatch mine=${seat} ref=${ref.state.actionTo} [${trace.join(', ')}]`);
          break;
        }
        const l = legalActions(mine)!;
        const pid = mine.hand!.toActId;
        const pool: Action[] = [{ type: 'fold' }, { type: 'check' }, { type: 'call' }, { type: 'allIn' }];
        const hi = l.maxTo;
        pool.push({ type: 'raise', to: 1 + Math.floor(rnd() * hi) });
        pool.push({ type: 'raise', to: Math.min(l.maxTo, l.minTo) });
        pool.push({ type: 'raise', to: Math.min(l.maxTo, l.minTo + Math.floor(rnd() * 40)) });
        const a = pool[Math.floor(rnd() * pool.length)]!;
        const mineRes = act(mine, pid, a);
        const refRes = ref.validate(toRef(mine, a, pid) as never);
        const refOk = (refRes as { valid: boolean }).valid;
        trace.push(`${mine.players[pid]!.name}:${a.type}${a.type === 'raise' ? a.to : ''}`);
        compared++;
        if (mineRes.ok !== refOk) {
          diffs.push(`g${game} legality mine=${mineRes.ok}${mineRes.ok ? '' : `(${mineRes.error})`} ref=${refOk}${refOk ? '' : `(${(refRes as { error?: string }).error})`} stacks=${stacks} [${trace.join(', ')}]`);
          break;
        }
        if (!mineRes.ok) { trace.pop(); continue; }
        ref.act(toRef(mine, a, pid) as never);
        mine = mineRes.state;
        const bad = Object.values(mine.players).find((p) => ref.state.players[p.seat]!.stack !== p.stack);
        if (bad && mine.hand!.street !== 'showdown' && mine.hand!.street !== 'complete') {
          diffs.push(`g${game} stack mismatch ${bad.name} mine=${bad.stack} ref=${ref.state.players[bad.seat]!.stack} [${trace.join(', ')}]`);
          break;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`compared ${compared} actions, ${diffs.length} divergences\n${diffs.slice(0, 15).join('\n')}`);
    expect(compared).toBeGreaterThan(1000);
    expect(diffs).toEqual([]);
  });
});
