/** osu!standard Flashlight geometry.
 *
 * Combo scales and the break-time expansion follow osu!'s
 * `ModFlashlight.DefaultFlashlightSize` (125 playfield units) and the stable
 * scales documented in `ModFlashlight<T>.Flashlight.GetComboScaleFor`:
 * 1.0 below 100x, 0.8125 at 100–199x, 0.625 at 200x+, and 2.5x during breaks.
 * The original client animates between these sizes; this module exposes the
 * target geometry, not a claim of frame-identical animation.
 */
export const FLASHLIGHT_BASE_SIZE = 125;
export const FLASHLIGHT_BREAK_SCALE = 2.5;

export function flashlightComboScale(combo: number): number {
  const value = Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
  if (value >= 200) return 0.625;
  if (value >= 100) return 0.8125;
  return 1;
}

/** Visible radius in osu! playfield units. */
export function flashlightRadius(combo: number, inBreak: boolean): number {
  return FLASHLIGHT_BASE_SIZE * (inBreak ? FLASHLIGHT_BREAK_SCALE : flashlightComboScale(combo));
}

/** Extra dim applied to the visible area while a slider is being tracked. */
export function flashlightTrackDim(tracking: boolean): number {
  return tracking ? 0.8 : 0;
}
