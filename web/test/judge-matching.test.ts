import { describe, it, expect } from 'vitest';
import { prepareMap } from '../src/game/prepare';
import { judge } from '../src/game/judge';
import type { ReplayFrame } from '../src/load/replay';

// Two circles, B starts 20 ms after A and sits far away from it.
const osu = `osu file format v14

[General]
AudioFilename: a.mp3

[Metadata]
Title:t
Artist:a
Creator:c
Version:v

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,1,0,100,1,0

[HitObjects]
100,100,1000,1,0,0:0:0:0:
300,300,1020,1,0,0:0:0:0:
`;

const frames = (presses: { t: number; x: number; y: number }[]): ReplayFrame[] => {
  const out: ReplayFrame[] = [{ t: 0, x: 0, y: 0, keys: 0 }];
  for (const p of presses) {
    out.push({ t: p.t, x: p.x, y: p.y, keys: 1 });
    out.push({ t: p.t + 15, x: p.x, y: p.y, keys: 0 });
  }
  return out;
};

describe('click matching', () => {
  it('a click on a later circle hits it while an earlier circle is still open', () => {
    const map = prepareMap(osu, []);
    // Click lands on B (in its window) while A is still open and far away.
    const j = judge(map, frames([{ t: 1025, x: 300, y: 300 }]));
    expect(j.objects[1].result).toBe(300);
    expect(j.objects[0].result).toBe(0); // A was never clicked
  });

  it('a click on the first circle hits it, not the later one', () => {
    const map = prepareMap(osu, []);
    const j = judge(map, frames([{ t: 1005, x: 100, y: 100 }]));
    expect(j.objects[0].result).toBe(300);
    expect(j.objects[1].result).toBe(0);
  });

  it('a click wasted on empty space hits nothing', () => {
    const map = prepareMap(osu, []);
    const j = judge(map, frames([{ t: 1005, x: 500, y: 20 }]));
    expect(j.objects[0].result).toBe(0);
    expect(j.objects[1].result).toBe(0);
  });
});
