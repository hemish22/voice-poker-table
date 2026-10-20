/** What speech engines tend to hear when someone says "table". */
const WAKE = new Set(['table', 'tables', 'tablet', 'tabel', 'stable']);
const LEAD_IN = new Set(['hey', 'ok', 'okay', 'hi', 'yo']);

export interface WakeSplit {
  woke: boolean;
  /** What was said after the wake word (or the whole text when there was none). */
  rest: string;
}

/** "table raise to 50" -> { woke: true, rest: "raise to 50" }. The wake word must open the utterance. */
export function splitWake(text: string): WakeSplit {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const norm = (w: string | undefined) => (w ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (LEAD_IN.has(norm(words[i]))) i += 1;
  if (WAKE.has(norm(words[i]))) return { woke: true, rest: words.slice(i + 1).join(' ') };
  return { woke: false, rest: text };
}
