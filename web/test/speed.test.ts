import { describe, expect, it } from 'vitest';
import { checkedPlayerSpeed, effectivePlaybackRate, PLAYER_SPEEDS } from '../src/audio/speed';

describe('viewer speed on top of osu! mod timebase', () => {
  it('preserves normal timing at 1x and scales every supported viewer speed', () => {
    for (const speed of PLAYER_SPEEDS) {
      expect(effectivePlaybackRate(1, speed)).toBe(speed);
      expect(effectivePlaybackRate(1.5, speed)).toBeCloseTo(1.5 * speed);
      expect(effectivePlaybackRate(0.75, speed)).toBeCloseTo(0.75 * speed);
    }
  });

  it('ignores malformed saved speeds instead of silently altering replay tempo', () => {
    for (const speed of [-1, 0, NaN, Infinity, 0.123456, 3]) {
      expect(checkedPlayerSpeed(speed)).toBe(1);
      expect(effectivePlaybackRate(1.5, speed)).toBe(1.5);
    }
  });

  it('refuses invalid mod source rates', () => {
    for (const invalid of [0, -1, NaN, Infinity, 4]) {
      expect(() => effectivePlaybackRate(invalid, 1)).toThrow(/Invalid mod/);
    }
  });
});
