import { describe, expect, it } from 'vitest';
import { judge } from '../src/game/judge';
import type { PreparedMap, SliderObj } from '../src/game/prepare';
import { KEY, type ReplayFrame } from '../src/load/replay';

function mapWithSlider(): PreparedMap {
  const slider: SliderObj = {
    index: 0,
    kind: 'slider',
    start: 1000,
    end: 1100,
    x: 100,
    y: 100,
    comboNumber: 1,
    comboColor: 0xffffff,
    newCombo: true,
    path: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    spans: 1,
    spanDuration: 100,
    parts: [
      { kind: 'tick', t: 1050, x: 150, y: 100, span: 0 },
      { kind: 'tail', t: 1090, x: 190, y: 100, span: 0 },
    ],
    pointAt(progress) {
      return { x: 100 + 100 * progress, y: 100 };
    },
  };
  return {
    title: 'Synthetic slider',
    artist: 'Test',
    version: 'Standard',
    creator: 'Tests',
    mods: [],
    rate: 1,
    cs: 4,
    ar: 5,
    od: 5,
    hp: 5,
    radius: 10,
    preempt: 1200,
    fadeIn: 400,
    hidden: false,
    objects: [slider],
    comboColors: [0xffffff],
    audioFile: null,
    backgroundFile: null,
    breaks: [],
    firstObjectTime: 1000,
    lastObjectTime: 1100,
  };
}

describe('stable slider tracking (synthetic replay)', () => {
  it('does not start tracking inside 2.4r when outside the initial r', () => {
    const frames: ReplayFrame[] = [
      { t: 990, x: 120, y: 100, keys: 0 },
      { t: 1000, x: 120, y: 100, keys: KEY.M1 },
      { t: 1050, x: 165, y: 100, keys: KEY.M1 },
      { t: 1090, x: 205, y: 100, keys: KEY.M1 },
      { t: 1100, x: 215, y: 100, keys: 0 },
    ];
    const result = judge(mapWithSlider(), frames).objects[0];
    expect(result.hitTime).toBeNull();
    expect(result.parts).toEqual([false, false]);
    expect(result.result).toBe(0);
  });

  it('does not award a tick on the exact key-release timestamp, and can re-enter on repress', () => {
    const frames: ReplayFrame[] = [
      { t: 990, x: 100, y: 100, keys: 0 },
      { t: 1000, x: 100, y: 100, keys: KEY.M1 },
      { t: 1048, x: 148, y: 100, keys: KEY.M1 },
      { t: 1050, x: 150, y: 100, keys: 0 },
      { t: 1060, x: 160, y: 100, keys: KEY.M1 },
      { t: 1090, x: 190, y: 100, keys: KEY.M1 },
      { t: 1100, x: 200, y: 100, keys: 0 },
    ];
    const result = judge(mapWithSlider(), frames).objects[0];
    expect(result.hitTime).toBe(1000);
    expect(result.parts).toEqual([false, true]);
    expect(result.result).toBe(100);
  });

  it('keeps tracking inside the wider follow area after entering at the slider head', () => {
    const frames: ReplayFrame[] = [
      { t: 990, x: 100, y: 100, keys: 0 },
      { t: 1000, x: 100, y: 100, keys: KEY.M1 },
      { t: 1040, x: 157, y: 100, keys: KEY.M1 },
      { t: 1050, x: 168, y: 100, keys: KEY.M1 },
      { t: 1090, x: 209, y: 100, keys: KEY.M1 },
      { t: 1100, x: 220, y: 100, keys: 0 },
    ];
    const result = judge(mapWithSlider(), frames).objects[0];
    expect(result.parts).toEqual([true, true]);
    expect(result.result).toBe(300);
  });
});
