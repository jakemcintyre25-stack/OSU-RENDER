import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { openOsz } from '../src/load/osz';
import { planHitsounds } from '../src/audio/hitsounds';
import { prepareMap } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';
import { judge } from '../src/game/judge';

const chart = `osu file format v14

[General]
SampleSet: Drum
Mode: 0

[Metadata]
Title:Spinner Sound
Artist:Test
Creator:Tests
Version:Normal

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,3,3,80,1,0

[HitObjects]
256,192,1000,8,12,3000,3:0:3:80:
`;
const createArchive = (includeAll = true) => openOsz(zipSync({
  'spinner.osu': strToU8(chart),
  'drum-hitnormal3.wav': new Uint8Array([1, 2]),
  'drum-hitfinish3.wav': new Uint8Array([3, 4]),
  ...(includeAll ? { 'drum-hitclap3.wav': new Uint8Array([5, 6]) } : {}),
}));

describe('M5 beatmap-defined spinner completion hitsounds', () => {
  it('plays real drum normal/finish/clap layers on successful spinner completion', () => {
    const osz = createArchive();
    const map = prepareMap(chart);
    const judged = judge(map, generateAutoplay(map));
    expect(judged.objects[0].result).toBe(300);
    const plan = planHitsounds(chart, map, judged, osz, 'spinner.osu');
    expect(plan.events).toEqual([
      { t: 3000, sample: 'drum-hitnormal3.wav', gain: 0.8 },
      { t: 3000, sample: 'drum-hitfinish3.wav', gain: 0.8 },
      { t: 3000, sample: 'drum-hitclap3.wav', gain: 0.8 },
    ]);
    expect(plan.samples.size).toBe(3);
  });

  it('does not emit completion sound for a replay that missed the spinner', () => {
    const map = prepareMap(chart);
    const judged = judge(map, []);
    expect(judged.objects[0].result).toBe(0);
    expect(planHitsounds(chart, map, judged, createArchive(), 'spinner.osu').events).toEqual([]);
  });

  it('does not manufacture the missing clap layer when its file is absent', () => {
    const map = prepareMap(chart);
    const judged = judge(map, generateAutoplay(map));
    const planned = planHitsounds(chart, map, judged, createArchive(false), 'spinner.osu');
    expect(planned.events).toHaveLength(2);
    expect(planned.unavailable).toBe(1);
  });
});
