// Downloads test beatmaps into fixtures/ (gitignored — the maps belong to their mappers, so they
// are not committed). Source: the osu! lazer repository's test resources.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const BASE = 'https://raw.githubusercontent.com/ppy/osu/master/osu.Game.Tests/Resources/Archives/';
const FILES = { 'renatus.osz': '241526 Soleily - Renatus.osz' };

await mkdir(root, { recursive: true });
for (const [local, remote] of Object.entries(FILES)) {
  const dest = join(root, local);
  try {
    await access(dest);
    console.log('have', local);
    continue;
  } catch {}
  const res = await fetch(BASE + encodeURIComponent(remote));
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', local);
}
