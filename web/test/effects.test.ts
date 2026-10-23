import { describe, expect, it } from 'vitest';
import { HIT_LIGHT_MS, hitLightAt } from '../src/render/effects';

describe('default-skin hit lighting', () => {
  it('starts on the judged hit and decays to invisible', () => {
    expect(hitLightAt(0, null)).toEqual({ visible: false, alpha: 0, scale: 1 });
    expect(hitLightAt(999, 1000)).toEqual({ visible: false, alpha: 0, scale: 1 });
    const start = hitLightAt(1000, 1000);
    expect(start.visible).toBe(true);
    expect(start.alpha).toBeCloseTo(0.55, 6);
    const mid = hitLightAt(1000 + HIT_LIGHT_MS / 2, 1000);
    expect(mid.visible).toBe(true);
    expect(mid.alpha).toBeCloseTo(0.275, 6);
    expect(mid.scale).toBeCloseTo(1.3, 6);
    expect(hitLightAt(1000 + HIT_LIGHT_MS, 1000)).toEqual({ visible: false, alpha: 0, scale: 1 });
  });

  it('rejects non-finite input and never lights a miss', () => {
    expect(hitLightAt(NaN, 1000).visible).toBe(false);
    expect(hitLightAt(2000, NaN).visible).toBe(false);
    expect(hitLightAt(2000, null).visible).toBe(false);
  });
});
