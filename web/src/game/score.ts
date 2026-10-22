/** ScoreV1 mod multipliers. Mods not listed are 1. */
const MOD_MULTIPLIERS: Record<string, number> = {
  EZ: 0.5,
  NF: 0.5,
  HT: 0.3,
  HR: 1.06,
  HD: 1.06,
  DT: 1.12,
  NC: 1.12,
  FL: 1.12,
  SO: 0.9,
};

/** Product of the ScoreV1 multipliers for the active mods. */
export function modMultiplier(mods: string[]): number {
  return mods.reduce((m, mod) => m * (MOD_MULTIPLIERS[mod] ?? 1), 1);
}

/**
 * ScoreV1 difficulty multiplier. Uses the map's ORIGINAL HP/CS/OD (mods do not change them),
 * the object count, and the drain time in seconds (breaks excluded).
 */
export function difficultyMultiplier(hp: number, cs: number, od: number, objectCount: number, drainSeconds: number): number {
  const density = Math.min(16, Math.max(0, (objectCount / Math.max(1, drainSeconds)) * 8));
  return Math.round(((hp + cs + od + density) / 38) * 5);
}

/**
 * Points for a judged hit (circle, slider overall, spinner overall):
 * base + base × (max(0, comboBefore − 1) × difficulty × mod / 25), floored.
 */
export function hitPoints(base: number, comboBefore: number, difficulty: number, mod: number): number {
  const comboMultiplier = Math.max(0, comboBefore - 1);
  return base + Math.floor((base * comboMultiplier * difficulty * mod) / 25);
}

/** Points for a spinner's spins: 100 per spin up to the requirement, 1100 per bonus spin. */
export function spinnerSpinPoints(spins: number, required: number): number {
  const n = Math.floor(spins);
  return Math.min(n, required) * 100 + Math.max(0, n - required) * 1100;
}

/** Flat stable slider-part points (not multiplied): 10 for a tick, 30 for head/repeat/tail. */
export function sliderPartPoints(kind: 'head' | 'tick' | 'repeat' | 'tail'): number {
  if (kind === 'head') return 30;
  return kind === 'tick' ? 10 : 30;
}
