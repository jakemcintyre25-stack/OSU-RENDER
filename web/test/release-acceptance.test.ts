import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { openOsz } from '../src/load/osz';
import { sessionFromAutoplay } from '../src/session';
import { hpAt } from '../src/game/hp-engine';
import { createExportTimeline, exportPreset } from '../src/render/export/timeline';

const chart = `osu file format v14

[General]
AudioFilename: song.mp3
SampleSet: Soft
Mode: 0

[Metadata]
Title:Release Acceptance
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
0,500,4,2,2,60,1,0

[HitObjects]
100,100,1000,1,2,0:0:0:0:
300,100,2000,2,0,L|800:100,1,500,0|2,0:0|0:0,0:0:0:0:
256,192,4000,8,0,6500,3:0:3:80:
`;

const bytes = (v: number) => new Uint8Array([v, v + 1, v + 2, v + 3]);
const archive = () => openOsz(zipSync({
  'folder/map.osu': strToU8(chart),
  'folder/song.mp3': bytes(20),
  'folder/soft-hitnormal2.wav': bytes(1),
  'folder/soft-hitwhistle2.wav': bytes(3),
  'folder/soft-slidertick2.wav': bytes(5),
}));
const skinArchive = () => openOsz(zipSync({
  'spinnerspin.wav': bytes(7),
  'spinnerbonus.wav': bytes(9),
}));

describe('release-candidate end-to-end session', () => {
  it('prepares judgement, HP, hitsounds and export timing from one autoplay session', async () => {
    const osz = archive();
    const diff = osz.difficulties[0];
    const session = await sessionFromAutoplay(osz, diff, [], skinArchive());

    expect(session.map.objects.map((object) => object.kind)).toEqual(['circle', 'slider', 'spinner']);
    expect(session.judgement.counts).toEqual({ c300: 3, c100: 0, c50: 0, miss: 0 });
    expect(session.judgement.totalScore).toBeGreaterThan(0);
    expect(session.hp.coefficients.initial).toBe(200);
    expect(session.hp.coefficients.maximum).toBe(200);
    expect(session.hp.coefficients.drainPerMs).toBeGreaterThan(0);
    expect(session.hp.trace.snapshots.length).toBeGreaterThan(0);

    for (const t of [1000, 3000, 4000, 6500]) {
      const hp = hpAt(session.hp.trace, t);
      expect(hp).toBeGreaterThanOrEqual(0);
      expect(hp).toBeLessThanOrEqual(200);
    }

    expect(session.hitsounds.events.some((event) => event.sample === 'folder/soft-hitnormal2.wav')).toBe(true);
    expect(session.hitsounds.events.some((event) => event.sample === 'folder/soft-hitwhistle2.wav')).toBe(true);
    expect(session.hitsounds.events.some((event) => event.sample === 'folder/soft-slidertick2.wav')).toBe(true);
    expect(session.hitsounds.loops?.some((loop) => loop.sample === 'skin:spinnerspin.wav')).toBe(true);
    expect(session.hitsounds.events.some((event) => event.sample === 'skin:spinnerbonus.wav')).toBe(true);

    const preset = exportPreset('1080p60');
    expect(preset).toMatchObject({ width: 1920, height: 1080, fps: 60 });
    const timeline = createExportTimeline({ startMs: 0, endMs: 180_000, rate: 1, fps: preset.fps });
    expect(timeline.frameCount).toBe(10_800);
    expect(timeline.videoDurationSeconds).toBe(180);
    expect(timeline.outputTimeAtFrame(10_799)).toBeCloseTo(179.983333, 5);
  });

  it('keeps the session valid when optional skin audio is absent', async () => {
    const osz = archive();
    const session = await sessionFromAutoplay(osz, osz.difficulties[0], []);
    expect(session.judgement.counts.c300).toBe(3);
    expect(session.hitsounds.loops).toEqual([]);
    expect(session.hitsounds.events.some((event) => event.sample === 'skin:spinnerbonus.wav')).toBe(false);
  });
});
