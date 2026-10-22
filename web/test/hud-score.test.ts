import { describe, expect, it } from 'vitest';
import { formatCalculatedScore, scoreHudLabel } from '../src/render/hud-score';
import { eventAt, judge } from '../src/game/judge';
import { prepareMap } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';

const chart = `osu file format v14

[General]
Mode:0
[Metadata]
Title:HUD score integration
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
0,500,4,1,0,100,1,0
[HitObjects]
100,100,1000,1,0,0:0:0:0:
200,100,1500,1,0,0:0:0:0:
`;

describe('calculated ScoreV1 HUD value', () => {
  it('prints thousands groups and marks the estimate as calculated', () => {
    expect(formatCalculatedScore(1_234_567.99)).toBe('1,234,567');
    expect(scoreHudLabel(1_234_567)).toBe('1,234,567 · calculated');
  });
  it('guards against invalid and negative values', () => {
    for (const value of [NaN, Infinity, -1, undefined, null]) {
      expect(formatCalculatedScore(value)).toBe('0');
    }
  });
  it('uses eventAt so the HUD follows historical score when scrubbing backward', () => {
    const map = prepareMap(chart);
    const judged = judge(map, generateAutoplay(map));
    const before = scoreHudLabel(eventAt(judged, 950)?.score);
    const first = scoreHudLabel(eventAt(judged, 1010)?.score);
    const after = scoreHudLabel(eventAt(judged, 1600)?.score);
    expect(before).toBe('0 · calculated');
    expect(first).not.toBe(before);
    expect(after).not.toBe(first);
    expect(scoreHudLabel(eventAt(judged, 1010)?.score)).toBe(first);
  });
});
