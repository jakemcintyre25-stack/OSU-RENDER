/** Presentation helpers for the stable-parity HP bar. */
export function healthBarPercent(hp: number, maximum: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (hp / maximum) * 100));
}

/** Stable's bar turns into the low-health colour at 25% or below. */
export function isLowHealth(hp: number, maximum: number): boolean {
  if (!Number.isFinite(hp) || !Number.isFinite(maximum) || maximum <= 0) return true;
  return hp <= maximum * 0.25;
}

/** Whether the replay has reached its calibrated HP-zero failure point. */
export function hpHasFailed(failTime: number | null, t: number): boolean {
  return failTime !== null && Number.isFinite(t) && t >= failTime;
}
