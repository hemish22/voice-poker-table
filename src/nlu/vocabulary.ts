import type { Player } from '../engine/types';

const NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'grand', 'k', 'and',
];

const COMMANDS = [
  'table', 'tablet', 'hey', 'okay', 'ok',
  'fold', 'check', 'call', 'raise', 'bet', 'all', 'in', 'shove', 'jam', 'to', 'by', 'min', 'minimum', 'pot', 'half', 'make', 'it',
  'undo', 'go', 'back', 'deal', 'next', 'new', 'hand',
  'yes', 'yeah', 'yep', 'no', 'nope', 'nah', 'confirm', 'cancel',
  'win', 'wins', 'won', 'split', 'chop', 'main', 'side', 'between',
  'what', "what's", 'whats', 'how', 'much', 'who', "who's", 'whos', 'up', 'size', 'the', 'seat', 'player', 'number',
];

/** Everything the offline recognizer is allowed to hear: poker commands, spoken numbers, and player names. */
export function vocabulary(players: Pick<Player, 'name'>[]): string[] {
  const names = players.flatMap((p) => p.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 0));
  return [...new Set([...COMMANDS, ...NUMBERS, ...names])];
}
