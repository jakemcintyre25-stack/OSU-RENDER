import { describe, expect, it } from 'vitest';
import {
  FLASHLIGHT_BASE_SIZE,
  FLASHLIGHT_BREAK_SCALE,
  flashlightComboScale,
  flashlightRadius,
  flashlightTrackDim,
} from '../src/render/flashlight';

describe('M6 flashlight geometry', () => {
  it('uses stable combo size thresholds', () => {
    expect(flashlightComboScale(0)).toBe(1);
    expect(flashlightComboScale(99)).toBe(1);
    expect(flashlightComboScale(100)).toBe(0.8125);
    expect(flashlightComboScale(199)).toBe(0.8125);
    expect(flashlightComboScale(200)).toBe(0.625);
    expect(flashlightComboScale(9999)).toBe(0.625);
  });

  it('clamps malformed combo values instead of producing a broken radius', () => {
    expect(flashlightComboScale(-10)).toBe(1);
    expect(flashlightComboScale(Number.NaN)).toBe(1);
    expect(flashlightComboScale(99.9)).toBe(1);
  });

  it('expands to the stable break radius and otherwise uses the base size', () => {
    expect(FLASHLIGHT_BASE_SIZE).toBe(125);
    expect(FLASHLIGHT_BREAK_SCALE).toBe(2.5);
    expect(flashlightRadius(0, false)).toBe(125);
    expect(flashlightRadius(100, false)).toBeCloseTo(101.5625, 6);
    expect(flashlightRadius(200, false)).toBeCloseTo(78.125, 6);
    expect(flashlightRadius(9999, true)).toBeCloseTo(312.5, 6);
  });

  it('dims the visible area while a slider is tracked', () => {
    expect(flashlightTrackDim(false)).toBe(0);
    expect(flashlightTrackDim(true)).toBe(0.8);
  });
});
