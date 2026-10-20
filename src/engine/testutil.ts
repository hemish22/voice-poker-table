import { act, startHand } from './hand';
import { addPlayer, createTable } from './seats';
import type { Action, Settings, TableState } from './types';

/** Players A, B, C... get ids p1, p2, p3... in seats 0, 1, 2... */
export function setup(stacks: number[], settings: Partial<Settings> = {}, buttonSeat = 0): TableState {
  let s = createTable({ smallBlind: 5, bigBlind: 10, minBuyIn: 1, maxBuyIn: 1_000_000, ...settings });
  stacks.forEach((stack, i) => {
    const r = addPlayer(s, String.fromCharCode(65 + i), i, stack);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  });
  const r = startHand(s, { buttonSeat });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

export const id = (name: string) => `p${name.charCodeAt(0) - 64}`;

/** Run actions like ['A', 'call'], ['B', 'raise', 30]; throws on rejection. */
export function run(s: TableState, ...steps: [string, string, number?][]): TableState {
  for (const [who, type, to] of steps) {
    const action = (to === undefined ? { type } : { type, to }) as Action;
    const r = act(s, id(who), action);
    if (!r.ok) throw new Error(`${who} ${type} ${to ?? ''} rejected: ${r.error}`);
    s = r.state;
  }
  return s;
}

export function tryAct(s: TableState, who: string, action: Action) {
  return act(s, id(who), action);
}

export const stackOf = (s: TableState, name: string) => s.players[id(name)]!.stack;
export const toAct = (s: TableState) => s.hand!.toActId && s.players[s.hand!.toActId]!.name;

export function chipTotal(s: TableState): number {
  const h = s.hand;
  let inHand = 0;
  if (h && h.street === 'showdown') inHand = h.pots.filter((p) => !p.paid).reduce((n, p) => n + p.amount, 0);
  else if (h && h.street !== 'complete') inHand = h.players.reduce((n, p) => n + p.total, 0);
  return Object.values(s.players).reduce((n, p) => n + p.stack, 0) + inHand;
}
