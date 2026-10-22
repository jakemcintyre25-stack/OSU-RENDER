import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { planHitsounds } from '../src/audio/hitsounds';
import { openOsz } from '../src/load/osz';
import { prepareMap } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';
import { judge } from '../src/game/judge';
import { sessionFromAutoplay } from '../src/session';

const chart = `osu file format v14

[General]
AudioFilename: song.mp3
SampleSet: Soft
Mode: 0

[Metadata]
Title:Sound Integration
Artist:Test
Creator:Tests
Version:Circle Slider

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,2,60,1,0
1600,-100,4,3,3,80,0,0

[HitObjects]
100,100,1000,1,2,0:0:0:0:
100,100,2000,1,0,0:0:0:0:
100,100,2500,1,8,0:0:0:0:custom.wav
100,100,3000,2,0,L|200:100,2,140,0|2|8,0:0|0:0|0:0,0:0:0:0:
`;
const sample = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
const archive = (osuText = chart) => openOsz(zipSync({
  'folder/diff.osu': strToU8(osuText),
  'folder/soft-hitnormal2.wav': sample,
  'folder/soft-hitwhistle2.wav': sample,
  'folder/drum-hitnormal3.wav': sample,
  'folder/custom.wav': sample,
  'folder/drum-hitwhistle3.wav': sample,
  'folder/drum-hitclap3.wav': sample,
  'folder/song.mp3': new Uint8Array([7, 8, 9]),
}));

describe('M5 beatmap-sourced hitsounds', () => {
  it('resolves actual .osz files from the chart folder and timing-point metadata', () => {
    const osz = archive();
    const map = prepareMap(chart);
    const frames = generateAutoplay(map);
    const judged = judge(map, frames);
    expect(judged.counts.c300).toBe(map.objects.length);
    const planned = planHitsounds(chart, map, judged, osz, 'folder/diff.osu');
    expect(planned.events.filter((x) => x.t === 1000).map((x) => x.sample))
      .toEqual(['folder/soft-hitnormal2.wav', 'folder/soft-hitwhistle2.wav']);
    expect(planned.events.filter((x) => x.t === 1000).map((x) => x.gain))
      .toEqual([0.6, 0.6]);
    expect(planned.events.filter((x) => x.t === 2000).map((x) => x.sample))
      .toEqual(['folder/drum-hitnormal3.wav']);
    expect(planned.events.filter((x) => x.t === 2500).map((x) => x.sample))
      .toEqual(['folder/custom.wav']);
    expect(planned.events.every((x) => planned.samples.has(x.sample))).toBe(true);
    expect(planned.samples.get('folder/custom.wav')?.byteLength).toBe(sample.length);
    expect(planned.events.some((x) => x.t === 3000)).toBe(true);
    const slider = map.objects.find((o) => o.kind === 'slider')!;
    if (slider.kind !== 'slider') throw new Error('Expected slider');
    const tail = slider.parts.find((p) => p.kind === 'tail')!;
    expect(tail.t).toBeLessThan(slider.end); // legacy leniency judgement
    expect(planned.events.some((x) => x.t === slider.end && x.sample.endsWith('drum-hitclap3.wav'))).toBe(true);
    expect(planned.events.every((x, i, xs) => i === 0 || xs[i - 1].t <= x.t)).toBe(true);
  });

  it('integrates real archive paths through autoplay session preparation', async () => {
    const osz = archive();
    const difficulty = osz.difficulties[0];
    const session = await sessionFromAutoplay(osz, difficulty, []);
    expect([...new Uint8Array(session.audio!)]).toEqual([7, 8, 9]);
    expect(session.judgement.counts.c300).toBe(session.map.objects.length);
    expect(session.hitsounds.events.length).toBeGreaterThan(4);
    expect(session.hitsounds.samples.has('folder/custom.wav')).toBe(true);
  });

  it('silently excludes missing skin/default assets rather than synthesizing sound', () => {
    const empty = { files: new Map<string, Uint8Array>(), difficulties: [] };
    const map = prepareMap(chart);
    const planned = planHitsounds(chart, map, judge(map, generateAutoplay(map)), empty, 'folder/diff.osu');
    expect(planned.events).toEqual([]);
    expect(planned.unavailable).toBeGreaterThan(1);
  });

  it('does not play notes that were missed in the replay', () => {
    const osz = archive();
    const map = prepareMap(chart);
    const judged = judge(map, []);
    const plan = planHitsounds(chart, map, judged, osz, 'folder/diff.osu');
    expect(plan.events).toEqual([]);
  });

  it('rejects mismatched object mapping rather than playing incorrect sounds', () => {
    const osz = archive();
    const map = prepareMap(chart);
    const judged = judge(map, []);
    const other = chart.replace('100,100,1000,1,2', '100,100,1100,1,2');
    expect(() => planHitsounds(other, map, judged, osz, 'folder/diff.osu'))
      .toThrow(/prepared object differs/);
  });

  it('rejects relative custom filename traversal and does not expose unrelated assets', () => {
    const unsafe = chart.replace('custom.wav', '../private.wav');
    const osz = archive(unsafe);
    const map = prepareMap(unsafe);
    const planned = planHitsounds(unsafe, map, judge(map, generateAutoplay(map)), osz, 'folder/diff.osu');
    expect(planned.samples.has('private.wav')).toBe(false);
    expect(planned.events.some(e => e.sample.includes('private.wav'))).toBe(false);
    expect(planned.unavailable).toBeGreaterThan(0);
  });

  it('excludes an oversized beatmap sample before allocating a Web Audio copy', () => {
    const huge = new Uint8Array(8 * 1024 * 1024 + 1);
    const osz = archive();
    osz.files.set('folder/custom.wav', huge);
    const map = prepareMap(chart);
    const planned = planHitsounds(chart, map, judge(map, generateAutoplay(map)), osz, 'folder/diff.osu');
    expect(planned.samples.has('folder/custom.wav')).toBe(false);
    expect(planned.events.some(e => e.sample === 'folder/custom.wav')).toBe(false);
    expect(planned.unavailable).toBeGreaterThan(0);
  });

  it('does not fabricate an audio plan in bare-.osu fallback mode', () => {
    const map = prepareMap(chart);
    const plan = planHitsounds(chart, map, judge(map, generateAutoplay(map)), null);
    expect(plan.events).toEqual([]);
    expect(plan.samples.size).toBe(0);
  });
});
