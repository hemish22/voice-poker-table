export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export interface Settings {
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
}

export interface Player {
  id: string;
  name: string;
  seat: number;
  stack: number;
  sittingOut: boolean;
  /** Joined mid-session: sits out until they would be big blind (RULES T3). */
  waitingForBB: boolean;
  buyIns: number[];
}

export type LastAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';

/** Per-hand state of a player dealt into the hand. */
export interface HandPlayer {
  id: string;
  seat: number;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  streetBet: number;
  /** Chips put in over the whole hand (after refunds). */
  total: number;
  acted: boolean;
  /** Table streetBet at the moment this player last acted (R5). */
  betAtLastAction: number;
  /** What they did on this street (folds persist). For display only. */
  lastAction?: LastAction;
}

export interface Pot {
  amount: number;
  eligible: string[];
  /** Winner ids once awarded. */
  winners?: string[];
  /** Chips already paid out to winners. */
  paid?: boolean;
}

export interface Hand {
  number: number;
  street: Street;
  buttonSeat: number;
  /** Dealt-in players in clockwise seat order starting from the button. */
  players: HandPlayer[];
  sbId: string | null;
  bbId: string;
  toActId: string | null;
  streetBet: number;
  lastIncrement: number;
  /** Community cards that should be face up right now: 0 preflop, 3 flop, 4 turn, 5 river/showdown. */
  board: number;
  /** Set once betting is impossible and remaining streets are just dealt. */
  runout: boolean;
  /** Built when the hand reaches showdown. */
  pots: Pot[];
  /** Uncalled chips returned during this hand, by player id. */
  refunds: Record<string, number>;
}

export interface LogEntry {
  at: number;
  text: string;
}

/** Record of someone who left the table, for the end-of-night settlement. */
export interface CashOut {
  name: string;
  buyIns: number[];
  cashOut: number;
}

export interface TableState {
  settings: Settings;
  /** Seat index -> player id. */
  seats: (string | null)[];
  players: Record<string, Player>;
  hand: Hand | null;
  buttonSeat: number | null;
  lastBBSeat: number | null;
  handNumber: number;
  nextPlayerNum: number;
  log: LogEntry[];
  cashOuts: CashOut[];
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Bet (no bet yet) or raise (facing a bet) to a total street amount. */
  | { type: 'raise'; to: number }
  | { type: 'allIn' };

export type Result<T> = { ok: true; state: T } | { ok: false; error: string };

export const ok = <T>(state: T): Result<T> => ({ ok: true, state });
export const fail = <T>(error: string): Result<T> => ({ ok: false, error });
