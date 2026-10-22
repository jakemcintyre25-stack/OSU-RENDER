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

describe('real map ScoreV1 active drain-time integration', () => {
  it('subtracts the union of overlapping breaks instead of double counting them', () => {
    const map = prepareMap(source);
    // The union [10000,60000] removes 50 seconds from a 100-second interval.
    expect(map.scoreDifficulty).toBe(difficultyMultiplier(5, 4, 5, 2, 50));
  });
  it('retains identical ScoreV1 difficulty when overlapping breaks are merged', () => {
    const merged = source.replace('2,10000,40000\n2,20000,50000\n2,49000,60000', '2,10000,60000');
    expect(prepareMap(source).scoreDifficulty).toBe(prepareMap(merged).scoreDifficulty);
  });
});
