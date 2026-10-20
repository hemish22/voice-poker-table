/** Seat centres as percentages of the stage, listed clockwise starting at the bottom. */
export function seatPositions(n: number): [number, number][] {
  switch (n) {
    case 0: return [];
    case 1: return [[50, 77]];
    case 2: return [[50, 77], [50, 21]];
    case 3: return [[13, 77], [50, 21], [87, 77]];
    case 4: return [[50, 77], [13, 77], [50, 21], [87, 77]];
    default: {
      // Evenly round a wide ellipse, bottom first, going clockwise on screen.
      return Array.from({ length: n }, (_, i) => {
        const theta = Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [50 + 40 * Math.cos(theta), 51 + 31 * Math.sin(theta)] as [number, number];
      });
    }
  }
}

/** Point a fraction of the way from a seat toward the middle of the table (where its chips sit). */
export function towardCentre(pos: [number, number], t = 0.4): [number, number] {
  return [pos[0] + (50 - pos[0]) * t, pos[1] + (51 - pos[1]) * t];
}
