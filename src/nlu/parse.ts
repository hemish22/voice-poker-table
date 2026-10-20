import type { Intent } from '../controller/session';
import { legalActions, potSize } from '../engine/legal';
import type { Player, TableState } from '../engine/types';
import { extractAmount } from './numbers';

export type Parsed =
  | { kind: 'intent'; intent: Intent }
  | { kind: 'query'; answer: string }
  | { kind: 'reject'; reason: string }
  | { kind: 'none' };

/** Spoken-form fixes: what speech engines commonly hear for poker words. */
const HOMOPHONES: Record<string, string> = {
  rays: 'raise', raze: 'raise', rase: 'raise', races: 'raise', raised: 'raise', raising: 'raise', raises: 'raise',
  cal: 'call', caul: 'call', col: 'call', called: 'call', calls: 'call',
  folk: 'fold', folds: 'fold', folded: 'fold', fault: 'fold', phold: 'fold',
  czech: 'check', chek: 'check', chec: 'check', checks: 'check', checked: 'check',
  allin: 'allin', shove: 'allin', jam: 'allin', shoves: 'allin',
  wins: 'win', won: 'win', winner: 'win', takes: 'win', take: 'win', chop: 'split', chops: 'split', splits: 'split',
  minimum: 'min', mini: 'min',
  to: 'to', too: 'to', two: 'two',
  deal: 'deal', dealt: 'deal', dealer: 'dealer',
  undone: 'undo',
};

export function tokenize(text: string): string[] {
  let t = text.toLowerCase().replace(/[’']/g, '').replace(/-/g, ' ').replace(/[^a-z0-9.,\s]/g, ' ');
  t = t.replace(/\ball in\b/g, 'allin').replace(/\bgo back\b/g, 'undo').replace(/\bnext hand\b|\bnew hand\b/g, 'deal');
  return t.split(/\s+/).map((w) => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean).map((w) => HOMOPHONES[w] ?? w);
}

const lev = (a: string, b: string): number => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
};

/** Players whose names appear in the words, in spoken order. Tolerates one slip on names of 4+ letters. */
export function matchNames(words: string[], players: Player[]): Player[] {
  const found: { p: Player; at: number }[] = [];
  for (const p of players) {
    const nameWords = tokenize(p.name).filter((w) => w !== 'to');
    const raw = p.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const target = raw.length ? raw : nameWords;
    const first = target[0];
    if (!first) continue;
    const at = words.findIndex((w) => w === first || (first.length >= 4 && w.length >= 4 && lev(w, first) <= 1));
    if (at >= 0) found.push({ p, at });
  }
  // "seat three": offline recognition may not know a name, but it always knows numbers.
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] !== 'seat' && words[i] !== 'player') continue;
    const n = extractAmount(words.slice(i + 1, i + 3));
    const p = n === null ? undefined : players.find((x) => x.seat === n - 1);
    if (p && !found.some((f) => f.p.id === p.id)) found.push({ p, at: i });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

const NUM_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

const ACTION_WORDS = new Set(['fold', 'check', 'call', 'raise', 'bet', 'allin', 'make']);

export function parseCommand(transcript: string, state: TableState): Parsed {
  const words = tokenize(transcript);
  if (words.length === 0) return { kind: 'none' };
  const has = (w: string) => words.includes(w);
  const hand = state.hand;
  const players = Object.values(state.players);

  // Short utterances the recognizer often mangles. Safe because every command needs the wake word and a yes.
  const first = words[0]!;
  if (hand?.toActId) {
    if (words.length === 1 && (first === 'four' || first === 'for')) return { kind: 'intent', intent: { kind: 'act', action: { type: 'fold' } } };
    if (words.length <= 2 && words.every((w) => ['all', 'in', 'up', 'allin'].includes(w))) {
      return { kind: 'intent', intent: { kind: 'act', action: { type: 'allIn' } } };
    }
  }

  if (has('undo')) return { kind: 'intent', intent: { kind: 'undo' } };

  // Winner declaration at showdown (names + win/split).
  if (has('win') || has('split')) {
    const named = matchNames(words, players);
    if (named.length > 0) {
      if (!hand || hand.street !== 'showdown') return { kind: 'reject', reason: 'No showdown yet' };
      const open = hand.pots.map((p, i) => ({ p, i })).filter((x) => !x.p.paid);
      if (open.length === 0) return { kind: 'reject', reason: 'All pots are already awarded' };
      let target = open[0]!;
      const side = words.indexOf('side');
      if (has('main')) target = open.find((x) => x.i === 0) ?? target;
      else if (side >= 0) {
        const n = NUM_WORD[words[side + 1] === 'pot' ? words[side + 2] ?? '' : words[side + 1] ?? ''] ?? Number(words[side + 2] ?? words[side + 1]) ;
        const wanted = Number.isInteger(n) && n > 0 ? n : 1;
        const found = open.find((x) => x.i === wanted);
        if (!found) return { kind: 'reject', reason: `No side pot ${wanted} to award` };
        target = found;
      }
      const eligible = named.filter((pl) => target.p.eligible.includes(pl.id));
      if (eligible.length === 0) return { kind: 'reject', reason: `${named.map((n) => n.name).join(' and ')} not in that pot` };
      return { kind: 'intent', intent: { kind: 'award', pot: target.i, winners: eligible.map((e) => e.id) } };
    }
  }

  if (has('deal') && !has('dealer')) {
    if (hand && hand.street !== 'complete') return { kind: 'reject', reason: 'The current hand is not finished' };
    return { kind: 'intent', intent: { kind: 'startHand' } };
  }

  // Questions answer immediately; they change nothing.
  if (hand?.toActId && (has('what') || has('whats') || has('how') || has('who') || has('whos'))) {
    const l = legalActions(state);
    const actor = state.players[hand.toActId]?.name ?? 'Nobody';
    if (has('who') || has('whos')) return { kind: 'query', answer: `${actor} is up` };
    if (has('call')) return { kind: 'query', answer: l && l.toCall > 0 ? `${l.toCall} to call` : 'Nothing to call' };
    if (has('pot')) return { kind: 'query', answer: `The pot is ${potSize(hand)}` };
  }

  // Betting commands only mean something while someone is to act.
  if (!hand?.toActId) return { kind: 'none' };
  const l = legalActions(state)!;
  const actor = state.players[hand.toActId]!;

  const verbAt = words.findIndex((w, i) => (ACTION_WORDS.has(w) && (w !== 'make' || words[i + 1] === 'it')) || w === 'min' || w === 'pot' || w === 'half');
  if (verbAt < 0) return { kind: 'none' };

  const named = matchNames(words, players);
  const other = named.find((n) => n.id !== actor.id);
  if (other && !named.some((n) => n.id === actor.id)) return { kind: 'reject', reason: `${actor.name} is up, not ${other.name}` };

  const verb = words[verbAt]!;
  switch (verb) {
    case 'allin': return { kind: 'intent', intent: { kind: 'act', action: { type: 'allIn' } } };
    case 'fold': return { kind: 'intent', intent: { kind: 'act', action: { type: 'fold' } } };
    case 'check': return { kind: 'intent', intent: { kind: 'act', action: { type: 'check' } } };
    case 'call': return { kind: 'intent', intent: { kind: 'act', action: { type: 'call' } } };
  }

  // raise / bet / make it / min / pot / half pot
  const streetBet = hand.streetBet;
  const afterVerb = words.slice(verbAt + 1);
  const wantsPot = words.includes('pot') && !words.includes('side');
  let to: number | null = null;
  if (words.includes('min')) to = l.minTo;
  else if (words.includes('half') && wantsPot) to = l.halfPotTo;
  else if (wantsPot && !words.includes('allin')) to = l.potTo;
  else {
    const byAt = afterVerb.indexOf('by');
    const amount = extractAmount(byAt >= 0 ? afterVerb.slice(byAt + 1) : afterVerb);
    if (amount === null) {
      // A bare "raise" means the minimum raise; the confirmation shows the amount.
      return verb === 'raise' ? { kind: 'intent', intent: { kind: 'act', action: { type: 'raise', to: l.minTo } } } : { kind: 'none' };
    }
    to = byAt >= 0 ? streetBet + amount : amount;
  }
  return { kind: 'intent', intent: { kind: 'act', action: { type: 'raise', to } } };
}

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'yea', 'confirm', 'confirmed', 'conform', 'confirms']);
const NO = new Set(['no', 'nope', 'nah', 'know', 'cancel', 'cancelled', 'canceled', 'cancer', 'council', 'counsel', 'cancels']);
const FILLER = new Set(['that', 'it', 'please', 'the']);

/**
 * While a confirmation is open only yes / no count (plus "confirm" / "cancel");
 * everything else is ignored so table talk can't change a pending command.
 */
export function parseConfirmation(transcript: string, plainOnly = false): 'confirm' | 'cancel' | null {
  // plainOnly: just yes/no words. Used while we are speaking, since our own "Confirm?" must not answer itself.
  if (plainOnly) {
    const w = transcript.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (w.length === 0 || w.length > 2) return null;
    if (w.every((x) => ['yes', 'yeah', 'yep', 'yup', 'yea'].includes(x))) return 'confirm';
    if (w.every((x) => ['no', 'nope', 'nah'].includes(x))) return 'cancel';
    return null;
  }
  const words = transcript.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  if (!words.every((w) => YES.has(w) || NO.has(w) || FILLER.has(w))) return null;
  const yes = words.some((w) => YES.has(w));
  const no = words.some((w) => NO.has(w));
  if (yes === no) return null;
  return yes ? 'confirm' : 'cancel';
}
