import type { HandPlayer, Pot } from './types';

/**
 * Uncalled-bet refund (RULES P3): the part of the single highest contribution
 * that nobody matched. Folded players' chips count as matching.
 */
export function uncalledRefund(players: HandPlayer[]): { id: string; amount: number } | null {
  if (players.length < 2) return null;
  const sorted = [...players].sort((a, b) => b.total - a.total);
  const top = sorted[0]!;
  const second = sorted[1]!;
  if (top.total === second.total) return null;
  return { id: top.id, amount: top.total - second.total };
}

/**
 * Build main/side pots from total contributions (RULES P1, P2).
 * Levels come from non-folded players; folded chips fill layers but folded
 * players are never eligible. Adjacent layers with identical eligibility merge.
 */
export function buildPots(players: HandPlayer[]): Pot[] {
  const live = players.filter((p) => !p.folded);
  const levels = [...new Set(live.map((p) => p.total))].filter((l) => l > 0).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      amount += Math.max(0, Math.min(p.total, level) - prev);
    }
    const eligible = live.filter((p) => p.total >= level).map((p) => p.id);
    prev = level;
    if (amount === 0) continue;
    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligible, eligible)) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  // Folded chips above the highest live level (dead money) go to the top pot.
  const maxLevel = levels[levels.length - 1] ?? 0;
  const excess = players.reduce((n, p) => n + Math.max(0, p.total - maxLevel), 0);
  if (excess > 0 && pots.length > 0) pots[pots.length - 1]!.amount += excess;
  return pots;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Split a pot among winners (RULES P5). Odd chips go one each to winners in
 * clockwise order starting left of the button. `clockwiseOrder` lists player
 * ids starting with the first seat left of the button.
 */
export function splitPot(
  amount: number,
  winners: string[],
  clockwiseOrder: string[],
): Record<string, number> {
  const ordered = clockwiseOrder.filter((id) => winners.includes(id));
  const share = Math.floor(amount / ordered.length);
  let odd = amount - share * ordered.length;
  const out: Record<string, number> = {};
  for (const id of ordered) {
    out[id] = share + (odd > 0 ? 1 : 0);
    if (odd > 0) odd -= 1;
  }
  return out;
}
