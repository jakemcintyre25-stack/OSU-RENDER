import { describe, expect, it } from 'vitest';
import { healthBarPercent, hpHasFailed, isLowHealth } from '../src/render/hp-bar';

describe('HP bar presentation', () => {
  it('maps stable 0..200 health to a clamped percentage', () => {
    expect(healthBarPercent(200, 200)).toBe(100);
    expect(healthBarPercent(100, 200)).toBe(50);
    expect(healthBarPercent(0, 200)).toBe(0);
    expect(healthBarPercent(-5, 200)).toBe(0);
    expect(healthBarPercent(250, 200)).toBe(100);
    expect(healthBarPercent(NaN, 200)).toBe(0);
  });

  it('marks low health at 25% or below', () => {
    expect(isLowHealth(51, 200)).toBe(false);
    expect(isLowHealth(50, 200)).toBe(true);
    expect(isLowHealth(0, 200)).toBe(true);
  });

  it('only reports failure once the calibrated fail time is reached', () => {
    expect(hpHasFailed(null, 1000)).toBe(false);
    expect(hpHasFailed(5000, 4999)).toBe(false);
    expect(hpHasFailed(5000, 5000)).toBe(true);
    expect(hpHasFailed(5000, 5001)).toBe(true);
  });
});
