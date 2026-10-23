import { getRecentPlays, getReplay, lookupBeatmapByChecksum, HttpError, type OsuEnv } from './osu';
import { fetchBeatmapset, fetchOsuFile } from './mirrors';

export interface Env extends OsuEnv {
  ASSETS: Fetcher;
  LIMITER?: RateLimit;
}

const json = (data: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

/** Serve from the Cloudflare edge cache when possible; otherwise build and store. */
async function cached(req: Request, ctx: ExecutionContext, ttlSeconds: number, build: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(new URL(req.url).toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = await build();
  if (cache && res.ok) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(key, copy));
  }
  return res;
}

/** Baseline response hardening applied to API and static-asset responses.
 * CSP is intentionally absent until the player/export paths have been verified
 * against a real policy; these headers do not change response bodies.
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
];

export function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const ID = /^\d{1,12}$/;

export async function handleApi(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  if (env.LIMITER) {
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many requests — slow down a little' }, 429);
  }

  let m: RegExpMatchArray | null;

  if (path === '/api/health') return json({ ok: true, osuConfigured: Boolean(env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET) });

  if ((m = path.match(/^\/api\/users\/([^/]+)\/recent$/))) {
    const user = decodeURIComponent(m[1]).trim();
    const limit = Number(url.searchParams.get('limit') ?? 30);
    return json(await getRecentPlays(env, user, Number.isFinite(limit) ? limit : 30));
  }

  if ((m = path.match(/^\/api\/scores\/([^/]+)\/replay$/))) {
    if (!ID.test(m[1])) return json({ error: 'Bad score ID' }, 400);
    const id = m[1];
    return cached(req, ctx, 60 * 60 * 24 * 30, async () => {
      const body = await getReplay(env, id);
      return new Response(body, {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${id}.osr"` },
      });
    });
  }

  if ((m = path.match(/^\/api\/beatmapsets\/([^/]+)\/download$/))) {
    if (!ID.test(m[1])) return json({ error: 'Bad beatmapset ID' }, 400);
    const id = m[1];
    return cached(req, ctx, 60 * 60 * 24 * 7, async () => {
      const { body, mirror } = await fetchBeatmapset(id);
      return new Response(body, { headers: { 'Content-Type': 'application/zip', 'X-Mirror': mirror } });
    });
  }

  if ((m = path.match(/^\/api\/beatmaps\/([^/]+)\/osu$/))) {
    if (!ID.test(m[1])) return json({ error: 'Bad beatmap ID' }, 400);
    const id = m[1];
    return cached(req, ctx, 60 * 60 * 24, async () => new Response(await fetchOsuFile(id), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  }

  if (path === '/api/beatmaps/lookup') {
    const md5 = url.searchParams.get('checksum') ?? '';
    if (!/^[a-f0-9]{32}$/i.test(md5)) return json({ error: 'Bad checksum' }, 400);
    return json(await lookupBeatmapByChecksum(env, md5.toLowerCase()));
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return applySecurityHeaders(await handleApi(req, env, ctx));
      } catch (e) {
        if (e instanceof HttpError) return applySecurityHeaders(json({ error: e.message }, e.status));
        console.error(e);
        return applySecurityHeaders(json({ error: 'Something went wrong on the server' }, 500));
      }
    }
    return applySecurityHeaders(await env.ASSETS.fetch(req));
  },
} satisfies ExportedHandler<Env>;
