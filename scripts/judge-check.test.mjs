import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareJudgement, clockTime, isLazerFixture, parseArgs, runJudgeCheck, verboseRows } from './judge-check.mjs';

const stats = { count300: 2, count100: 1, count50: 0, countMiss: 1, maxCombo: 3, totalScore: 1000 };
const j = { counts: { c300: 2, c100: 1, c50: 0, miss: 1 }, maxCombo: 3, events: [] };

describe('judge-check commands and comparison', () => {
  it('accepts the regular and verbose commands only', () => {
    assert.deepEqual(parseArgs([]), { verbose: null });
    assert.deepEqual(parseArgs(['--verbose', 'fixtures/replays/map.osr']), { verbose: 'map.osr' });
    assert.deepEqual(parseArgs(['--require-fixtures']), { verbose: null, requireFixtures: true });
    assert.deepEqual(parseArgs(['--require-fixtures', '--verbose', 'map.osr']), { verbose: 'map.osr', requireFixtures: true });
    assert.throws(() => parseArgs(['--require-fixtures', '--require-fixtures']), /Usage/);
    assert.throws(() => parseArgs(['--verbose']), /Usage/);
    assert.throws(() => parseArgs(['--verbose', 'map.osz']), /Usage/);
  });

  it('prints millisecond and mm:ss time accurately', () => {
    assert.equal(clockTime(62504), '1:02.504');
    assert.equal(clockTime(-1203), '-0:01.203');
  });

  it('compares all stable header count fields and optional Score V1', () => {
    assert.equal(compareJudgement(j, stats).match, true);
    assert.equal(compareJudgement({ ...j, maxCombo: 2 }, stats).match, false);
    assert.equal(compareJudgement(j, { ...stats, count50: 1 }).match, false);
    assert.equal(compareJudgement({ ...j, totalScore: 1000 }, stats).checks.at(-1).label, 'Score');
    assert.equal(compareJudgement({ ...j, totalScore: 999 }, stats).match, false);
    assert.equal(compareJudgement(j, null).match, false);
  });

  it('skips only labelled lazer fixtures while M10 is pending', () => {
    assert.equal(isLazerFixture('song.lazer.osr'), true);
    assert.equal(isLazerFixture('lazer-song.osr'), true);
    assert.equal(isLazerFixture('song.osr'), false);
    assert.equal(isLazerFixture('song.osr', { isLazer: true }), true);
  });

  it('shows object times, slider parts, press offsets and spinner rotations in verbose output', () => {
    const rows = verboseRows({ objects: [
      { kind: 'circle', start: 1040 },
      { kind: 'slider', start: 61040 },
      { kind: 'spinner', start: 90000, spinsRequired: 8 },
    ] }, {
      objects: [
        { result: 300, hitTime: 1072 },
        { result: 100, parts: [true, false] },
        { result: 100, spins: 6.375 },
      ],
    });
    assert.equal(rows.length, 3);
    assert.match(rows[0], /0:01\.040.*circle.*300.*press=0:01\.072 delta=\+32ms/);
    assert.match(rows[1], /1:01\.040.*slider.*100.*✓×/);
    assert.match(rows[2], /1:30\.000.*spinner.*100.*spins=6\.38\/8/);
  });
});

describe('judge-check fixture handling', () => {
  it('exits successfully and prints instructions when directories are missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'osu-judge-check-'));
    try {
      const lines = [];
      assert.equal(await runJudgeCheck([], { fixturesRoot: tmp, write: (s) => lines.push(s) }), 0);
      assert.match(lines.join('\n'), /fixtures\/replays\//);
      await mkdir(join(tmp, 'replays'));
      await writeFile(join(tmp, 'replays', 'sample.osr'), 'sample');
      assert.equal(await runJudgeCheck([], { fixturesRoot: tmp, write: (s) => lines.push(s) }), 0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('fails a strict acceptance run when replay or map fixtures are missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'osu-judge-strict-'));
    try {
      const errors = [];
      const code = await runJudgeCheck(['--require-fixtures'], {
        fixturesRoot: tmp,
        write: () => {},
        warn: (message) => errors.push(message),
      });
      assert.equal(code, 2);
      assert.match(errors.join(' '), /no .*fixture|strict.*fixture/i);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses to pass strict mode if every available replay was skipped as lazer', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'osu-judge-strict-lazer-'));
    try {
      await mkdir(join(tmp, 'replays'));
      await mkdir(join(tmp, 'maps'));
      await writeFile(join(tmp, 'replays', 'play.lazer.osr'), 'mock');
      await writeFile(join(tmp, 'maps', 'beatmap.osz'), 'mock');
      const engine = { openOsz: () => ({ difficulties: [] }) };
      const code = await runJudgeCheck(['--require-fixtures'], {
        fixturesRoot: tmp, engine,
        write: () => {}, warn: () => {},
      });
      assert.equal(code, 2);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('finds maps by exact MD5 and fails on a header mismatch', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'osu-judge-check-'));
    try {
      await mkdir(join(tmp, 'replays'));
      await mkdir(join(tmp, 'maps'));
      await writeFile(join(tmp, 'replays', 'test.osr'), 'mock');
      await writeFile(join(tmp, 'maps', 'test.osz'), 'mock');
      const seen = [];
      const engine = {
        openOsz: () => ({ difficulties: [{ md5: 'abcd', text: 'beatmap' }] }),
        decodeReplay: async () => ({ beatmapMD5: 'abcd', rulesetId: 0, mods: [], frames: [], stats }),
        prepareMap: () => ({ objects: [{ kind: 'circle', start: 10 }] }),
        judge: () => ({ ...j, maxCombo: 2, objects: [{ result: 300 }] }),
      };
      const code = await runJudgeCheck(['--verbose', 'test.osr'], { fixturesRoot: tmp, engine, write: (s) => seen.push(s) });
      assert.equal(code, 1);
      assert.match(seen.join('\n'), /MISMATCH/);
      assert.match(seen.join('\n'), /0:00\.010/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
