/** Intervals when osu!standard HP may drain, excluding declared map breaks.
 *
 * This is a timing foundation, NOT an implementation of osu!stable's HP
 * drain/gain calibration or HP-zero failure rules. The returned intervals are
 * half-open [start,end), in unmodded map milliseconds.
 */
export type TimeInterval = readonly [number, number];

export function activeDrainIntervals(
  start: number,
  end: number,
  breaks: ReadonlyArray<{ start: number; end: number }>,
): TimeInterval[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    throw new RangeError('Invalid HP drain timeline');
  }
  const clipped = breaks.map(b => {
    if (!Number.isFinite(b.start) || !Number.isFinite(b.end) || b.start < 0 || b.end < b.start) {
      throw new RangeError('Invalid beatmap break');
    }
    return [Math.max(start, b.start), Math.min(end, b.end)] as const;
  }).filter(([a,b]) => a < b).sort((a,b) => a[0] - b[0]);
  if (start === end) return [];
  const out: TimeInterval[] = [];
  let cursor = start;
  for (const [a,b] of clipped) {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) out.push([cursor, end]);
  return out;
}

export function activeDrainMilliseconds(
  start: number,
  end: number,
  breaks: ReadonlyArray<{ start: number; end: number }>,
): number {
  return activeDrainIntervals(start, end, breaks).reduce((sum, [a,b]) => sum + b - a, 0);
}
