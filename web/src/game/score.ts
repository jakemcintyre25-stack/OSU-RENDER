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

/** Product of ScoreV1 multipliers; speed-mod aliases are never applied twice. */
export function modMultiplier(mods: string[]): number {
  // NC includes DT, and DC is the pitch-shifted variant of HT.
  // Using a Set also guards duplicate names from external callers.
  const active = new Set(mods);
  if (active.has('NC')) active.delete('DT');
  if (active.has('DC')) {
    active.delete('DC');
    active.add('HT');
  }
  return [...active].reduce((m, mod) => m * (MOD_MULTIPLIERS[mod] ?? 1), 1);
}

/** C# `Math.Round` default: round midpoint values to the nearest even integer. */
export function roundTiesEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

/**
 * osu!stable's ScoreV1 drain length, in truncated whole seconds.
 *
 * Stable sums EVERY break — overlapping and out-of-range breaks are not
 * unioned or clipped — after rounding each endpoint with banker's rounding,
 * then performs integer division by 1000. This reproduces a stable quirk that
 * the previous union/clipping implementation intentionally "fixed" but which
 * is required for exact score parity.
 */
export function stableDrainSeconds(
  firstStart: number,
  lastStart: number,
  breaks: ReadonlyArray<{ start: number; end: number }>,
): number {
  const first = roundTiesEven(firstStart);
  const last = roundTiesEven(lastStart);
  const breakMs = breaks.reduce(
    (sum, b) => sum + (roundTiesEven(b.end) - roundTiesEven(b.start)),
    0,
  );
  return Math.trunc((last - first - breakMs) / 1000);
}

/**
 * ScoreV1 difficulty multiplier. Uses the map's ORIGINAL HP/CS/OD (mods do not change them),
 * the object count, and stable's integer-second drain length.
 *
 * Stable's source path has no 2..6 clamp: the rounded value is used directly.
 * A zero drain length means density 16 (the `CalculateDifficultyPeppyStars`
 * branch), not a guard against division by zero.
 */
export function difficultyMultiplier(hp: number, cs: number, od: number, objectCount: number, drainSeconds: number): number {
  const density = drainSeconds !== 0
    ? Math.min(16, Math.max(0, (objectCount / drainSeconds) * 8))
    : 16;
  return roundTiesEven(((hp + cs + od + density) / 38) * 5);
}

/**
 * Points for a judged hit (circle, slider overall, spinner overall).
 *
 * Stable multiplies the hit value by `(unsigned long long)(combo × difficulty
 * × mod)`, i.e. it truncates the combined multiplier to an integer BEFORE
 * applying the hit value and dividing by 25. Keeping the fractional product
 * here over-scores every object on maps with non-integral mod multipliers.
 */
export function hitPoints(base: number, comboBefore: number, difficulty: number, mod: number): number {
  const comboMultiplier = Math.max(0, comboBefore - 1);
  const combined = Math.trunc(comboMultiplier * difficulty * mod);
  return base + Math.floor((base * combined) / 25);
}

/**
 * Points for a spinner's rotations, using osu!stable's HALF-spin accounting.
 *
 * Stable awards 100 on every even half-spin after the first one (i.e. per full
 * spin), and 1100 instead once the count passes `required + 3` half-spins and
 * matches its parity. This leaves a 1.5-spin gap after completion before the
 * first 1000-point bonus, unlike the simpler "bonus immediately after
 * completion" wording in the wiki.
 */
export function spinnerSpinPoints(halfSpins: number, requiredHalfSpins: number): number {
  const n = Math.floor(halfSpins);
  let points = 0;
  for (let count = 2; count <= n; count++) {
    const bonusThreshold = requiredHalfSpins + 3;
    if (count > bonusThreshold && (count - bonusThreshold) % 2 === 0) points += 1100;
    else if (count > 1 && count % 2 === 0) points += 100;
  }
  return points;
}

/** Flat stable slider-part points (not multiplied): 10 for a tick, 30 for head/repeat/tail. */
export function sliderPartPoints(kind: 'head' | 'tick' | 'repeat' | 'tail'): number {
  if (kind === 'head') return 30;
  return kind === 'tick' ? 10 : 30;
}
