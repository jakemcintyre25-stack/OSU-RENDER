import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScoreEncoder, BeatmapDecoder } from 'osu-parsers';
import { Score, Replay, LegacyReplayFrame, Vector2 } from 'osu-classes';
import { openOsz, pickDifficulty, findFile, type OszArchive } from '../src/load/osz';
import { decodeReplay, modsFromBits, cursorAt, cleanFrames } from '../src/load/replay';
import { prepareMap, sliderBallAt, hitWindows, type SliderObj } from '../src/game/prepare';
import { generateAutoplay } from '../src/game/autoplay';
import { judge, findPresses, eventAt } from '../src/game/judge';

const FIXTURE = join(__dirname, '..', '..', 'fixtures', 'renatus.osz');
const have = existsSync(FIXTURE);
let osz: OszArchive;
let insane: string;

beforeAll(() => {
  if (!have) return;
  osz = openOsz(new Uint8Array(readFileSync(FIXTURE)));
  insane = osz.difficulties.find((d) => d.version === 'Insane')!.text;
});

describe.skipIf(!have)('beatmap archive', () => {
  it('lists difficulties with hashes and finds files case-insensitively', () => {
    expect(osz.difficulties.length).toBe(12);
    const d = osz.difficulties.find((x) => x.version === 'Insane')!;
    expect(d.md5).toMatch(/^[a-f0-9]{32}$/);
    expect(pickDifficulty(osz, d.md5.toUpperCase())?.version).toBe('Insane');
    expect(pickDifficulty(osz, 'nope', d.beatmapId)?.version).toBe('Insane');
    expect(findFile(osz, 'MACHINETOP_BACKGROUND.JPG')?.length).toBeGreaterThan(1000);
  });
});

describe.skipIf(!have)('map preparation', () => {
  it('applies CS/AR and keeps objects in order', () => {
    const m = prepareMap(insane);
    expect(m.cs).toBe(4);
    expect(m.radius).toBeCloseTo(54.4 - 4.48 * 4, 3);
    expect(m.preempt).toBeCloseTo(1200 - 750 * (m.ar - 5) / 5, 3);
    expect(m.objects.length).toBe(897);
    for (let i = 1; i < m.objects.length; i++) expect(m.objects[i].start).toBeGreaterThanOrEqual(m.objects[i - 1].start);
    expect(m.audioFile).toContain('.mp3');
    expect(m.backgroundFile).toBe('machinetop_background.jpg');
  });

  it('flips the map vertically for HR and scales CS', () => {
    const nm = prepareMap(insane);
    const hr = prepareMap(insane, ['HR']);
    expect(hr.cs).toBeCloseTo(5.2, 3);
    expect(hr.ar).toBe(10);
    const a = nm.objects[0];
    const b = hr.objects[0];
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.y).toBeCloseTo(384 - a.y, 3);
  });

  it('builds slider paths that start at the head and match the slider length', () => {
    const m = prepareMap(insane);
    const sliders = m.objects.filter((o): o is SliderObj => o.kind === 'slider');
    expect(sliders.length).toBeGreaterThan(100);
    for (const s of sliders.slice(0, 50)) {
      expect(s.path[0].x).toBeCloseTo(s.x, 3);
      expect(s.path[0].y).toBeCloseTo(s.y, 3);
      expect(sliderBallAt(s, s.start)).toEqual(s.pointAt(0));
      const tail = s.parts.find((p) => p.kind === 'tail')!;
      expect(tail).toBeTruthy();
      // The ball ends on the start for even span counts and on the far end for odd.
      const endBall = sliderBallAt(s, s.end);
      const expected = s.spans % 2 === 0 ? s.pointAt(0) : s.pointAt(1);
      expect(endBall.x).toBeCloseTo(expected.x, 3);
      expect(endBall.y).toBeCloseTo(expected.y, 3);
    }
  });

  it('applies stacking offsets', () => {
    const m = prepareMap(insane);
    const raw = new BeatmapDecoder().decodeFromString(insane).hitObjects;
    // Stacked objects move up-left by (radius / 10) per stack step.
    const step = m.radius / 10;
    const moved = m.objects.filter((o, i) => o.kind !== 'spinner' && (o.x !== raw[i].startPosition.x || o.y !== raw[i].startPosition.y));
    expect(moved.length).toBeGreaterThan(20);
    for (const o of moved) {
      const dx = raw[o.index].startPosition.x - o.x;
      const dy = raw[o.index].startPosition.y - o.y;
      expect(dx).toBeCloseTo(dy, 3);
      expect(Math.abs(dx / step - Math.round(dx / step))).toBeLessThan(1e-3);
    }
  });

  it('rejects non-standard modes', () => {
    const taiko = osz.difficulties.find((d) => d.mode === 1);
    if (taiko) expect(() => prepareMap(taiko.text)).toThrow(/standard/);
  });
});

describe('hit windows', () => {
  it('matches stable at OD 8', () => {
    expect(hitWindows(8)).toEqual({ w300: 32, w100: 76, w50: 120 });
  });
});

describe.skipIf(!have)('autoplay + judgement', () => {
  it('judges every standard difficulty in the optional Renatus archive as full combo', () => {
    // M2 acceptance gate: run locally with npm run fixtures; CI skips copyrighted fixtures.
    const standard = osz.difficulties.filter((d) => d.mode === 0);
    expect(standard.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const difficulty of standard) {
      const map = prepareMap(difficulty.text);
      const judged = judge(map, generateAutoplay(map));
      const expected = map.objects.reduce(
        (combo, object) => combo + (object.kind === 'slider' ? 1 + object.parts.length : 1),
        0,
      );
      if (judged.counts.c300 !== map.objects.length ||
          judged.counts.c100 !== 0 ||
          judged.counts.c50 !== 0 ||
          judged.counts.miss !== 0 ||
          judged.maxCombo !== expected) {
        failures.push(difficulty.version + ': ' + JSON.stringify({
          counts: judged.counts,
          maxCombo: judged.maxCombo,
          expected,
        }));
      }
    }
    expect(failures).toEqual([]);
  });

  it('judges a perfect autoplay as all 300s with full combo', () => {
    const m = prepareMap(insane);
    const frames = generateAutoplay(m);
    const j = judge(m, frames);
    const bad = j.objects.map((o, i) => ({ o, i })).filter(({ o }) => o.result !== 300);
    expect(bad.map(({ i, o }) => `${i}:${m.objects[i].kind}:${o.result}`)).toEqual([]);
    expect(j.counts.miss).toBe(0);
    const sliderParts = m.objects.reduce((n, o) => n + (o.kind === 'slider' ? 1 + o.parts.length : 0), 0);
    const nonSliders = m.objects.filter((o) => o.kind !== 'slider').length;
    expect(j.maxCombo).toBe(sliderParts + nonSliders);
  });

  it('works with HR and DT', () => {
    const m = prepareMap(insane, ['HR', 'DT']);
    expect(m.rate).toBe(1.5);
    const j = judge(m, generateAutoplay(m));
    expect(j.counts.c300).toBe(m.objects.length);
  });

  it('marks circles as missed when the replay never clicks', () => {
    const m = prepareMap(insane);
    const frames = generateAutoplay(m).map((f) => ({ ...f, keys: 0 }));
    const j = judge(m, frames);
    expect(j.counts.miss).toBe(m.objects.length);
    expect(j.maxCombo).toBe(0);
  });

  it('gives a 100 for a click just outside the 300 window', () => {
    const m = prepareMap(insane);
    const w = hitWindows(m.od);
    const first = m.objects[0];
    const frames = generateAutoplay(m).map((f) => ({ ...f, t: f.t === first.start ? f.t + w.w300 + 5 : f.t }));
    frames.sort((a, b) => a.t - b.t);
    expect(judge(m, frames).objects[0].result).toBe(first.kind === 'circle' ? 100 : judge(m, frames).objects[0].result);
  });

  it('exposes running combo and accuracy over time', () => {
    const m = prepareMap(insane);
    const j = judge(m, generateAutoplay(m));
    expect(eventAt(j, -1e9)).toBeNull();
    const end = eventAt(j, 1e9)!;
    expect(end.combo).toBe(j.maxCombo);
    expect(end.accuracy).toBe(1);
  });
});

describe('replay files', () => {
  it('decodes an encoded .osr (header, mods, frames)', async () => {
    const score = new Score();
    score.info.rulesetId = 0;
    score.info.username = 'Shaxi';
    score.info.beatmapHashMD5 = 'ABCDEF0123456789ABCDEF0123456789';
    score.info.rawMods = 16 + 64 + 8;
    score.info.count300 = 10;
    score.info.maxCombo = 12;
    score.replay = new Replay();
    score.replay.frames.push(new LegacyReplayFrame(0, 0, new Vector2(256, -500), 0));
    for (let i = 1; i <= 10; i++) score.replay.frames.push(new LegacyReplayFrame(i * 16, 16, new Vector2(100 + i, 200), (i % 2 ? 5 : 0) as never));
    const buf = await new ScoreEncoder().encodeToBuffer(score);
    const r = await decodeReplay(new Uint8Array(buf));
    expect(r.player).toBe('Shaxi');
    expect(r.beatmapMD5).toBe('abcdef0123456789abcdef0123456789');
    expect(r.mods).toEqual(['HD', 'HR', 'DT']);
    expect(r.stats?.count300).toBe(10);
    expect(r.frames).toHaveLength(10); // placeholder frame dropped
    expect(findPresses(r.frames)).toHaveLength(5);
  });

  it('reads mod bits', () => {
    expect(modsFromBits(512 + 64)).toEqual(['NC']);
    expect(modsFromBits(16384 + 32 + 8)).toEqual(['HD', 'PF']);
  });

  it('interpolates the cursor between frames', () => {
    const f = cleanFrames([
      { t: 0, x: 0, y: 0, keys: 0 },
      { t: 10, x: 100, y: 50, keys: 1 },
    ]);
    expect(cursorAt(f, 5)).toMatchObject({ x: 50, y: 25, keys: 0 });
    expect(cursorAt(f, 20)).toMatchObject({ x: 100, y: 50, keys: 1 });
  });
});
