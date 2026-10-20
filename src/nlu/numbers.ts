const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const THOUSAND = new Set(['thousand', 'grand', 'k']);
const DIGITS = /^\d[\d,]*(\.\d+)?$/;
const DIGITS_K = /^(\d[\d,]*(\.\d+)?)k$/;

type Tok = { kind: 'unit' | 'tens' | 'hundred' | 'thousand' | 'digits'; value: number };

function classify(word: string): Tok | null {
  if (word in UNITS) return { kind: 'unit', value: UNITS[word]! };
  if (word in TENS) return { kind: 'tens', value: TENS[word]! };
  if (word === 'hundred') return { kind: 'hundred', value: 100 };
  if (THOUSAND.has(word)) return { kind: 'thousand', value: 1000 };
  const k = DIGITS_K.exec(word);
  if (k) return { kind: 'digits', value: Math.round(Number(k[1]!.replace(/,/g, '')) * 1000) };
  if (DIGITS.test(word)) return { kind: 'digits', value: Math.round(Number(word.replace(/,/g, ''))) };
  return null;
}

/**
 * First spoken amount in the words, or null. Handles "two hundred fifty", "250",
 * "2k", "fifteen hundred" and poker shorthand like "two fifty" (250).
 */
export function extractAmount(words: string[]): number | null {
  // Gather the first run of number-ish words ("and" may sit inside a run).
  const run: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const tok = classify(w);
    if (tok) run.push(tok);
    else if (w === 'and' && run.length > 0 && classify(words[i + 1] ?? '')) continue;
    else if (run.length > 0) break;
  }
  if (run.length === 0) return null;

  // Shorthand: a single digit followed by a tens/teen/number 10-99 with no hundred/thousand.
  const first = run[0]!;
  const second = run[1];
  const hasMultiplier = run.some((t) => t.kind === 'hundred' || t.kind === 'thousand');
  if (
    !hasMultiplier && second && first.value >= 1 && first.value <= 9 && (first.kind === 'unit' || first.kind === 'digits') &&
    ((second.kind === 'tens' || second.kind === 'unit' || second.kind === 'digits') && second.value >= 10 && second.value <= 99)
  ) {
    const rest = run.slice(1).reduce((n, t) => n + t.value, 0);
    return first.value * 100 + rest;
  }
  // Two bare digit groups such as "2" "50" were handled above; otherwise take the first digit token whole.
  if (run.every((t) => t.kind === 'digits')) return first.value;

  let total = 0;
  let cur = 0;
  for (const t of run) {
    if (t.kind === 'hundred') cur = (cur || 1) * 100;
    else if (t.kind === 'thousand') {
      total += (cur || 1) * 1000;
      cur = 0;
    } else cur += t.value;
  }
  return total + cur;
}
