import { describe, expect, it } from 'vitest';
import { cleanFrames, cursorAt, isScoreV2Mods, REPLAY_LIMITS, SCORE_V2_MOD_BIT, type ReplayFrame } from '../src/load/replay';

const good = (t: number): ReplayFrame => ({ t, x: 256, y: 192, keys: 0 });

describe('replay input safety before judgement and WebGL rendering', () => {
  it('removes legitimate stable seed placeholders and sorts remaining frames', () => {
    const cleaned = cleanFrames([
      good(20),
      { t: -12345, x: 256, y: 192, keys: 0 },
      { t: 15, x: 256, y: -500, keys: 0 },
      good(-100),
      good(0),
    ]);
    expect(cleaned.map((f) => f.t)).toEqual([-100, 0, 20]);
    expect(cursorAt(cleaned, 10).x).toBe(256);
  });

  it('rejects non-finite times and cursor coordinates instead of passing them to the renderer', () => {
    for (const frame of [
      { ...good(10), t: NaN },
      { ...good(10), t: Infinity },
      { ...good(10), x: NaN },
      { ...good(10), x: Infinity },
      { ...good(10), y: -Infinity },
      { ...good(10), x: 1e150 },
      { ...good(10), t: 1e150 },
    ]) {
      expect(() => cleanFrames([frame])).toThrow(/invalid replay/i);
    }
  });

  it('rejects invalid button-state bitmasks', () => {
    for (const keys of [-1, 1.5, NaN, Infinity, 65536]) {
      expect(() => cleanFrames([{ ...good(10), keys }])).toThrow(/invalid replay/i);
    }
    expect(cleanFrames([{ ...good(10), keys: 31 }])).toHaveLength(1);
  });

  it('detects ScoreV2 mods so ScoreV1 totals are not compared against them', () => {
    expect(isScoreV2Mods(0)).toBe(false);
    expect(isScoreV2Mods(SCORE_V2_MOD_BIT)).toBe(true);
    expect(isScoreV2Mods(SCORE_V2_MOD_BIT | 8)).toBe(true);
  });

  it('rejects an excessive number of frames without sorting or allocating another large array', () => {
    const frames = new Array<ReplayFrame>(REPLAY_LIMITS.frames + 1).fill(good(1000));
    expect(() => cleanFrames(frames)).toThrow(/too many replay frames/i);
  });
});
