export interface RecentPlay {
  scoreId: number;
  beatmapId: number;
  beatmapsetId: number;
  title: string;
  artist: string;
  version: string;
  creator: string;
  coverUrl: string | null;
  mods: string[];
  accuracy: number;
  rank: string;
  passed: boolean;
  maxCombo: number;
  pp: number | null;
  endedAt: string | null;
  hasReplay: boolean;
  isLazer: boolean;
  starRating: number | null;
}

const MAX_REPLAY_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_BEATMAPSET_DOWNLOAD_BYTES = 150 * 1024 * 1024;
const MAX_OSU_TEXT_BYTES = 8 * 1024 * 1024;

/** Enforce a response limit as bytes arrive; reported Content-Length is not trusted. */
export async function readLimitedResponse(
  response: Response,
  maxBytes: number,
  onProgress?: (progress: number) => void,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid download limit');
  const announced = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new Error('Download too large');
  }
  if (!response.body) throw new Error('Download has no readable body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      got += value.byteLength;
      if (got > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Download too large');
      }
      chunks.push(value);
      onProgress?.(announced > 0 ? Math.min(1, got / announced) : -1);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.byteLength;
  }
  return out;
}

async function errorFrom(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    return new Error(body.error ?? `Request failed (${res.status})`);
  } catch {
    return new Error(`Request failed (${res.status})`);
  }
}

export async function getRecent(user: string): Promise<{ user: { id: number; username: string; avatarUrl: string | null }; plays: RecentPlay[] }> {
  const res = await fetch(`/api/users/${encodeURIComponent(user)}/recent?limit=50`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function getReplayFile(scoreId: number, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(`/api/scores/${scoreId}/replay`, { signal });
  if (!res.ok) throw await errorFrom(res);
  return readLimitedResponse(res, MAX_REPLAY_DOWNLOAD_BYTES);
}

/** Downloads a beatmapset with bounded memory; callbacks report 0..1 or -1. */
export async function getBeatmapset(setId: number, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(`/api/beatmapsets/${setId}/download`, { signal });
  if (!res.ok) throw await errorFrom(res);
  return readLimitedResponse(res, MAX_BEATMAPSET_DOWNLOAD_BYTES, onProgress);
}

export async function getOsuFile(beatmapId: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/api/beatmaps/${beatmapId}/osu`, { signal });
  if (!res.ok) throw await errorFrom(res);
  return new TextDecoder().decode(await readLimitedResponse(res, MAX_OSU_TEXT_BYTES));
}

export async function lookupBeatmap(md5: string, signal?: AbortSignal): Promise<{ beatmapId: number; beatmapsetId: number }> {
  const res = await fetch(`/api/beatmaps/lookup?checksum=${md5}`, { signal });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}
