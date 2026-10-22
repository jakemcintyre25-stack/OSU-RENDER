import { describe, expect, it } from 'vitest';
import { generateAutoplay } from '../src/game/autoplay';
import { judge, eventAt } from '../src/game/judge';
import { prepareMap } from '../src/game/prepare';

// Hand-built osu!standard map: exercises parser, slider nested parts,
// spinner integration, autoplay replay generation and ScoreV1 timeline.
// No copyrighted beatmaps, replay files or audio are committed.
const osu = `osu file format v14

[General]
AudioFilename: synthetic.mp3
Mode: 0

[Metadata]
Title:Synthetic Integration
Artist:Test
Creator:Tests
Version:Circle Slider Spinner

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
100,100,1800,2,0,L|200:100,1,140
200,200,2600,1,0,0:0:0:0:
256,192,3200,4200,8,0,0:0:0:0:
`;

describe('autoplay integration without private fixtures', () => {
  it('parses a mixed-object .osu and judges generated replay at 100% accuracy', () => {
    const map = prepareMap(osu);
    expect(map.objects.map((o) => o.kind)).toEqual(['circle', 'slider', 'circle', 'spinner']);
    const replay = generateAutoplay(map);
    expect(replay.length).toBeGreaterThan(0);
    for (let i = 1; i < replay.length; i++) {
      expect(replay[i].t).toBeGreaterThanOrEqual(replay[i - 1].t);
    }
    const j = judge(map, replay);
    expect(j.objects.map((o) => o.result)).toEqual([300, 300, 300, 300]);
    expect(j.counts).toEqual({ c300: 4, c100: 0, c50: 0, miss: 0 });
    const slider = map.objects[1];
    if (slider.kind !== 'slider') throw new Error('Expected slider');
    const expectedCombo = 3 + 1 + slider.parts.length;
    expect(j.maxCombo).toBe(expectedCombo);
    expect(eventAt(j, 1e9)?.accuracy).toBe(1);
    expect(eventAt(j, 1e9)?.score).toBe(j.totalScore);
    expect(j.totalScore).toBeGreaterThan(300 * map.objects.length);
  });

  it('preserves 300/full combo under HR+DT on the synthetic map', () => {
    const map = prepareMap(osu, ['HR', 'DT']);
    const replay = generateAutoplay(map);
    const j = judge(map, replay);
    expect(map.rate).toBe(1.5);
    expect(j.counts).toEqual({ c300: 4, c100: 0, c50: 0, miss: 0 });
    expect(j.maxCombo).toBe(map.objects.reduce(
      (combo, o) => combo + (o.kind === 'slider' ? 1 + o.parts.length : 1),
      0,
    ));
  });
});
