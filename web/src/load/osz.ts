import { unzipSync, strFromU8 } from 'fflate';
import { md5 } from 'js-md5';

export interface Difficulty {
  fileName: string;
  md5: string;
  text: string;
  version: string;
  mode: number;
  beatmapId: number | null;
}

export interface OszArchive {
  /** Every file in the archive, keyed by lower-case path with forward slashes. */
  files: Map<string, Uint8Array>;
  difficulties: Difficulty[];
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

function headerValue(text: string, key: string): string | null {
  const m = text.match(new RegExp('^' + key + '\\s*:\\s*(.*)$', 'm'));
  return m ? m[1].trim() : null;
}

export function openOsz(data: Uint8Array): OszArchive {
  const raw = unzipSync(data);
  const files = new Map<string, Uint8Array>();
  const difficulties: Difficulty[] = [];
  for (const [name, bytes] of Object.entries(raw)) {
    if (name.endsWith('/') || name.includes('__MACOSX')) continue;
    files.set(norm(name), bytes);
    if (name.toLowerCase().endsWith('.osu')) {
      const text = strFromU8(bytes);
      const id = Number(headerValue(text, 'BeatmapID'));
      difficulties.push({
        fileName: name,
        md5: md5(bytes),
        text,
        version: headerValue(text, 'Version') ?? name,
        mode: Number(headerValue(text, 'Mode') ?? 0),
        beatmapId: Number.isFinite(id) && id > 0 ? id : null,
      });
    }
  }
  return { files, difficulties };
}

export function findFile(archive: OszArchive, name: string | null | undefined): Uint8Array | null {
  if (!name) return null;
  return archive.files.get(norm(name.replace(/^"|"$/g, ''))) ?? null;
}

/** Picks the difficulty a replay was played on: exact MD5 first, then beatmap ID. */
export function pickDifficulty(archive: OszArchive, wantMd5?: string | null, wantId?: number | null): Difficulty | null {
  if (wantMd5) {
    const d = archive.difficulties.find((x) => x.md5 === wantMd5.toLowerCase());
    if (d) return d;
  }
  if (wantId) {
    const d = archive.difficulties.find((x) => x.beatmapId === wantId);
    if (d) return d;
  }
  return null;
}
