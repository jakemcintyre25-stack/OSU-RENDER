import { describe, expect, it } from 'vitest';
import { prepareMap } from '../src/game/prepare';
import { difficultyMultiplier } from '../src/game/score';

const source = `osu file format v14
[General]
Mode:0
[Metadata]
Title:Break overlap
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
[Events]
2,10000,40000
2,20000,50000
2,49000,60000
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
100,100,1000,1,0,0:0:0:0:
100,100,101000,1,0,0:0:0:0:
`;

describe('real map ScoreV1 stable drain-time integration', () => {
  it('reproduces stable summing overlapping breaks instead of unioning them', () => {
    const map = prepareMap(source);
    // Stable sums 30s + 30s + 11s = 71s, leaving 29 seconds of a 100-second interval.
    expect(map.scoreDifficulty).toBe(difficultyMultiplier(5, 4, 5, 2, 29));
  });
  it('uses a different drain length when overlapping breaks are merged', () => {
    const merged = source.replace('2,10000,40000\n2,20000,50000\n2,49000,60000', '2,10000,60000');
    // The merged break is 50s, leaving 50 seconds. This documents stable's
    // overlapping-break quirk rather than treating merged breaks as equivalent.
    expect(prepareMap(merged).scoreDifficulty).toBe(difficultyMultiplier(5, 4, 5, 2, 50));
  });
});
