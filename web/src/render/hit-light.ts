/** Default-skin hit lighting: a short white bloom behind a hit object. */
export interface HitLightState {
  visible: boolean;
  alpha: number;
  scale: number;
}

export function hitLightState(t: number, hitTime: number | null, duration = 160): HitLightState {
  if (hitTime === null || !Number.isFinite(t) || !Number.isFinite(hitTime)) {
    return { visible: false, alpha: 0, scale: 1 };
  }
  if (!(duration > 0)) return { visible: false, alpha: 0, scale: 1 };
  const progress = (t - hitTime) / duration;
  if (progress < 0 || progress >= 1) {
    return { visible: false, alpha: 0, scale: 1 };
  }
  return {
    visible: true,
    alpha: (1 - progress) * 0.55,
    scale: 1 + progress * 0.8,
  };
}
