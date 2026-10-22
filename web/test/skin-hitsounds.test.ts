import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { openOsz } from '../src/load/osz';
import { planHitsounds } from '../src/audio/hitsounds';
import { prepareMap } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';
import { judge } from '../src/game/judge';

const chart = `osu file format v14
[General]
Mode: 0
SampleSet: Normal
[Metadata]
Title:Skin Sample Resolution
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
0,500,4,1,3,80,1,0
[HitObjects]
100,100,1000,1,2,0:0:0:0:
`;
const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2]);
const mapArchive = (extra: Record<string, Uint8Array> = {}) => openOsz(zipSync({
  'map/diff.osu': strToU8(chart),
  ...extra,
}));
const skinArchive = (extras: Record<string, Uint8Array> = {}) => openOsz(zipSync({
  'skin.ini': strToU8('[General]\\nName: Test'),
  'normal-hitnormal.wav': audio,
  'normal-hitwhistle.wav': audio,
  ...extras,
}));

describe('M5/M7 user-supplied .osk sample lookup', () => {
  const plan = (mapAssets = mapArchive(), skin = skinArchive(), osuText = chart) => {
    const map = prepareMap(osuText);
    return planHitsounds(osuText, map, judge(map, generateAutoplay(map)), mapAssets, 'map/diff.osu', skin);
  };

  it('falls back to unindexed WAV sounds inside the actual .osk ZIP', () => {
    const result = plan();
    expect(result.events.map(e => e.sample)).toEqual([
      'skin:normal-hitnormal.wav',
      'skin:normal-hitwhistle.wav',
    ]);
    expect(result.events.map(e => e.gain)).toEqual([0.8, 0.8]);
    expect(result.samples.size).toBe(2);
    expect(result.unavailable).toBe(0);
  });

  it('prefers indexed beatmap audio when present and uses skin only for missing layers', () => {
    const result = plan(mapArchive({ 'map/normal-hitnormal3.wav': audio }));
    expect(result.events.map(e => e.sample)).toEqual([
      'map/normal-hitnormal3.wav',
      'skin:normal-hitwhistle.wav',
    ]);
  });

  it('does not look up explicitly named custom beatmap files in the skin', () => {
    const custom = chart.replace('0:0:0:0:', '0:0:0:0:special.wav');
    const map = prepareMap(custom);
    const result = planHitsounds(
      custom, map, judge(map, generateAutoplay(map)),
      mapArchive(), 'map/diff.osu', skinArchive({ 'special.wav': audio }),
    );
    expect(result.events).toEqual([]);
    expect(result.unavailable).toBe(1);
  });

  it('provides real skin sounds even when .osu fallback has no map archive', () => {
    const map = prepareMap(chart);
    const result = planHitsounds(chart, map, judge(map, generateAutoplay(map)), null, '', skinArchive());
    expect(result.events).toHaveLength(2);
    expect(result.samples.size).toBe(2);
  });

  it('does not report missing sounds if .osk uses MP3 instead of WAV', () => {
    const skin = openOsz(zipSync({
      'normal-hitnormal.mp3': audio,
      'normal-hitwhistle.mp3': audio,
    }));
    const result = plan(mapArchive(), skin);
    expect(result.events.map(e => e.sample)).toEqual([
      'skin:normal-hitnormal.mp3', 'skin:normal-hitwhistle.mp3',
    ]);
  });
});
