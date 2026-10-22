import { describe, expect, it } from 'vitest';
import { findPresses, judge } from '../src/game/judge';
import type { CircleObj, PreparedMap } from '../src/game/prepare';
import { KEY, type ReplayFrame } from '../src/load/replay';

function circleMap(starts = [1000], positions = [100]): PreparedMap {
  const objects: CircleObj[] = starts.map((start, index) => ({
    kind: 'circle',
    index,
    start,
    end: start,
    x: positions[index] ?? 100,
    y: 100,
    comboNumber: index + 1,
    comboColor: 0xffffff,
    newCombo: index === 0,
  }));
  return {
    title: 'Synthetic circles',
    artist: 'Test',
    version: 'Standard',
    creator: 'Tests',
    mods: [],
    rate: 1,
    cs: 4,
    ar: 5,
    od: 5,
    hp: 5,
    scoreDifficulty: 2,
    radius: 10,
    preempt: 1200,
    fadeIn: 400,
    hidden: false,
    objects,
    comboColors: [0xffffff],
    audioFile: null,
    backgroundFile: null,
    breaks: [],
    firstObjectTime: starts[0],
    lastObjectTime: starts.at(-1) ?? 0,
  };
}

function singleHit(at: number): ReplayFrame[] {
  return [
    { t: at - 10, x: 100, y: 100, keys: 0 },
    { t: at, x: 100, y: 100, keys: KEY.M1 },
    { t: at + 10, x: 100, y: 100, keys: 0 },
  ];
}

describe('stable hit windows, early clicks and note-lock', () => {
  it('accounts for the provisional 1ms 300-window adjustment', () => {
    // OD 5 has a ±50ms 300 window, with the provisional 1ms adjustment applied.
    expect(judge(circleMap(), singleHit(1049)).objects[0].result).toBe(300);
    expect(judge(circleMap(), singleHit(1050)).objects[0].result).toBe(100);
  });

  it('ignores presses earlier than -400ms, but a click at -400ms misses', () => {
    const attempt = (early: number): ReplayFrame[] => [
      { t: early - 5, x: 100, y: 100, keys: 0 },
      { t: early, x: 100, y: 100, keys: KEY.M1 },
      { t: early + 1, x: 100, y: 100, keys: 0 },
      { t: 1000, x: 100, y: 100, keys: KEY.M1 },
    ];
    expect(judge(circleMap(), attempt(599)).objects[0].result).toBe(300);
    expect(judge(circleMap(), attempt(600)).objects[0].result).toBe(0);
  });

  it('matches a later circle when a press lands inside it instead of an earlier circle', () => {
    const frames: ReplayFrame[] = [
      { t: 990, x: 200, y: 100, keys: 0 },
      { t: 1020, x: 200, y: 100, keys: KEY.M1 },
      { t: 1030, x: 100, y: 100, keys: 0 },
      { t: 1040, x: 100, y: 100, keys: KEY.M1 },
      { t: 1045, x: 200, y: 100, keys: 0 },
      { t: 1050, x: 200, y: 100, keys: KEY.M1 },
    ];
    const judged = judge(circleMap([1000, 1020], [100, 200]), frames);
    expect(judged.objects.map((obj) => obj.hitTime)).toEqual([1040, 1020]);
    expect(judged.objects.map((obj) => obj.result)).toEqual([300, 300]);
  });

  it('recognizes both buttons pressed on the same frame', () => {
    const frames: ReplayFrame[] = [
      { t: 980, x: 100, y: 100, keys: 0 },
      { t: 1000, x: 100, y: 100, keys: KEY.M1 | KEY.M2 },
      { t: 1010, x: 100, y: 100, keys: 0 },
    ];
    expect(findPresses(frames)).toHaveLength(2);
    expect(findPresses(frames).map((press) => press.t)).toEqual([1000, 1000]);
  });
});
