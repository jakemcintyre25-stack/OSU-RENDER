import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { resetTokenCache, toRecentPlay } from '../src/osu';
import { fetchBeatmapset, readBoundedResponse } from '../src/mirrors';

const env = { OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 's', ASSETS: { fetch: async () => new Response('asset') } } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
const call = (path: string) => worker.fetch(new Request('https://x.test' + path), env, ctx);

type Route = [RegExp, (url: string, init?: RequestInit) => Response];
function mockFetch(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return new Response('unmocked ' + url, { status: 599 });
  });
  return calls;
}
const tokenRoute: Route = [/oauth\/token$/, () => Response.json({ access_token: 'tok', expires_in: 86400 })];

const newFormatScore = {
  id: 4567,
  legacy_score_id: 123,
  build_id: null,
  has_replay: true,
  accuracy: 0.9876,
  rank: 'S',
  passed: true,
  max_combo: 812,
  pp: 301.2,
  ended_at: '2026-10-22T01:00:00Z',
  mods: [{ acronym: 'HD' }, { acronym: 'DT' }, { acronym: 'CL' }],
  beatmap: { id: 75, beatmapset_id: 1, version: 'Normal', difficulty_rating: 2.1 },
  beatmapset: { id: 1, title: 'DISCO PRINCE', artist: 'Kenji Ninuma', creator: 'peppy', covers: { list: 'l.jpg', 'list@2x': 'l2.jpg' } },
};

beforeEach(() => {
  resetTokenCache();
  vi.unstubAllGlobals();
});

describe('recent plays', () => {
  it('looks up the user by name then lists recent scores', async () => {
    const calls = mockFetch([
      tokenRoute,
      [/\/users\/%40Shaxi\/osu$/, () => Response.json({ id: 7733645, username: 'Shaxi', avatar_url: 'a.png' })],
      [/\/users\/7733645\/scores\/recent/, () => Response.json([newFormatScore])],
    ]);
    const res = await call('/api/users/Shaxi/recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: number }; plays: ReturnType<typeof toRecentPlay>[] };
    expect(body.user.id).toBe(7733645);
    expect(body.plays[0]).toMatchObject({ scoreId: 4567, beatmapId: 75, beatmapsetId: 1, mods: ['HD', 'DT'], hasReplay: true, isLazer: false, coverUrl: 'l2.jpg' });
    expect(calls.some((c) => c.includes('include_fails=1'))).toBe(true);
  });

  it('reuses the app token between requests', async () => {
    const calls = mockFetch([
      tokenRoute,
      [/\/users\/%40Shaxi\/osu$/, () => Response.json({ id: 1, username: 'Shaxi' })],
      [/scores\/recent/, () => Response.json([])],
    ]);
    await call('/api/users/Shaxi/recent');
    await call('/api/users/Shaxi/recent');
    expect(calls.filter((c) => c.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('rejects junk usernames without calling osu!', async () => {
    const calls = mockFetch([tokenRoute]);
    const res = await call('/api/users/' + encodeURIComponent('<script>') + '/recent');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('returns 404 for an unknown player', async () => {
    mockFetch([tokenRoute, [/\/users\//, () => new Response('', { status: 404 })]]);
    expect((await call('/api/users/nobodyhere/recent')).status).toBe(404);
  });

  it('flags lazer scores and reads the old score format', () => {
    expect(toRecentPlay({ ...newFormatScore, legacy_score_id: null, build_id: 7 }).isLazer).toBe(true);
    const old = toRecentPlay({ id: 9, replay: false, mods: ['HR'], beatmap: { id: 2, beatmapset_id: 3 }, beatmapset: {} });
    expect(old).toMatchObject({ scoreId: 9, hasReplay: false, mods: ['HR'], beatmapsetId: 3, isLazer: false });
  });

  it('says clearly when credentials are missing', async () => {
    mockFetch([]);
    const res = await worker.fetch(new Request('https://x.test/api/users/Shaxi/recent'), { ASSETS: {} } as never, ctx);
    expect(res.status).toBe(503);
  });
});

describe('replays', () => {
  it('streams the .osr from osu!', async () => {
    mockFetch([tokenRoute, [/\/scores\/4567\/download$/, () => new Response(new Uint8Array([1, 2, 3]))]]);
    const res = await call('/api/scores/4567/replay');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('explains a missing replay', async () => {
    mockFetch([tokenRoute, [/download$/, () => new Response('', { status: 404 })]]);
    const res = await call('/api/scores/4567/replay');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/no replay/);
  });

  it('rejects non-numeric IDs', async () => {
    mockFetch([]);
    expect((await call('/api/scores/abc/replay')).status).toBe(400);
  });
});

describe('bounded mirror download streaming', () => {
  it('rejects an oversized declared body without buffering it', async () => {
    const response = new Response(new Uint8Array([1, 2]), {
      headers: { 'Content-Length': '100' },
    });
    await expect(readBoundedResponse(response, 5)).rejects.toThrow(/too large/i);
  });

  it('stops a stream that grows beyond the limit without trusting Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    await expect(readBoundedResponse(new Response(stream), 5)).rejects.toThrow(/too large/i);
  });

  it('assembles a bounded stream byte-for-byte', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x50, 0x4b]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    expect([...new Uint8Array(await readBoundedResponse(new Response(stream), 4))])
      .toEqual([0x50, 0x4b, 3, 4]);
  });
});

describe('beatmap mirrors', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]);
  it('falls back to the next mirror when one fails or returns HTML', async () => {
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u);
      if (u.includes('catboy')) return new Response('down', { status: 503 });
      if (u.includes('nerinyan')) return new Response('<html>');
      return new Response(zip);
    }) as unknown as typeof fetch;
    const out = await fetchBeatmapset('1', f);
    expect(out.mirror).toBe('osu.direct');
    expect(calls).toHaveLength(3);
  });

  it('errors with every mirror reason when all fail', async () => {
    const f = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchBeatmapset('1', f)).rejects.toThrow(/catboy: HTTP 500.*nerinyan.*osu.direct/);
  });

  it('serves the set through the API route', async () => {
    mockFetch([[/catboy\.best\/d\/1$/, () => new Response(zip)]]);
    const res = await call('/api/beatmapsets/1/download');
    expect(res.headers.get('X-Mirror')).toBe('catboy');
  });
});

describe('beatmap lookup', () => {
  it('finds a map by replay checksum', async () => {
    mockFetch([tokenRoute, [/beatmaps\/lookup\?checksum=0123456789abcdef0123456789abcdef$/, () => Response.json({ id: 75, beatmapset_id: 1 })]]);
    const res = await call('/api/beatmaps/lookup?checksum=0123456789ABCDEF0123456789abcdef');
    expect(await res.json()).toEqual({ beatmapId: 75, beatmapsetId: 1 });
  });
});

it('passes non-API paths to the static site', async () => {
  const res = await call('/');
  expect(await res.text()).toBe('asset');
});
