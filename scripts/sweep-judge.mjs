#!/usr/bin/env node
// Sweep judgement options across local fixtures and report total count error against headers.
// Usage: node scripts/sweep-judge.mjs [--windows 1,0.9] [--radii 1,1.05]
// Fixtures are never committed. Exits 0 with a hint if fixtures are missing.
import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(',').map(Number) : def;
};
const windows = arg('--windows', [1, 0.95, 0.9, 0.85, 0.8]);
const radii = arg('--radii', [1, 1.05]);
const offsets = arg('--offsets', [0]);
const pressFrames = arg('--press-frames', [0]).map((v) => v === 1);

async function list(dir, ext) {
  try {
    return (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(ext)).sort();
  } catch {
    return [];
  }
}

const replayFiles = await list(join(root, 'fixtures', 'replays'), '.osr');
const mapFiles = await list(join(root, 'fixtures', 'maps'), '.osz');
if (!replayFiles.length || !mapFiles.length) {
  console.log('No fixtures. Add .osr files to fixtures/replays/ and .osz files to fixtures/maps/.');
  process.exit(0);
}

const vite = await createServer({ root: join(root, 'web'), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const R = await vite.ssrLoadModule('/src/load/replay.ts');
  const O = await vite.ssrLoadModule('/src/load/osz.ts');
  const P = await vite.ssrLoadModule('/src/game/prepare.ts');
  const J = await vite.ssrLoadModule('/src/game/judge.ts');

  const archives = [];
  for (const f of mapFiles) archives.push(O.openOsz(new Uint8Array(await readFile(join(root, 'fixtures', 'maps', f)))));

  // De-duplicate replays (identical header hash + score is the same play).
  const cases = [];
  const seen = new Set();
  for (const f of replayFiles) {
    const rep = await R.decodeReplay(new Uint8Array(await readFile(join(root, 'fixtures', 'replays', f))));
    const key = `${rep.beatmapMD5}:${rep.stats?.totalScore}:${rep.frames.length}`;
    if (seen.has(key) || rep.rulesetId !== 0 || isLazer(f, rep)) continue;
    seen.add(key);
    const arc = archives.find((a) => O.pickDifficulty(a, rep.beatmapMD5));
    if (!arc) continue;
    const d = O.pickDifficulty(arc, rep.beatmapMD5);
    cases.push({ f, rep, map: P.prepareMap(d.text, rep.mods) });
  }
  function isLazer(name, rep) {
    return /(?:^|[._-])lazer(?:[._-]|$)/i.test(name) || rep.isLazer === true;
  }

  console.log(`${cases.length} unique replays`);
  const results = [];
  for (const rs of radii) for (const ws of windows) for (const off of offsets) for (const pf of pressFrames) {
    let total = 0;
    let comboTotal = 0;
    const per = [];
    for (const c of cases) {
      const j = J.judge(c.map, c.rep.frames, { windowScale: ws, radiusScale: rs, window300Offset: off, pressPositionFrames: pf });
      const h = c.rep.stats;
      const err = Math.abs(j.counts.c300 - h.count300) + Math.abs(j.counts.c100 - h.count100) + Math.abs(j.counts.c50 - h.count50) + Math.abs(j.counts.miss - h.countMiss);
      total += err;
      comboTotal += Math.abs(j.maxCombo - h.maxCombo);
      per.push(err);
    }
    results.push({ rs, ws, off, pf, total, comboTotal, per });
  }
  results.sort((a, b) => a.total - b.total);
  console.log('radius  window  off300  pf  count_err  combo_err  per_replay_count_err');
  for (const r of results) console.log(`${String(r.rs).padEnd(7)} ${String(r.ws).padEnd(7)} ${String(r.off).padEnd(7)} ${String(r.pf ? 1 : 0).padEnd(3)} ${String(r.total).padStart(9)} ${String(r.comboTotal).padStart(10)}  ${r.per.join(' ')}`);
} finally {
  await vite.close();
}
