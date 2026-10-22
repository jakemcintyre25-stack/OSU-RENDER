import { describe, expect, it } from 'vitest';
import { judge } from '../src/game/judge';
import type { PreparedMap, SpinnerObj } from '../src/game/prepare';
import { KEY, type ReplayFrame } from '../src/load/replay';

const START = 1000;
const END = 3000;
const CENTER_X = 256;
const CENTER_Y = 192;
const RADIUS = 70;

function spinnerMap(spinsRequired = 8): PreparedMap {
  const spinner: SpinnerObj = {
    index: 0, kind: 'spinner', start: START, end: END,
    x: CENTER_X, y: CENTER_Y, comboNumber: 1,
    comboColor: 0xffffff, newCombo: true, spinsRequired,
  };
  return {
    title: 'Synthetic spinner', artist: 'Test', version: 'Standard',
    creator: 'Tests', mods: [], rate: 1, cs: 4, ar: 5, od: 5, hp: 5,
    scoreDifficulty: 2,
    radius: 32, preempt: 1200, fadeIn: 400, hidden: false,
    objects: [spinner], comboColors: [0xffffff],
    audioFile: null, backgroundFile: null, breaks: [],
    firstObjectTime: START, lastObjectTime: END,
  };
}

function spinFrames(
  revolutionsAt: (seconds: number) => number,
  stepMs = 10,
  heldAt: (ms: number) => boolean = () => true,
): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  for (let t = START; t <= END; t += stepMs) {
    const theta = 2 * Math.PI * revolutionsAt((t - START) / 1000);
    frames.push({
      t, x: CENTER_X + RADIUS * Math.cos(theta),
      y: CENTER_Y + RADIUS * Math.sin(theta),
      keys: heldAt(t) ? KEY.M1 : 0,
    });
  }
  return frames;
}

const rotations = (frames: ReplayFrame[]) => judge(spinnerMap(), frames).objects[0].spins ?? 0;

describe('spinner rotation accumulation and RPM limit', () => {
  it('awards equal spins in clockwise and counterclockwise directions', () => {
    const clockwise = rotations(spinFrames((s) => s * 5));
    const counterClockwise = rotations(spinFrames((s) => -s * 5));
    expect(clockwise).toBeCloseTo(10, 1);
    expect(counterClockwise).toBeCloseTo(clockwise, 1);
  });

  it('counts continued valid rotation after a direction reversal', () => {
    const frames = spinFrames((s) => s <= 1 ? s * 5 : 5 - (s - 1) * 5);
    expect(rotations(frames)).toBeGreaterThan(9.5);
    expect(judge(spinnerMap(), frames).objects[0].result).toBe(300);
  });

  it('caps implausibly fast movement to approximately 477 RPM', () => {
    // 25 rps at 1ms gives unambiguous per-frame angles but exceeds stable's cap.
    const fast = rotations(spinFrames((s) => s * 25, 1));
    expect(fast).toBeLessThanOrEqual(2 * 477 / 60 + 0.01);
    expect(fast).toBeGreaterThan(2 * 7.5);
  });

  it('does not credit time spent with no key held', () => {
    const frames = spinFrames((s) => s * 5, 10, (t) => t < 2000);
    expect(rotations(frames)).toBeGreaterThan(4.8);
    expect(rotations(frames)).toBeLessThan(5.1);
  });

  it('passes accumulated spins and bonus points into ScoreV1 after a reversal', () => {
    const normal = judge(spinnerMap(), spinFrames((s) => s * 4.6));
    const reversing = judge(spinnerMap(), spinFrames((s) => s <= 1 ? s * 4.6 : 4.6 - (s - 1) * 4.6));
    expect(reversing.objects[0].result).toBe(300);
    expect(reversing.totalScore).toBe(normal.totalScore);
    expect(reversing.totalScore).toBeGreaterThan(300);
    expect(reversing.events.at(-1)?.score).toBe(reversing.totalScore);
    expect(reversing.scoring.some((event) => event.flat > 0)).toBe(true);
  });

  it('retains the defined 300/100/50/miss spinner thresholds', () => {
    const result = (rps: number) => judge(spinnerMap(), spinFrames((s) => s * rps)).objects[0].result;
    expect(result(5)).toBe(300);
    expect(result(3.6)).toBe(100);
    expect(result(1.5)).toBe(50);
    expect(result(0)).toBe(0);
  });
});
