/** Playback speed is a viewer preference, independent of scored osu! mods.
 * Playback has to use the effective map-time rate including DT/NC/HT,
 * otherwise the renderer, hitsounds and cursor become desynchronized.
 */
export const PLAYER_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function checkedPlayerSpeed(raw: number): number {
  return PLAYER_SPEEDS.some(speed => speed === raw) ? raw : 1;
}

export function effectivePlaybackRate(modMapRate: number, viewerSpeed: number): number {
  if (!Number.isFinite(modMapRate) || modMapRate <= 0 || modMapRate > 3) {
    throw new Error('Invalid mod playback rate');
  }
  return modMapRate * checkedPlayerSpeed(viewerSpeed);
}
