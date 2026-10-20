/** Position labels for display, in order from button clockwise. */
export function positionLabels(n: number): string[] {
  if (n === 2) return ['BTN/SB', 'BB'];
  const fixed = ['BTN', 'SB', 'BB', 'UTG'];
  if (n <= 4) return fixed.slice(0, n);
  // Remaining seats after UTG, ending with CO and HJ.
  const tail = ['UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'];
  const extra = n - 4;
  return [...fixed, ...tail.slice(tail.length - extra)];
}
