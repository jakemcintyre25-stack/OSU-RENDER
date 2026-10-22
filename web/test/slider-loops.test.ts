import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { planHitsounds, type HitSoundPlan } from '../src/audio/hitsounds';
import { HitSoundPlayer } from '../src/audio/sample-player';
import { openOsz } from '../src/load/osz';
import { prepareMap } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';
import { judge } from '../src/game/judge';

const chart = `osu file format v14
[General]
Mode: 0
SampleSet: Normal
[Metadata]
Title:Tracking Slider
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
const sample = new Uint8Array([1, 2, 3]);
const osz = () => openOsz(zipSync({
  'map.osu': strToU8(chart),
  'normal-sliderslide.wav': sample,
  'normal-sliderwhistle.wav': sample,
}));

class Context {
  currentTime = 10;
  sources: Array<{ loop: boolean; playbackRate: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  createBufferSource() {
    const source = {
      loop: false, buffer: null, playbackRate: { value: 1 },
      start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null,
    };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode;
  }
  decodeAudioData = vi.fn(async () => ({ duration: 0.2 } as AudioBuffer));
}

const loopPlan = (start: number, end: number): HitSoundPlan => ({
  events: [], unavailable: 0,
  loops: [{ start, end, sample: 'clip', gain: 0.7 }],
  samples: new Map([['clip', new Uint8Array([1, 2]).buffer]]),
});

describe('M5 actual slider track-loop planning', () => {
  it('builds true slider audio only over observed tracking ranges', () => {
    const archive = osz();
    const map = prepareMap(chart);
    const judgement = judge(map, generateAutoplay(map));
    const tracking = judgement.objects[0].tracking ?? [];
    expect(tracking.length).toBeGreaterThan(0);
    const plan = planHitsounds(chart, map, judgement, archive, 'map.osu');
    expect(plan.loops?.length).toBeGreaterThanOrEqual(2);
    expect(plan.loops?.every(loop => loop.end > loop.start)).toBe(true);
    expect(plan.loops?.every(loop => tracking.some(([a,b]) => loop.start >= a && loop.end <= b))).toBe(true);
    expect(plan.loops?.some(loop => loop.sample === 'normal-sliderslide.wav')).toBe(true);
    expect(plan.loops?.some(loop => loop.sample === 'normal-sliderwhistle.wav')).toBe(true);
  });

  it('never synthesizes slider tracking when the replay has no held key', () => {
    const map = prepareMap(chart);
    const plan = planHitsounds(chart, map, judge(map, []), osz(), 'map.osu');
    expect(plan.loops).toEqual([]);
  });

  it('ignores missing real slider sound files instead of inventing substitute loops', () => {
    const map = prepareMap(chart);
    const bare = openOsz(zipSync({ 'map.osu': strToU8(chart) }));
    const plan = planHitsounds(chart, map, judge(map, generateAutoplay(map)), bare, 'map.osu');
    expect(plan.loops).toEqual([]);
  });
});

describe('M5 Web Audio slider loop playback', () => {
  it('starts and stops a real looping source at tracked interval endpoints', async () => {
    const context = new Context();
    const player = new HitSoundPlayer(context as unknown as AudioContext, {} as AudioNode);
    expect(await player.load(loopPlan(1000, 2000))).toEqual({ loaded: 1, failed: 0 });
    player.reset(900);
    player.schedule(900, 10.05, 1, 0);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].start.mock.calls[0][0]).toBeCloseTo(10.15, 6);
    expect(context.sources[0].start.mock.calls[0][1]).toBeCloseTo(0, 6);
    expect(context.sources[0].stop.mock.calls[0][0]).toBeCloseTo(11.15, 6);
    player.dispose();
  });

  it('resumes an in-progress loop from its correct sample offset after seek', async () => {
    const context = new Context();
    const player = new HitSoundPlayer(context as unknown as AudioContext, {} as AudioNode);
    await player.load(loopPlan(1000, 2000));
    player.reset(1500);
    player.schedule(1500, 10.05, 1, 0);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start.mock.calls[0][0]).toBeCloseTo(10.05, 6);
    expect(context.sources[0].start.mock.calls[0][1]).toBeCloseTo(0.1, 6);
    expect(context.sources[0].stop.mock.calls[0][0]).toBeCloseTo(10.55, 6);
    player.reset(2100);
    expect(context.sources[0].stop.mock.calls.length).toBeGreaterThanOrEqual(2);
    player.schedule(2100, 10.1, 1, 0);
    expect(context.sources).toHaveLength(1);
  });

  it('applies speed and offset to loop start and stop times', async () => {
    const context = new Context();
    const player = new HitSoundPlayer(context as unknown as AudioContext, {} as AudioNode);
    await player.load(loopPlan(1200, 1800));
    player.reset(1000);
    player.schedule(1000, 10.05, 1.5, 60);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].playbackRate.value).toBe(1.5);
    expect(context.sources[0].start.mock.calls[0][0]).toBeCloseTo(10.05 + .26/1.5, 6);
    expect(context.sources[0].stop.mock.calls[0][0]).toBeCloseTo(10.05 + .86/1.5, 6);
    player.dispose();
  });
});
