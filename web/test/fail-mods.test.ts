import { describe, expect, it } from 'vitest';
import { judge } from '../src/game/judge';
import type { CircleObj, PreparedMap, SliderObj } from '../src/game/prepare';
import { KEY, type ReplayFrame } from '../src/load/replay';

const base = (mods: string[], objects: PreparedMap['objects']): PreparedMap => ({
  title: 'Synthetic failure modes', artist: 'Test', version: 'Standard',
  creator: 'Tests', mods, rate: 1, cs: 4, ar: 5, od: 5, hp: 5,
  scoreDifficulty: 2, radius: 10, preempt: 1200, fadeIn: 400, hidden: false,
  objects, comboColors: [0xffffff], audioFile: null, backgroundFile: null,
  breaks: [], firstObjectTime: objects[0]?.start ?? 0,
  lastObjectTime: objects.at(-1)?.end ?? 0,
});

const circle = (index: number, time: number): CircleObj => ({
  index, kind: 'circle', start: time, end: time, x: 100, y: 100,
  comboNumber: index + 1, comboColor: 0xffffff, newCombo: index === 0,
});

const slider = (): SliderObj => ({
  index: 0, kind: 'slider', start: 1000, end: 1100, x: 100, y: 100,
  comboNumber: 1, comboColor: 0xffffff, newCombo: true,
  spans: 1, spanDuration: 100,
  path: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
  parts: [
    { kind: 'tick', t: 1050, x: 150, y: 100, span: 0 },
    { kind: 'tail', t: 1090, x: 190, y: 100, span: 0 },
  ],
  pointAt(progress) { return { x: 100 + progress * 100, y: 100 }; },
});

const hitAt = (t: number): ReplayFrame[] => [
  { t: t - 10, x: 100, y: 100, keys: 0 },
  { t, x: 100, y: 100, keys: KEY.M1 },
  { t: t + 10, x: 100, y: 100, keys: 0 },
];

const sliderFrames = (tailCollected: boolean): ReplayFrame[] => [
  { t: 990, x: 100, y: 100, keys: 0 },
  { t: 1000, x: 100, y: 100, keys: KEY.M1 },
  { t: 1048, x: 148, y: 100, keys: KEY.M1 },
  { t: 1050, x: 150, y: 100, keys: tailCollected ? 0 : KEY.M1 },
  { t: 1060, x: 160, y: 100, keys: KEY.M1 },
  { t: 1080, x: 180, y: 100, keys: tailCollected ? KEY.M1 : 0 },
  { t: 1090, x: 190, y: 100, keys: tailCollected ? KEY.M1 : 0 },
  { t: 1100, x: 200, y: 100, keys: 0 },
];

describe('M3 special-mod failure timeline', () => {
  it('Sudden Death fails at the first missed circle result', () => {
    const judged = judge(base(['SD'], [circle(0, 1000), circle(1, 2000)]), hitAt(1000));
    expect(judged.objects.map((o) => o.result)).toEqual([300, 0]);
    expect(judged.failTime).toBe(2150);
  });

  it('Sudden Death does not fail on 100s without a combo break', () => {
    const judged = judge(base(['SD'], [circle(0, 1000)]), hitAt(1060));
    expect(judged.objects[0].result).toBe(100);
    expect(judged.failTime).toBeNull();
  });

  it('Perfect fails on the first 100 at its actual hit timestamp', () => {
    const judged = judge(base(['PF'], [circle(0, 1000)]), hitAt(1060));
    expect(judged.objects[0].result).toBe(100);
    expect(judged.failTime).toBe(1060);
  });

  it('No Fail suppresses failure even with SD or PF selected', () => {
    for (const mod of ['SD', 'PF']) {
      const judged = judge(base(['NF', mod], [circle(0, 1000)]), []);
      expect(judged.objects[0].result).toBe(0);
      expect(judged.failTime).toBeNull();
    }
  });

  it('Sudden Death fails immediately at a missed slider tick, not at slider end', () => {
    const judged = judge(base(['SD'], [slider()]), sliderFrames(true));
    expect(judged.objects[0].parts).toEqual([false, true]);
    expect(judged.objects[0].result).toBe(100);
    expect(judged.failTime).toBe(1050);
  });

  it('missing only a slider tail does not trigger SD but does trigger PF', () => {
    const mapSlider = slider();
    const sd = judge(base(['SD'], [mapSlider]), sliderFrames(false));
    const pf = judge(base(['PF'], [mapSlider]), sliderFrames(false));
    expect(sd.objects[0].parts).toEqual([true, false]);
    expect(sd.objects[0].result).toBe(100);
    expect(sd.failTime).toBeNull();
    expect(pf.failTime).toBe(1100);
  });
});
