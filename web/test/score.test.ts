import { describe, expect, it } from 'vitest';
import { difficultyMultiplier, hitPoints, modMultiplier, sliderPartPoints, spinnerSpinPoints } from '../src/game/score';

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

  it('spinner: 100 per spin up to the requirement, 1100 per bonus spin', () => {
    expect(spinnerSpinPoints(3.9, 5)).toBe(300);
    expect(spinnerSpinPoints(7, 5)).toBe(5 * 100 + 2 * 1100);
  });

  it('clamps the stable ScoreV1 difficulty multiplier to 2..6', () => {
    // Very easy maps must not produce a zero score multiplier.
    expect(difficultyMultiplier(0, 0, 0, 0, 60)).toBe(2);
    expect(difficultyMultiplier(1, 1, 1, 1, 600)).toBe(2);
    // Extreme density and max HP/CS/OD should never exceed six.
    expect(difficultyMultiplier(10, 10, 10, 2000, 60)).toBe(6);
  });

  it('difficulty multiplier from original values, density clamped to 16', () => {
    // density 2000/60×8 = 266 → clamped to 16; (5 + 4 + 9 + 16) / 38 × 5 = 4.47 → 4
    expect(difficultyMultiplier(5, 4, 9, 2000, 60)).toBe(4);
    // (4 + 3 + 6 + 0) / 38 × 5 = 2.1 → 2 (no objects → density 0)
    expect(difficultyMultiplier(4, 3, 6, 0, 60)).toBe(2);
  });
});
