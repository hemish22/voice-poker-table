import { legalActions, canAct, reopenedFor, potSize } from './legal';
import { buildPots, splitPot, uncalledRefund } from './pots';
import { logEntry, handInProgress } from './seats';
import {
  fail,
  ok,
  type Action,
  type Hand,
  type HandPlayer,
  type Player,
  type Result,
  type Street,
  type TableState,
} from './types';

const NEXT_STREET: Record<string, Street> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: 'showdown',
};

/** Next seat (clockwise, wrapping) in `seats` strictly after `after`. */
function seatAfter(seats: number[], after: number): number {
  const sorted = [...seats].sort((a, b) => a - b);
  return sorted.find((x) => x > after) ?? sorted[0]!;
}

export interface StartOptions {
  /** Force the button to this seat (first hand / host choice). */
  buttonSeat?: number;
}

export function startHand(prev: TableState, opts: StartOptions = {}): Result<TableState> {
  if (handInProgress(prev)) return fail('Hand already in progress');
  const s = structuredClone(prev);
  const bySeat = (a: Player, b: Player) => a.seat - b.seat;
  let dealt = Object.values(s.players)
    .filter((p) => p.stack > 0 && !p.sittingOut)
    .sort(bySeat);
  if (dealt.length < 2) return fail('Need at least 2 players with chips');

  let buttonSeat = 0;
  let order: Player[] = [];
  // Waiters (RULES T3) only join when they land on the big blind; drop the rest and re-seat.
  for (;;) {
    const seatNums = dealt.map((p) => p.seat);
    if (opts.buttonSeat !== undefined && seatNums.includes(opts.buttonSeat)) buttonSeat = opts.buttonSeat;
    else if (s.buttonSeat === null) buttonSeat = Math.min(...seatNums);
    else buttonSeat = seatAfter(seatNums, s.buttonSeat);

    const idx = dealt.findIndex((p) => p.seat === buttonSeat);
    order = [...dealt.slice(idx), ...dealt.slice(0, idx)];
    // Heads-up: nobody is big blind twice in a row (RULES B3).
    if (order.length === 2 && order[1]!.seat === s.lastBBSeat && opts.buttonSeat === undefined) {
      order = [order[1]!, order[0]!];
      buttonSeat = order[0]!.seat;
    }
    const bbPlayer = order[order.length === 2 ? 1 : 2]!;
    const waiters = dealt.filter((p) => p.waitingForBB && p.id !== bbPlayer.id);
    if (waiters.length === 0) break;
    dealt = dealt.filter((p) => !waiters.includes(p));
    if (dealt.length < 2) return fail('Need at least 2 players with chips (new players wait for the big blind)');
  }

  const n = order.length;
  const sb = n === 2 ? order[0]! : order[1]!;
  const bb = n === 2 ? order[1]! : order[2]!;
  const { smallBlind, bigBlind } = s.settings;

  const players: HandPlayer[] = order.map((p) => ({
    id: p.id,
    seat: p.seat,
    folded: false,
    allIn: false,
    streetBet: 0,
    total: 0,
    acted: false,
    betAtLastAction: 0,
  }));
  const post = (pl: Player, amount: number) => {
    const hp = players.find((x) => x.id === pl.id)!;
    const paid = Math.min(amount, s.players[pl.id]!.stack);
    s.players[pl.id]!.stack -= paid;
    hp.streetBet += paid;
    hp.total += paid;
    if (s.players[pl.id]!.stack === 0) hp.allIn = true;
  };
  post(sb, smallBlind);
  post(bb, bigBlind);
  s.players[bb.id]!.waitingForBB = false;

  s.handNumber += 1;
  s.buttonSeat = buttonSeat;
  s.lastBBSeat = bb.seat;
  s.hand = {
    number: s.handNumber,
    street: 'preflop',
    buttonSeat,
    players,
    sbId: sb.id,
    bbId: bb.id,
    toActId: null,
    streetBet: bigBlind,
    lastIncrement: bigBlind,
    board: 0,
    runout: false,
    pots: [],
    refunds: {},
  };
  const h = s.hand;
  const firstIdx = n === 2 ? 0 : 3 % n;
  const log = logEntry(
    s,
    `Hand ${h.number}: button ${s.players[order[0]!.id]!.name}, SB ${s.players[sb.id]!.name} ${smallBlind}, BB ${s.players[bb.id]!.name} ${bigBlind}`,
  );
  Object.assign(s, log);
  // Preflop first actor starts at UTG; nobody has acted so don't test for closure first.
  if (isClosed(h)) closeStreet(s);
  else h.toActId = nextActor(h, firstIdx - 1);
  return ok(s);
}

function isClosed(h: Hand): boolean {
  const live = h.players.filter((p) => !p.folded);
  if (live.length <= 1) return true;
  const ca = live.filter(canAct);
  if (ca.length === 0) return true;
  if (ca.some((p) => p.streetBet < h.streetBet)) return false;
  if (ca.length === 1) return true;
  return ca.every((p) => p.acted);
}

/** First player strictly after index `from` (clockwise, wrapping) who still has to act. */
function nextActor(h: Hand, from: number): string {
  const n = h.players.length;
  for (let i = 1; i <= n; i++) {
    const p = h.players[(((from + i) % n) + n) % n]!;
    if (canAct(p) && (!p.acted || p.streetBet < h.streetBet)) return p.id;
  }
  throw new Error('nextActor: no player to act although round is open');
}

function refundUncalled(s: TableState): void {
  const h = s.hand!;
  const r = uncalledRefund(h.players);
  if (!r) return;
  const hp = h.players.find((p) => p.id === r.id)!;
  hp.total -= r.amount;
  hp.streetBet = Math.max(0, hp.streetBet - r.amount);
  s.players[r.id]!.stack += r.amount;
  h.refunds[r.id] = (h.refunds[r.id] ?? 0) + r.amount;
  Object.assign(s, logEntry(s, `${s.players[r.id]!.name} gets ${r.amount} back (uncalled)`));
}

function clockwiseFromLeftOfButton(h: Hand): string[] {
  return [...h.players.slice(1), h.players[0]!].map((p) => p.id);
}

function enterShowdown(s: TableState): void {
  const h = s.hand!;
  h.street = 'showdown';
  h.toActId = null;
  h.pots = buildPots(h.players);
  for (const pot of h.pots) {
    if (pot.eligible.length === 1) pot.winners = [pot.eligible[0]!];
  }
  settleAwarded(s);
}

/** Pay out every pot that has winners but isn't paid yet; complete the hand when all are paid. */
function settleAwarded(s: TableState): void {
  const h = s.hand!;
  const order = clockwiseFromLeftOfButton(h);
  for (const pot of h.pots) {
    if (!pot.winners || pot.paid) continue;
    const shares = splitPot(pot.amount, pot.winners, order);
    for (const [id, amt] of Object.entries(shares)) s.players[id]!.stack += amt;
    pot.paid = true;
    const names = pot.winners.map((id) => s.players[id]!.name).join(' & ');
    Object.assign(s, logEntry(s, `${names} win${pot.winners.length === 1 ? 's' : ''} ${pot.amount}`));
  }
  if (h.pots.length > 0 && h.pots.every((p) => p.winners)) h.street = 'complete';
}

function finishUncontested(s: TableState): void {
  const h = s.hand!;
  refundUncalled(s);
  const winner = h.players.find((p) => !p.folded)!;
  h.street = 'showdown';
  h.toActId = null;
  h.pots = [{ amount: potSize(h), eligible: [winner.id], winners: [winner.id] }];
  settleAwarded(s);
}

function closeStreet(s: TableState): void {
  const h = s.hand!;
  if (h.players.filter((p) => !p.folded).length <= 1) return finishUncontested(s);
  refundUncalled(s);
  for (const p of h.players) {
    p.streetBet = 0;
    p.acted = false;
    p.betAtLastAction = 0;
    if (!p.folded) p.lastAction = undefined;
  }
  h.streetBet = 0;
  h.lastIncrement = s.settings.bigBlind;

  const ca = h.players.filter(canAct);
  let next = NEXT_STREET[h.street]!;
  if (ca.length <= 1) {
    // Nobody left to bet against: remaining streets are just dealt.
    h.runout = h.street !== 'river';
    next = 'showdown';
  }
  if (next === 'showdown') {
    h.board = 5;
    return enterShowdown(s);
  }
  h.street = next;
  h.board = next === 'flop' ? 3 : next === 'turn' ? 4 : 5;
  h.toActId = nextActor(h, 0);
}

export function act(prev: TableState, playerId: string, action: Action): Result<TableState> {
  const h0 = prev.hand;
  if (!h0 || !h0.toActId) return fail('No betting in progress');
  if (h0.toActId !== playerId) return fail(`Not your turn: ${prev.players[h0.toActId]?.name} is up`);
  const legal = legalActions(prev)!;
  const name = prev.players[playerId]!.name;

  const s = structuredClone(prev);
  const h = s.hand!;
  const idx = h.players.findIndex((p) => p.id === playerId);
  const hp = h.players[idx]!;
  const pl = s.players[playerId]!;
  let text: string;

  const put = (amount: number) => {
    pl.stack -= amount;
    hp.streetBet += amount;
    hp.total += amount;
    if (pl.stack === 0) hp.allIn = true;
  };

  let a = action;
  if (a.type === 'allIn') {
    a = legal.maxTo <= h.streetBet ? { type: 'call' } : { type: 'raise', to: legal.maxTo };
  }

  switch (a.type) {
    case 'fold':
      hp.folded = true;
      hp.lastAction = 'fold';
      text = `${name} folds`;
      break;
    case 'check':
      if (!legal.canCheck) return fail(`Can't check, ${legal.toCall} to call`);
      hp.lastAction = 'check';
      text = `${name} checks`;
      break;
    case 'call': {
      if (!legal.canCall) return fail('Nothing to call, check instead');
      put(legal.toCall);
      hp.lastAction = hp.allIn ? 'allIn' : 'call';
      text = `${name} calls ${legal.toCall}${hp.allIn ? ' (all-in)' : ''}`;
      break;
    }
    case 'raise': {
      const to = a.to;
      if (!Number.isInteger(to)) return fail('Amount must be a whole number');
      if (legal.notReopened) return fail("Betting wasn't reopened by the short all-in: call or fold");
      if (to <= h.streetBet) {
        return fail(legal.isBet ? `Bet must be at least ${legal.minTo}` : `Raise must be above ${h.streetBet}`);
      }
      if (to > legal.maxTo) return fail(`Only ${legal.stack} behind: max is ${legal.maxTo}`);
      const allIn = to === legal.maxTo;
      if (to < legal.minTo && !allIn) {
        return fail(legal.isBet ? `Minimum bet is ${legal.minTo}` : `Minimum raise is to ${legal.minTo}`);
      }
      const increment = to - h.streetBet;
      put(to - hp.streetBet);
      if (increment >= h.lastIncrement) h.lastIncrement = increment;
      h.streetBet = to;
      hp.lastAction = hp.allIn ? 'allIn' : legal.isBet ? 'bet' : 'raise';
      text = `${name} ${legal.isBet ? 'bets' : 'raises to'} ${to}${hp.allIn ? ' (all-in)' : ''}`;
      break;
    }
  }

  hp.acted = true;
  hp.betAtLastAction = h.streetBet;
  Object.assign(s, logEntry(s, text));

  if (h.players.filter((p) => !p.folded).length <= 1) finishUncontested(s);
  else if (isClosed(h)) closeStreet(s);
  else h.toActId = nextActor(h, idx);
  return ok(s);
}

/** Award one pot (index in hand.pots) to the chosen winners. */
export function awardPot(prev: TableState, potIndex: number, winners: string[]): Result<TableState> {
  const h0 = prev.hand;
  if (!h0 || h0.street !== 'showdown') return fail('No showdown in progress');
  const pot0 = h0.pots[potIndex];
  if (!pot0) return fail('No such pot');
  if (pot0.paid) return fail('Pot already awarded');
  if (winners.length === 0) return fail('Pick at least one winner');
  if (new Set(winners).size !== winners.length) return fail('Duplicate winner');
  if (winners.some((w) => !pot0.eligible.includes(w))) return fail('Winner not eligible for this pot');
  const s = structuredClone(prev);
  s.hand!.pots[potIndex]!.winners = winners;
  settleAwarded(s);
  return ok(s);
}

export { reopenedFor };
