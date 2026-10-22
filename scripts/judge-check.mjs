#!/usr/bin/env node
// Compare local replay headers with osu!stable judgement. Fixtures are never committed.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = [
  ['c300', 'count300', '300'],
  ['c100', 'count100', '100'],
  ['c50', 'count50', '50'],
  ['miss', 'countMiss', 'Miss'],
  ['maxCombo', 'maxCombo', 'Max combo'],
];

export function parseArgs(args) {
  if (args.length === 0) return { verbose: null };
  if (args.length === 2 && args[0] === '--verbose' && args[1].toLowerCase().endsWith('.osr')) {
    return { verbose: basename(args[1]) };
  }
  throw new Error('Usage: npm run judge-check -- [--verbose <file.osr>]');
}

export function clockTime(milliseconds) {
  const n = Math.round(milliseconds);
  const absolute = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.floor(absolute / 60000)}:${String(Math.floor(absolute / 1000) % 60).padStart(2, '0')}.${String(absolute % 1000).padStart(3, '0')}`;
}

export function isLazerFixture(name, replay) {
  // M10 handles lazer. Keep lazer fixtures in a subfolder or name *.lazer.osr.
  return /(?:^|[._-])lazer(?:[._-]|$)/i.test(name) || replay?.isLazer === true;
}

export function compareJudgement(judgement, stats) {
  const checks = FIELDS.map(([ourKey, headerKey, label]) => ({
    label,
    ours: ourKey === 'maxCombo' ? judgement.maxCombo : judgement.counts[ourKey],
    header: stats?.[headerKey],
  }));
  const oursScore = judgement.totalScore ?? judgement.score ?? judgement.events?.at(-1)?.score;
  if (oursScore !== undefined && oursScore !== null) {
    checks.push({ label: 'Score', ours: oursScore, header: stats?.totalScore });
  }
  return {
    checks,
    match: checks.every((c) => Number.isFinite(c.ours) && Number.isFinite(c.header) && c.ours === c.header),
  };
}

export function verboseRows(map, judgement) {
  // Header stats are aggregates; no object-level ground truth is present.
  return map.objects.map((object, index) => {
    const j = judgement.objects[index];
    const parts = object.kind === 'slider' ? ` parts=${(j.parts ?? []).map((ok) => ok ? '✓' : '×').join('')}` : '';
    return `${String(index + 1).padStart(5)}  ${String(Math.round(object.start)).padStart(8)} ms  ${clockTime(object.start).padStart(10)}  ${object.kind.padEnd(7)} ${String(j.result).padStart(3)}${parts}`;
  });
}

async function filesWithExtension(directory, suffix) {
  try {
    const items = await readdir(directory, { withFileTypes: true });
    return items.filter((item) => item.isFile() && item.name.toLowerCase().endsWith(suffix)).map((item) => item.name).sort();
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function loadEngine() {
  // Vite's SSR loader imports the browser TypeScript without a second build pipeline.
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: join(projectRoot, 'web'),
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const [replay, archive, preparation, judgement] = await Promise.all([
      vite.ssrLoadModule('/src/load/replay.ts'),
      vite.ssrLoadModule('/src/load/osz.ts'),
      vite.ssrLoadModule('/src/game/prepare.ts'),
      vite.ssrLoadModule('/src/game/judge.ts'),
    ]);
    return { engine: { ...replay, ...archive, ...preparation, ...judgement }, close: () => vite.close() };
  } catch (error) {
    await vite.close();
    throw error;
  }
}

export async function runJudgeCheck(args = [], options = {}) {
  const write = options.write ?? console.log;
  const warn = options.warn ?? console.error;
  const root = options.fixturesRoot ?? join(projectRoot, 'fixtures');
  const { verbose } = parseArgs(args);
  const replayDir = join(root, 'replays');
  const mapsDir = join(root, 'maps');
  const replays = await filesWithExtension(replayDir, '.osr');
  const maps = await filesWithExtension(mapsDir, '.osz');
  if (!replays?.length || !maps?.length) {
    write('No local replay/map fixtures to check. Add .osr files to fixtures/replays/ and matching .osz files to fixtures/maps/ (both gitignored).');
    return 0;
  }
  if (verbose && !replays.includes(verbose)) {
    warn(`Replay not found in fixtures/replays/: ${verbose}`);
    return 2;
  }

  const { engine, close } = options.engine ? { engine: options.engine, close: async () => {} } : await loadEngine();
  let failures = 0;
  let checked = 0;
  let skipped = 0;
  try {
    const byHash = new Map();
    for (const name of maps) {
      try {
        const archive = engine.openOsz(new Uint8Array(await readFile(join(mapsDir, name))));
        for (const difficulty of archive.difficulties) {
          if (!byHash.has(difficulty.md5.toLowerCase())) byHash.set(difficulty.md5.toLowerCase(), { difficulty, name });
        }
      } catch (error) {
        warn(`Could not read map ${name}: ${error.message}`);
        failures++;
      }
    }

    write('Replay | Mods | 300 ours/header | 100 ours/header | 50 ours/header | Miss ours/header | Max combo ours/header | Score ours/header | Status');
    for (const name of replays) {
      try {
        if (isLazerFixture(name)) {
          write(`${name} | skipped (lazer; M10 will add lazer judgement)`);
          skipped++;
          continue;
        }
        const replay = await engine.decodeReplay(new Uint8Array(await readFile(join(replayDir, name))));
        if (isLazerFixture(name, replay)) {
          write(`${name} | skipped (lazer; M10 will add lazer judgement)`);
          skipped++;
          continue;
        }
        if (replay.rulesetId !== 0) {
          write(`${name} | skipped (not osu!standard)`);
          skipped++;
          continue;
        }
        const found = byHash.get(replay.beatmapMD5?.toLowerCase());
        if (!found) {
          warn(`${name}: no .osz difficulty matches replay MD5 ${replay.beatmapMD5 || '(missing)'}`);
          failures++;
          continue;
        }
        const prepared = engine.prepareMap(found.difficulty.text, replay.mods);
        const judged = engine.judge(prepared, replay.frames);
        const { checks, match } = compareJudgement(judged, replay.stats);
        const col = (label) => {
          const c = checks.find((v) => v.label === label);
          return c ? `${c.ours}/${c.header ?? '?'}` : '—';
        };
        write(`${name} | ${replay.mods.join('+') || 'NM'} | ${col('300')} | ${col('100')} | ${col('50')} | ${col('Miss')} | ${col('Max combo')} | ${col('Score')} | ${match ? 'PASS' : 'MISMATCH'}`);
        checked++;
        if (!match) failures++;
        if (verbose === name) {
          write(`Object-level renderer results for ${name} (${found.name}). Header has no object-level truth; every object is a possible source of mismatch:`);
          write('Index   Map time   mm:ss.mmm  Object  Result / slider parts');
          for (const row of verboseRows(prepared, judged)) write(row);
        }
      } catch (error) {
        warn(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        failures++;
      }
    }
  } finally {
    await close();
  }
  write(`Checked ${checked} replay(s), skipped ${skipped}, failures ${failures}.`);
  return failures ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = await runJudgeCheck(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
