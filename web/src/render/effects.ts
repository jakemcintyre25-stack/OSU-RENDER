/** Default-skin hit lighting. The glow starts on the judged hit and decays
 * independently of the hit circle's own fade. */
export const HIT_LIGHT_MS = 260;

export interface HitLightState {
  visible: boolean;
  alpha: number;
  scale: number;
}

export function hitLightAt(t: number, hitTime: number | null): HitLightState {
  if (hitTime === null || !Number.isFinite(t) || !Number.isFinite(hitTime) || t < hitTime) {
    return { visible: false, alpha: 0, scale: 1 };
  }
  const k = Math.min(1, (t - hitTime) / HIT_LIGHT_MS);
  if (k >= 1) return { visible: false, alpha: 0, scale: 1 };
  return {
    visible: true,
    alpha: (1 - k) * 0.55,
    scale: 1 + 0.6 * k,
  };
}
