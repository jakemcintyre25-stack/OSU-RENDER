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

export async function getReplayFile(scoreId: number): Promise<Uint8Array> {
  const res = await fetch(`/api/scores/${scoreId}/replay`);
  if (!res.ok) throw await errorFrom(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** Downloads a beatmapset with progress callbacks (0..1, or -1 when the size is unknown). */
export async function getBeatmapset(setId: number, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const res = await fetch(`/api/beatmapsets/${setId}/download`);
  if (!res.ok) throw await errorFrom(res);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(total ? got / total : -1);
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function getOsuFile(beatmapId: number): Promise<string> {
  const res = await fetch(`/api/beatmaps/${beatmapId}/osu`);
  if (!res.ok) throw await errorFrom(res);
  return res.text();
}

export async function lookupBeatmap(md5: string): Promise<{ beatmapId: number; beatmapsetId: number }> {
  const res = await fetch(`/api/beatmaps/lookup?checksum=${md5}`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}
