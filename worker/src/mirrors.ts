// Beatmap downloads. osu.ppy.sh's own .osz download needs a logged-in browser session,
// so full beatmapsets (audio, background, hitsounds) come from community mirrors.

import { HttpError } from './osu';
import { validateMirrorZip } from './zip-envelope';
import { MirrorHealth, mirrorHealth, parseRetryAfter } from './mirror-health';

export const MIRRORS: { name: string; url: (setId: string) => string }[] = [
  { name: 'catboy', url: (id) => `https://catboy.best/d/${id}` },
  { name: 'nerinyan', url: (id) => `https://api.nerinyan.moe/d/${id}` },
  { name: 'osu.direct', url: (id) => `https://osu.direct/api/d/${id}` },
];


const MAX_OSZ_BYTES = 150 * 1024 * 1024;
const MAX_OSU_TEXT_BYTES = 8 * 1024 * 1024;

// Existing module contract re-exports the shared bounded-stream helper.
export { readBoundedResponse } from './bounded-stream';
import { readBoundedResponse } from './bounded-stream';


/** Tries each mirror in turn and returns the first response that is really a zip. */
export async function fetchBeatmapset(
  setId: string,
  fetchImpl: typeof fetch = fetch,
  health: MirrorHealth = mirrorHealth,
  now: () => number = Date.now,
): Promise<{ body: ArrayBuffer; mirror: string }> {
  const errors: string[] = [];
  for (const m of MIRRORS) {
    if (!health.canAttempt(m.name, now())) {
      errors.push(`${m.name}: skipped during cooldown`);
      continue;
    }
    try {
      const res = await fetchImpl(m.url(setId), {
        headers: { 'User-Agent': 'osu-render (+https://github.com/jakemcintyre25-stack/osu-render)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        // 404 means this beatmap may be absent, not that the host is unhealthy.
        // Backoff only for server, rate-limit or access failures.
        if (res.status >= 500 || res.status === 429 || res.status === 403) {
          const at = now();
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'), at);
          health.recordFailure(m.name, at, retryAfter);
        }
        errors.push(`${m.name}: HTTP ${res.status}`);
        continue;
      }
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_OSZ_BYTES) {
        health.recordFailure(m.name, now());
        errors.push(`${m.name}: too large`);
        continue;
      }
      const body = await readBoundedResponse(res, MAX_OSZ_BYTES);
      // A PK header is not enough. Check the central directory before returning
      // success, otherwise malformed downloads are cached and block fallbacks.
      validateMirrorZip(new Uint8Array(body));
      health.recordSuccess(m.name);
      return { body, mirror: m.name };
    } catch (e) {
      health.recordFailure(m.name, now());
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
