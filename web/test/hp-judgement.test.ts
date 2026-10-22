import { describe, expect, it } from 'vitest';
import { judge } from '../src/game/judge';
import { hpFromJudgement } from '../src/game/hp-judgement';
import type { PreparedMap } from '../src/game/prepare';
import { KEY, type ReplayFrame } from '../src/load/replay';

const map: PreparedMap = {
  title: 'HP integration', artist: 'Test', version: 'Normal', creator: 'Test',
  mods: [], rate: 1, cs: 4, ar: 5, od: 5, hp: 5,
  scoreDifficulty: 2, radius: 20, preempt: 1200, fadeIn: 400, hidden: false,
  objects: [
    { index: 0, kind: 'circle', start: 1000, end: 1000, x: 100, y: 100, comboNumber: 1, comboColor: 0xffffff, newCombo: true },
    { index: 1, kind: 'circle', start: 2000, end: 2000, x: 100, y: 100, comboNumber: 2, comboColor: 0xffffff, newCombo: false },
  ],
  comboColors: [0xffffff], audioFile: null, backgroundFile: null,
  breaks: [{ start: 1300, end: 1700 }],
  firstObjectTime: 1000, lastObjectTime: 2000,
};
const calibration = { initial: 100, maximum: 100, drainPerMs: 0.05 };
const gains = { 0: -10, 50: 1, 100: 3, 300: 10 };

describe('M3 real judgement to explicitly calibrated HP timeline', () => {
  it('replays actual circle judgements while pausing drain during map breaks', () => {
    const frames: ReplayFrame[] = [
      { t: 990, x: 100, y: 100, keys: 0 },
      { t: 1000, x: 100, y: 100, keys: KEY.M1 },
      { t: 1010, x: 100, y: 100, keys: 0 },
    ];
    const result = judge(map, frames);
    expect(result.objects.map(o => o.result)).toEqual([300, 0]);
    const trace = hpFromJudgement(map, result, calibration, gains);
    expect(trace.snapshots[1]).toEqual({ t: 1000, hp: 100 });
    // Active time from 1000 to 2000 is 600ms; drain 30, then miss penalty 10.
    // The miss is judged at 2150, after last object; no extra drain then.
    expect(trace.snapshots.at(-1)?.hp).toBe(60);
    expect(trace.zeroTime).toBeNull();
  });
  it('accepts early press misses without draining before first object', () => {
    const frames: ReplayFrame[] = [
      { t: 640, x: 100, y: 100, keys: 0 },
      { t: 650, x: 100, y: 100, keys: KEY.M1 },
      { t: 660, x: 100, y: 100, keys: 0 },
    ];
    const result = judge(map, frames);
    expect(result.objects[0].result).toBe(0);
    const trace = hpFromJudgement(map, result, calibration, gains);
    expect(trace.snapshots[0]).toEqual({ t: 650, hp: 100 });
    expect(trace.snapshots[1]).toEqual({ t: 650, hp: 90 });
  });
  it('rejects missing or invalid result gain calibration', () => {
    const result = judge(map, []);
    expect(() => hpFromJudgement(map, result, calibration, { ...gains, 300: NaN })).toThrow(RangeError);
  });
});
