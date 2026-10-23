import { describe, expect, it } from 'vitest';
import { difficultyMultiplier, hitPoints, modMultiplier, roundTiesEven, sliderPartPoints, spinnerSpinPoints, stableDrainSeconds } from '../src/game/score';

describe('ScoreV1 helpers', () => {
  it('first hit of a combo gets no combo bonus', () => {
    expect(hitPoints(300, 0, 5, 1)).toBe(300);
    expect(hitPoints(300, 1, 5, 1)).toBe(300);
  });

  it('combo bonus uses comboBefore minus one and the difficulty and mod multipliers', () => {
    // 300 + floor(300 × 10 × 5 × 1.06 / 25) = 300 + 636
    expect(hitPoints(300, 11, 5, 1.06)).toBe(936);
    // 100 + floor(100 × 3 × 4 / 25) = 100 + 48
    expect(hitPoints(100, 4, 4, 1)).toBe(148);
  });

  it('truncates combo × difficulty × mod before applying the hit value', () => {
    // Stable casts the combined multiplier to an integer first:
    // 10 × 4 × 1.06 = 42.4 → 42; 300 + floor(300 × 42 / 25) = 804.
    // Keeping 42.4 would incorrectly produce 808.
    expect(hitPoints(300, 11, 4, 1.06)).toBe(804);
  });

  it('mod multipliers multiply', () => {
    expect(modMultiplier([])).toBe(1);
    expect(modMultiplier(['HD', 'HR'])).toBeCloseTo(1.1236, 6);
    expect(modMultiplier(['DT'])).toBe(1.12);
  });

  it('treats NC as DT and DC as HT without stacking alias multipliers', () => {
    expect(modMultiplier(['NC', 'DT'])).toBeCloseTo(1.12);
    expect(modMultiplier(['HT', 'DC'])).toBeCloseTo(0.3);
    expect(modMultiplier(['DC'])).toBeCloseTo(0.3);
    expect(modMultiplier(['HD', 'NC', 'DT'])).toBeCloseTo(1.06 * 1.12);
  });

  it('slider parts are flat: ticks 10, heads, repeats and tails 30', () => {
    expect(sliderPartPoints('tick')).toBe(10);
    expect(sliderPartPoints('repeat')).toBe(30);
    expect(sliderPartPoints('tail')).toBe(30);
    expect(sliderPartPoints('head')).toBe(30);
  });

  it('spinner: stable half-spin ticks, 1.5-spin bonus gap and 1100 bonus ticks', () => {
    // Half-spins: 100 only on even counts, 1100 only after required + 3.
    expect(spinnerSpinPoints(1, 10)).toBe(0);
    expect(spinnerSpinPoints(13, 10)).toBe(6 * 100);
    expect(spinnerSpinPoints(15, 10)).toBe(7 * 100 + 1100);
    expect(spinnerSpinPoints(18, 10)).toBe(9 * 100 + 2 * 1100);
  });

  it('uses stable banker rounding and does not clamp the multiplier to 2..6', () => {
    // (5 + 4 + 10 + 0) / 38 × 5 = 2.5 → ties-to-even = 2 (Math.round would give 3)
    expect(difficultyMultiplier(5, 4, 10, 0, 60)).toBe(2);
    // Extreme density and max HP/CS/OD: 46 / 38 × 5 = 6.05 → 6
    expect(difficultyMultiplier(10, 10, 10, 2000, 60)).toBe(6);
    // The stable source path does not raise very low results to 2.
    expect(difficultyMultiplier(1, 1, 1, 0, 60)).toBe(0);
  });

  it('zero drain length means density 16, not a one-second guard', () => {
    expect(difficultyMultiplier(0, 0, 0, 0, 0)).toBe(2); // 16 / 38 × 5 = 2.105 → 2
  });

  it('difficulty multiplier uses density clamped to 16', () => {
    // density 2000/60×8 = 266 → clamped to 16; (5 + 4 + 9 + 16) / 38 × 5 = 4.47 → 4
    expect(difficultyMultiplier(5, 4, 9, 2000, 60)).toBe(4);
    // (4 + 3 + 6 + 0) / 38 × 5 = 1.71 → 2 (no objects → density 0)
    expect(difficultyMultiplier(4, 3, 6, 0, 60)).toBe(2);
  });

  it('stable drain length sums every break and truncates to whole seconds', () => {
    const breaks = [
      { start: 10000, end: 40000 },
      { start: 20000, end: 50000 },
      { start: 49000, end: 60000 },
    ];
    // 100s interval − (30 + 30 + 11)s of summed breaks = 29s.
    expect(stableDrainSeconds(1000, 101000, breaks)).toBe(29);
    expect(stableDrainSeconds(1000, 101000, [{ start: 10000, end: 60000 }])).toBe(50);
    expect(stableDrainSeconds(1000, 61000, [])).toBe(60);
  });

  it('rounds break endpoints with banker rounding', () => {
    expect(roundTiesEven(2.5)).toBe(2);
    expect(roundTiesEven(3.5)).toBe(4);
  });
});
