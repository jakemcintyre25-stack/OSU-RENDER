/** Seek to a point just before the judgement, without leaving the song timeline.
 * Marker times are in unmodded map milliseconds: the Web Audio clock applies
 * DT/HT and viewer speed separately.
 */
export function markerReviewTime(eventMapTime: number, rewindMilliseconds = 2000): number {
  if (!Number.isFinite(eventMapTime) || eventMapTime < 0 ||
      !Number.isFinite(rewindMilliseconds) || rewindMilliseconds < 0) return 0;
  return Math.max(0, eventMapTime - rewindMilliseconds);
}
