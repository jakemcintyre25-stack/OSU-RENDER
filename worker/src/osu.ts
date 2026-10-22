// osu! API v2 access using the app's own client-credentials token.
// No user tokens are needed: recent scores and replay downloads only need the `public` scope.

export interface OsuEnv {
  OSU_CLIENT_ID?: string;
  OSU_CLIENT_SECRET?: string;
}

const API = 'https://osu.ppy.sh/api/v2';
const TOKEN_URL = 'https://osu.ppy.sh/oauth/token';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null;

/** Exposed for tests. */
export function resetTokenCache() {
  cachedToken = null;
}

export async function getAppToken(env: OsuEnv, now = Date.now()): Promise<string> {
  if (!env.OSU_CLIENT_ID || !env.OSU_CLIENT_SECRET) {
    throw new HttpError(503, 'osu! API credentials are not configured on the server');
  }
  if (cachedToken && cachedToken.clientId === env.OSU_CLIENT_ID && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.OSU_CLIENT_ID,
      client_secret: env.OSU_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'public',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(502, 'Could not get an osu! API token');
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new HttpError(502, 'osu! returned an invalid token');
  cachedToken = {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
    clientId: env.OSU_CLIENT_ID,
  };
  return cachedToken.value;
}

async function osuFetch(env: OsuEnv, path: string, accept = 'application/json'): Promise<Response> {
  const token = await getAppToken(env);
  return fetch(API + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: accept,
      'x-api-version': '20220705',
    },
    signal: AbortSignal.timeout(15000),
  });
}

/** A recent play, trimmed to what the picker needs. Handles both the old and new score formats. */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toRecentPlay(s: any): RecentPlay {
  const mods: string[] = Array.isArray(s.mods)
    ? s.mods.map((m: unknown) => (typeof m === 'string' ? m : (m as { acronym?: string })?.acronym)).filter(Boolean)
    : [];
  const set = s.beatmapset ?? {};
  const map = s.beatmap ?? {};
  // New format: has_replay + legacy_score_id. Old format: replay boolean, id is the legacy id.
  const hasReplay = Boolean(s.has_replay ?? s.replay);
  const isLazer = 'legacy_score_id' in s ? s.legacy_score_id == null && s.build_id != null : false;
  return {
    scoreId: Number(s.id),
    beatmapId: Number(map.id ?? s.beatmap_id),
    beatmapsetId: Number(set.id ?? map.beatmapset_id),
    title: String(set.title ?? ''),
    artist: String(set.artist ?? ''),
    version: String(map.version ?? ''),
    creator: String(set.creator ?? ''),
    coverUrl: set.covers?.['list@2x'] ?? set.covers?.list ?? null,
    mods: mods.filter((m) => m !== 'CL'),
    accuracy: Number(s.accuracy ?? 0),
    rank: String(s.rank ?? ''),
    passed: Boolean(s.passed ?? true),
    maxCombo: Number(s.max_combo ?? 0),
    pp: typeof s.pp === 'number' ? s.pp : null,
    endedAt: s.ended_at ?? s.created_at ?? null,
    hasReplay,
    isLazer,
    starRating: typeof map.difficulty_rating === 'number' ? map.difficulty_rating : null,
  };
}

const USERNAME = /^[A-Za-z0-9 _\-\[\]]{2,15}$/;

export async function getRecentPlays(env: OsuEnv, user: string, limit = 30): Promise<{ user: { id: number; username: string; avatarUrl: string | null }; plays: RecentPlay[] }> {
  const isId = /^\d{1,10}$/.test(user);
  if (!isId && !USERNAME.test(user)) throw new HttpError(400, 'That is not a valid osu! username');
  const lookup = isId ? `/users/${user}/osu?key=id` : `/users/${encodeURIComponent('@' + user)}/osu`;
  const ures = await osuFetch(env, lookup);
  if (ures.status === 404) throw new HttpError(404, 'No osu! player with that name');
  if (!ures.ok) throw new HttpError(502, 'osu! user lookup failed');
  const u = (await ures.json()) as { id: number; username: string; avatar_url?: string };

  const sres = await osuFetch(env, `/users/${u.id}/scores/recent?mode=osu&include_fails=1&limit=${Math.min(Math.max(limit, 1), 100)}`);
  if (!sres.ok) throw new HttpError(502, 'Could not load recent plays from osu!');
  const scores = (await sres.json()) as unknown[];
  return {
    user: { id: u.id, username: u.username, avatarUrl: u.avatar_url ?? null },
    plays: (Array.isArray(scores) ? scores : []).map(toRecentPlay),
  };
}

/** Downloads a score's .osr replay. */
export async function getReplay(env: OsuEnv, scoreId: string): Promise<ArrayBuffer> {
  const res = await osuFetch(env, `/scores/${scoreId}/download`, 'application/octet-stream');
  if (res.status === 404) throw new HttpError(404, 'osu! has no replay saved for this score');
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, 'osu! refused the replay download (the app token may not be allowed to download replays)');
  }
  if (!res.ok) throw new HttpError(502, 'Replay download failed');
  return res.arrayBuffer();
}

/** Finds a beatmap by the MD5 hash stored in a replay header (used for uploaded .osr files). */
export async function lookupBeatmapByChecksum(env: OsuEnv, md5: string): Promise<{ beatmapId: number; beatmapsetId: number }> {
  const res = await osuFetch(env, `/beatmaps/lookup?checksum=${md5}`);
  if (res.status === 404) throw new HttpError(404, 'That beatmap is not on osu! (or has been updated since the replay was made)');
  if (!res.ok) throw new HttpError(502, 'Beatmap lookup failed');
  const b = (await res.json()) as { id: number; beatmapset_id: number };
  return { beatmapId: b.id, beatmapsetId: b.beatmapset_id };
}
