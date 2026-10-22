/** Calculate the final selectable playback position in osu! map milliseconds.
 * A replay's audio can extend beyond the last gameplay object (song outro);
 * don't cut it off just because the beatmap is finished.
 */
export function playbackEndTime(lastObjectTime: number, audioDurationMs: number): number {
  const last = Number.isFinite(lastObjectTime) ? Math.max(0, lastObjectTime + 500) : 0;
  const audio = Number.isFinite(audioDurationMs) ? Math.max(0, audioDurationMs) : 0;
  return Math.max(1, last, audio);
}
