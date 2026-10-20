import { fail, ok, type Player, type Result, type Settings, type TableState } from './types';

/** Largest buy-in or stack the table accepts. */
export const MAX_CHIPS = 999_999;

export const defaultSettings: Settings = {
  smallBlind: 5,
  bigBlind: 10,
  maxSeats: 9,
  minBuyIn: 200,
  maxBuyIn: MAX_CHIPS,
};

export function createTable(settings: Partial<Settings> = {}): TableState {
  const merged = { ...defaultSettings, ...settings };
  return {
    settings: merged,
    seats: Array.from({ length: merged.maxSeats }, () => null),
    players: {},
    hand: null,
    buttonSeat: null,
    lastBBSeat: null,
    handNumber: 0,
    nextPlayerNum: 1,
    log: [],
    cashOuts: [],
  };
}

export function handInProgress(s: TableState): boolean {
  return s.hand !== null && s.hand.street !== 'complete';
}

export function logEntry(s: TableState, text: string): TableState {
  return { ...s, log: [...s.log, { at: Date.now(), text }] };
}

const BETWEEN_HANDS = 'Change seats and stacks between hands';

function validBuyIn(s: TableState, amount: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Buy-in must be a whole number of chips';
  if (amount < s.settings.minBuyIn) return `Minimum buy-in is ${s.settings.minBuyIn}`;
  if (amount > s.settings.maxBuyIn) return `Maximum buy-in is ${s.settings.maxBuyIn}`;
  return null;
}

export function addPlayer(
  s: TableState,
  name: string,
  seat: number,
  buyIn: number,
): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const trimmed = name.trim();
  if (!trimmed) return fail('Name required');
  if (!Number.isInteger(seat) || seat < 0 || seat >= s.seats.length) return fail('No such seat');
  if (s.seats[seat] !== null) return fail('Seat taken');
  const dup = Object.values(s.players).some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (dup) return fail('Name already used at this table');
  const err = validBuyIn(s, buyIn);
  if (err) return fail(err);

  const id = `p${s.nextPlayerNum}`;
  const seatedBefore = s.handNumber > 0;
  const player: Player = {
    id,
    name: trimmed,
    seat,
    stack: buyIn,
    sittingOut: false,
    waitingForBB: seatedBefore,
    buyIns: [buyIn],
  };
  const seats = [...s.seats];
  seats[seat] = id;
  return ok(
    logEntry(
      { ...s, seats, players: { ...s.players, [id]: player }, nextPlayerNum: s.nextPlayerNum + 1 },
      `${trimmed} sat at seat ${seat + 1} with ${buyIn}`,
    ),
  );
}

export function removePlayer(s: TableState, id: string): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const p = s.players[id];
  if (!p) return fail('No such player');
  const seats = [...s.seats];
  seats[p.seat] = null;
  const { [id]: _gone, ...players } = s.players;
  const cashOuts = [...(s.cashOuts ?? []), { name: p.name, buyIns: p.buyIns, cashOut: p.stack }];
  return ok(logEntry({ ...s, seats, players, cashOuts }, `${p.name} left with ${p.stack}`));
}

export function renamePlayer(s: TableState, id: string, name: string): Result<TableState> {
  const p = s.players[id];
  if (!p) return fail('No such player');
  const trimmed = name.trim();
  if (!trimmed) return fail('Name required');
  const dup = Object.values(s.players).some(
    (o) => o.id !== id && o.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (dup) return fail('Name already used at this table');
  return ok({ ...s, players: { ...s.players, [id]: { ...p, name: trimmed } } });
}

/** Move a player to an empty seat, or swap with whoever sits there. */
export function movePlayer(s: TableState, id: string, toSeat: number): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const p = s.players[id];
  if (!p) return fail('No such player');
  if (!Number.isInteger(toSeat) || toSeat < 0 || toSeat >= s.seats.length) return fail('No such seat');
  if (toSeat === p.seat) return ok(s);
  const otherId = s.seats[toSeat];
  const seats = [...s.seats];
  const players = { ...s.players, [id]: { ...p, seat: toSeat } };
  seats[toSeat] = id;
  seats[p.seat] = otherId ?? null;
  if (otherId) {
    const other = s.players[otherId];
    if (other) players[otherId] = { ...other, seat: p.seat };
  }
  return ok({ ...s, seats, players });
}

export function setSittingOut(s: TableState, id: string, out: boolean): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const p = s.players[id];
  if (!p) return fail('No such player');
  return ok({ ...s, players: { ...s.players, [id]: { ...p, sittingOut: out } } });
}

/** Top-up or rebuy: adds chips, capped so the stack never exceeds max buy-in. */
export function rebuy(s: TableState, id: string, amount: number): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const p = s.players[id];
  if (!p) return fail('No such player');
  if (!Number.isInteger(amount) || amount <= 0) return fail('Amount must be a whole number of chips');
  if (p.stack + amount > s.settings.maxBuyIn) {
    return fail(`Stack would exceed max buy-in ${s.settings.maxBuyIn} (room for ${Math.max(0, s.settings.maxBuyIn - p.stack)})`);
  }
  if (p.stack === 0 && amount < s.settings.minBuyIn) return fail(`Minimum buy-in is ${s.settings.minBuyIn}`);
  const updated: Player = { ...p, stack: p.stack + amount, buyIns: [...p.buyIns, amount] };
  return ok(logEntry({ ...s, players: { ...s.players, [id]: updated } }, `${p.name} added ${amount} (stack ${updated.stack})`));
}

/** Host correction (RULES T6): set a stack directly, always logged. */
export function adjustStack(s: TableState, id: string, newStack: number, reason: string): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const p = s.players[id];
  if (!p) return fail('No such player');
  if (!Number.isInteger(newStack) || newStack < 0) return fail('Stack must be a whole number >= 0');
  return ok(
    logEntry(
      { ...s, players: { ...s.players, [id]: { ...p, stack: newStack } } },
      `Correction: ${p.name} ${p.stack} -> ${newStack}${reason ? ` (${reason})` : ''}`,
    ),
  );
}

export function updateSettings(s: TableState, patch: Partial<Settings>): Result<TableState> {
  if (handInProgress(s)) return fail(BETWEEN_HANDS);
  const next = { ...s.settings, ...patch };
  if (next.smallBlind <= 0 || next.bigBlind < next.smallBlind) return fail('Blinds invalid');
  if (next.minBuyIn > next.maxBuyIn) return fail('Min buy-in exceeds max');
  if (next.maxBuyIn > MAX_CHIPS) return fail(`Max buy-in can't exceed ${MAX_CHIPS.toLocaleString('en-US')}`);
  if (next.maxSeats !== s.settings.maxSeats) {
    if (next.maxSeats < 2 || next.maxSeats > 10) return fail('Seats must be 2-10');
    if (s.seats.slice(next.maxSeats).some((x) => x !== null)) return fail('Players seated beyond new seat count');
    const seats = Array.from({ length: next.maxSeats }, (_, i) => s.seats[i] ?? null);
    return ok({ ...s, settings: next, seats });
  }
  return ok({ ...s, settings: next });
}
