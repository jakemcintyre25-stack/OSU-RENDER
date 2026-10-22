// Beatmap downloads. osu.ppy.sh's own .osz download needs a logged-in browser session,
// so full beatmapsets (audio, background, hitsounds) come from community mirrors.

import { HttpError } from './osu';
import { validateMirrorZip } from './zip-envelope';

export const MIRRORS: { name: string; url: (setId: string) => string }[] = [
  { name: 'catboy', url: (id) => `https://catboy.best/d/${id}` },
  { name: 'nerinyan', url: (id) => `https://api.nerinyan.moe/d/${id}` },
  { name: 'osu.direct', url: (id) => `https://osu.direct/api/d/${id}` },
];


const MAX_OSZ_BYTES = 150 * 1024 * 1024;
const MAX_OSU_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * Bound a mirror download while consuming the stream. Content-Length alone is
 * not an enforcement mechanism: mirrors may omit it or send fewer bytes there
 * than in the actual body. Never accumulate beyond maxBytes.
 */
export async function readBoundedResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Invalid download byte limit');
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Download too large (declared length)');
  }
  if (!response.body) throw new Error('Download has no readable body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Download too large (streamed length)');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}


/** Tries each mirror in turn and returns the first response that is really a zip. */
export async function fetchBeatmapset(setId: string, fetchImpl: typeof fetch = fetch): Promise<{ body: ArrayBuffer; mirror: string }> {
  const errors: string[] = [];
  for (const m of MIRRORS) {
    try {
      const res = await fetchImpl(m.url(setId), {
        headers: { 'User-Agent': 'osu-render (+https://github.com/jakemcintyre25-stack/osu-render)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        errors.push(`${m.name}: HTTP ${res.status}`);
        continue;
      }
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_OSZ_BYTES) {
        errors.push(`${m.name}: too large`);
        continue;
      }
      const body = await readBoundedResponse(res, MAX_OSZ_BYTES);
      // A PK header is not enough. Check the central directory before returning
      // success, otherwise malformed downloads are cached and block fallbacks.
      validateMirrorZip(new Uint8Array(body));
      return { body, mirror: m.name };
    } catch (e) {
      errors.push(`${m.name}: ${(e as Error).message}`);
    }
  }
  throw new HttpError(502, 'No beatmap mirror could provide this map (' + errors.join('; ') + ')');
}

/** The bare .osu file (no audio). Public, no auth needed. */
export async function fetchOsuFile(beatmapId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`https://osu.ppy.sh/osu/${beatmapId}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, 'Could not download the .osu file');
  const text = new TextDecoder().decode(new Uint8Array(await readBoundedResponse(res, MAX_OSU_TEXT_BYTES)));
  if (!text.startsWith('osu file format')) throw new HttpError(404, 'osu! returned no beatmap for that ID');
  return text;
}
