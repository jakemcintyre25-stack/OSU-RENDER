import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { openOsz } from '../src/load/osz';
import { supportedSkinAudioFiles } from '../src/audio/skin-assets';
import { planHitsounds } from '../src/audio/hitsounds';
import { prepareMap } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';
import { judge } from '../src/game/judge';

const chart = `osu file format v14
[General]
Mode: 0
SampleSet: Normal
[Metadata]
Title:Skin loops
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
0,500,4,1,0,80,1,0
[HitObjects]
100,100,1000,2,2,L|200:100,1,140,2|2,0:0|0:0,0:0:0:0:
`;
const wav = new Uint8Array([1, 2, 3, 4]);
const makeSkin = (files: Record<string, Uint8Array>) => openOsz(zipSync(files));

describe('user .osk audio feature detection and actual slider-loop fallback', () => {
  it('accepts skins containing only real slide/whistle audio', () => {
    const skin = makeSkin({
      'normal-sliderslide.wav': wav,
      'normal-sliderwhistle.mp3': wav,
      'skin.ini': strToU8('[General]\nName: Slides'),
      'cursor.png': wav,
    });
    expect(supportedSkinAudioFiles(skin)).toEqual([
      'normal-sliderslide.wav',
      'normal-sliderwhistle.mp3',
    ]);
    const map = prepareMap(chart);
    const judged = judge(map, generateAutoplay(map));
    const plan = planHitsounds(chart, map, judged, null, '', skin);
    expect(plan.loops?.some(x => x.sample === 'skin:normal-sliderslide.wav')).toBe(true);
    expect(plan.loops?.some(x => x.sample === 'skin:normal-sliderwhistle.mp3')).toBe(true);
    expect(plan.loops?.every(x => x.end > x.start)).toBe(true);
  });

  it('rejects sprite-only, nested, and similarly named non-samples', () => {
    const skin = makeSkin({
      'normal-sliderslide.png': wav,
      'nested/normal-hitnormal.wav': wav,
      'notnormal-sliderslide.wav': wav,
      'soft-hitclap.ogg': wav,
      'drum-sliderwhistle7.wav': wav,
    });
    expect(supportedSkinAudioFiles(skin)).toEqual(['soft-hitclap.ogg', 'drum-sliderwhistle7.wav']);
  });

  it('counts a chart audio sample as playable even without an .osu entry in .osk', () => {
    const skin = makeSkin({ 'normal-sliderslide.wav': wav });
    expect(skin.difficulties).toEqual([]);
    expect(supportedSkinAudioFiles(skin)).toHaveLength(1);
  });
});
