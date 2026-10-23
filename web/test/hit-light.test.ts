import { describe, expect, it } from 'vitest';
import { hitLightState } from '../src/render/hit-light';

describe('default-skin hit lighting', () => {
  it('is hidden before the hit and after the bloom ends', () => {
    expect(hitLightState(100, null).visible).toBe(false);
    expect(hitLightState(99, 100).visible).toBe(false);
    expect(hitLightState(260, 100, 160).visible).toBe(false);
  });

  it('fades and expands over the bloom duration', () => {
    const start = hitLightState(100, 100, 160);
    const middle = hitLightState(180, 100, 160);
    expect(start.visible).toBe(true);
    expect(start.alpha).toBeCloseTo(0.55);
    expect(start.scale).toBe(1);
    expect(middle.alpha).toBeLessThan(start.alpha);
    expect(middle.scale).toBeGreaterThan(start.scale);
  });

  it('rejects an invalid duration instead of showing a permanent bloom', () => {
    expect(hitLightState(100, 100, 0).visible).toBe(false);
    expect(hitLightState(100, 100, -1).visible).toBe(false);
  });
});
