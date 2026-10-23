import { describe, expect, it } from 'vitest';
import { judge } from '../src/game/judge';
import { spinnerHalfSpinsRequired, type PreparedMap, type SpinnerObj } from '../src/game/prepare';
import { KEY, type ReplayFrame } from '../src/load/replay';

const START = 1000;
const END = 3000;
const CENTER_X = 256;
const CENTER_Y = 192;
const RADIUS = 70;

function spinnerMap(spinsRequired = 5): PreparedMap {
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

describe('stable half-spin spinner accumulation and thresholds', () => {
  it('uses stable half-spin requirement from OD and duration', () => {
    expect(spinnerHalfSpinsRequired(5, 2000)).toBe(10); // 5 half-spins/s × 2s
    expect(spinnerHalfSpinsRequired(8, 2000)).toBe(13); // (2.5 + 0.5 × 8) × 2
    expect(spinnerHalfSpinsRequired(0, 2000)).toBe(6); // 3 half-spins/s × 2s
  });

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

  it('adds at most one half-spin for a single frame, as stable does', () => {
    const frames: ReplayFrame[] = [
      { t: START, x: CENTER_X + RADIUS, y: CENTER_Y, keys: KEY.M1 },
      { t: END, x: CENTER_X - RADIUS, y: CENTER_Y, keys: KEY.M1 },
    ];
    const judged = judge(spinnerMap(), frames);
    expect(judged.objects[0].halfSpins).toBe(1);
    expect(judged.objects[0].result).toBe(0); // below the 25% miss threshold
  });

  it('does not credit time spent with no key held', () => {
    const frames = spinFrames((s) => s * 5, 10, (t) => t < 2000);
    // One second of held spinning at 5 rps. The first frame establishes the
    // reference angle, so the counted total is one sampling step short.
    expect(rotations(frames)).toBeGreaterThan(4.4);
    expect(rotations(frames)).toBeLessThan(4.6);
  });

  it('passes accumulated half-spins and bonus points into ScoreV1 after a reversal', () => {
    const normal = judge(spinnerMap(), spinFrames((s) => s * 4.6));
    const reversing = judge(spinnerMap(), spinFrames((s) => s <= 1 ? s * 4.6 : 4.6 - (s - 1) * 4.6));
    expect(reversing.objects[0].result).toBe(300);
    expect(reversing.totalScore).toBe(normal.totalScore);
    expect(reversing.totalScore).toBeGreaterThan(300);
    expect(reversing.events.at(-1)?.score).toBe(reversing.totalScore);
    expect(reversing.scoring.some((event) => event.flat > 0)).toBe(true);
  });

  it('uses stable 300/100/50/miss spinner thresholds', () => {
    const result = (rps: number) => judge(spinnerMap(), spinFrames((s) => s * rps)).objects[0].result;
    // Required = 10 half-spins; 300 needs >10, 100 needs >8, miss below 2.
    expect(result(5)).toBe(300);
    expect(result(2.4)).toBe(100); // 9.6 half-spins, floors to 9
    expect(result(1.5)).toBe(50);
    expect(result(0.25)).toBe(0);
    expect(result(0)).toBe(0);
  });

  it('records the judged spin range and stable bonus tick timestamps', () => {
    const judged = judge(spinnerMap(), spinFrames((s) => s * 5));
    expect(judged.objects[0].halfSpins).toBeGreaterThan(10);
    const range = judged.objects[0].spinnerSpinRange!;
    expect(range[0]).toBeGreaterThanOrEqual(START);
    expect(range[1]).toBeLessThanOrEqual(END);
    expect(range[1]).toBeGreaterThan(range[0]);
    const bonuses = judged.objects[0].spinnerBonusTicks!;
    expect(bonuses.length).toBeGreaterThan(0);
    expect(bonuses).toEqual([...bonuses].sort((a, b) => a - b));
    expect(bonuses.every((t) => t >= START && t <= END)).toBe(true);
  });
});
