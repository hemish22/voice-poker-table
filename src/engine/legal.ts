import type { Hand, HandPlayer, TableState } from './types';

export interface Legal {
  playerId: string;
  stack: number;
  /** Chips this player already has in on this street. */
  mine: number;
  /** Chips needed to call, capped at stack. */
  toCall: number;
  canCheck: boolean;
  canCall: boolean;
  /** True when no bet yet this street (a wager is a "bet", not a "raise"). */
  isBet: boolean;
  /** Any bet/raise (including an all-in raise) is allowed. */
  canRaise: boolean;
  /** Betting was closed to this player by a short all-in (RULES R3/R5). */
  notReopened: boolean;
  /** Smallest legal wager "to" total; may exceed maxTo, then only all-in works. */
  minTo: number;
  /** All-in "to" total. */
  maxTo: number;
  pot: number;
  halfPotTo: number;
  potTo: number;
}

export function potSize(h: Hand): number {
  return h.players.reduce((n, p) => n + p.total, 0);
}

export function canAct(p: HandPlayer): boolean {
  return !p.folded && !p.allIn;
}

/** RULES R5: may this player raise right now? */
export function reopenedFor(h: Hand, p: HandPlayer): boolean {
  return !p.acted || h.streetBet - p.betAtLastAction >= h.lastIncrement;
}

export function legalActions(s: TableState): Legal | null {
  const h = s.hand;
  if (!h || !h.toActId) return null;
  const hp = h.players.find((p) => p.id === h.toActId);
  const pl = s.players[h.toActId];
  if (!hp || !pl) return null;

  const stack = pl.stack;
  const mine = hp.streetBet;
  const owed = Math.max(0, h.streetBet - mine);
  const toCall = Math.min(owed, stack);
  const maxTo = mine + stack;
  const reopened = reopenedFor(h, hp);
  const canRaise = reopened && maxTo > h.streetBet;
  const minTo = h.streetBet + h.lastIncrement;
  const pot = potSize(h);
  const clamp = (n: number) => Math.min(maxTo, Math.max(minTo, n));
  return {
    playerId: hp.id,
    stack,
    mine,
    toCall,
    canCheck: owed === 0,
    canCall: owed > 0,
    isBet: h.streetBet === 0,
    canRaise,
    notReopened: !reopened && maxTo > h.streetBet,
    minTo,
    maxTo,
    pot,
    halfPotTo: clamp(h.streetBet + Math.floor((pot + owed) / 2)),
    potTo: clamp(h.streetBet + pot + owed),
  };
}
