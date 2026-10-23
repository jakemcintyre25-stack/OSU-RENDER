import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_MIRROR_COOLDOWN_MS, MIRROR_COOLDOWN_MS, MIRROR_FAILURE_THRESHOLD, MirrorHealth, parseRetryAfter } from '../src/mirror-health';
import { fetchBeatmapset } from '../src/mirrors';
import { storedZip } from './zip-fixture';

const responseZip = storedZip();
beforeEach(() => { /* each test creates an isolated health instance */ });

describe('M11 rate-limiting repeated failing beatmap mirror hosts', () => {
  it('stays available before three consecutive failures', () => {
    const h = new MirrorHealth();
    expect(MIRROR_FAILURE_THRESHOLD).toBe(3);
    for (let i = 1; i < MIRROR_FAILURE_THRESHOLD; i++) {
      h.recordFailure('catboy', 1000);
      expect(h.canAttempt('catboy', 1000)).toBe(true);
      expect(h.status('catboy').consecutiveFailures).toBe(i);
    }
  });

  it('suppresses a failed mirror for 10 minutes, then retries it', () => {
    const h = new MirrorHealth();
    for (let i = 0; i < 3; i++) h.recordFailure('catboy', 1000);
    expect(h.status('catboy').unavailableUntil).toBe(1000 + MIRROR_COOLDOWN_MS);
    expect(h.canAttempt('catboy', 1000 + MIRROR_COOLDOWN_MS - 1)).toBe(false);
    expect(h.canAttempt('catboy', 1000 + MIRROR_COOLDOWN_MS)).toBe(true);
    expect(h.status('catboy').consecutiveFailures).toBe(0);
  });

  it('successful retrieval clears failures, leaving other mirrors untouched', () => {
    const h = new MirrorHealth();
    h.recordFailure('catboy', 50);
    h.recordFailure('nerinyan', 50);
    h.recordSuccess('catboy');
    expect(h.status('catboy').consecutiveFailures).toBe(0);
    expect(h.status('nerinyan').consecutiveFailures).toBe(1);
  });

  it('skips a blocked mirror in real fetchBeatmapset fallback without changing other providers', async () => {
    const h = new MirrorHealth();
    const calls: string[] = [];
    const mock = (async (url: string) => {
      calls.push(url);
      if (url.includes('catboy')) return new Response('down', { status: 503 });
      return new Response(responseZip);
    }) as unknown as typeof fetch;
    const now = () => 1000;
    for (let i = 0; i < 3; i++) {
      const out = await fetchBeatmapset('123', mock, h, now);
      expect(out.mirror).toBe('nerinyan');
    }
    expect(h.canAttempt('catboy', 1000)).toBe(false);
    calls.length = 0;
    expect((await fetchBeatmapset('456', mock, h, now)).mirror).toBe('nerinyan');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('nerinyan');
  });

  it('does not trip the provider breaker on map-specific HTTP 404 responses', async () => {
    const h = new MirrorHealth();
    const mock = (async (url: string) =>
      url.includes('catboy') ? new Response('not found', { status: 404 }) : new Response(responseZip)
    ) as unknown as typeof fetch;
    for (let i = 0; i < 4; i++) await fetchBeatmapset('123', mock, h, () => 1000);
    expect(h.status('catboy').consecutiveFailures).toBe(0);
    expect(h.canAttempt('catboy', 1000)).toBe(true);
  });

  it('counts corrupt successful-HTTP ZIPs as mirror failures', async () => {
    const h = new MirrorHealth();
    const mock = (async (url: string) =>
      url.includes('catboy') ? new Response('<html>unusable</html>') : new Response(responseZip)
    ) as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) await fetchBeatmapset('123', mock, h, () => 1000);
    expect(h.canAttempt('catboy', 1000)).toBe(false);
  });

  it('does not request any provider when all are in cooldown, returning a descriptive error', async () => {
    const h = new MirrorHealth();
    for (const host of ['catboy', 'nerinyan', 'osu.direct']) {
      for (let i = 0; i < 3; i++) h.recordFailure(host, 1000);
    }
    let called = false;
    const never = (async () => {
      called = true;
      throw new Error('unexpected');
    }) as unknown as typeof fetch;
    await expect(fetchBeatmapset('123', never, h, () => 1000)).rejects.toThrow(/cooldown/);
    expect(called).toBe(false);
  });

  it('parses Retry-After delta-seconds, HTTP dates and invalid values', () => {
    expect(parseRetryAfter('120', 1000)).toBe(120_000);
    expect(parseRetryAfter(new Date(61_000).toUTCString(), 1000)).toBe(60_000);
    expect(parseRetryAfter('0', 1000)).toBe(0);
    expect(parseRetryAfter('-5', 1000)).toBe(0);
    expect(parseRetryAfter('nonsense', 1000)).toBe(0);
    expect(parseRetryAfter(null, 1000)).toBe(0);
    expect(parseRetryAfter(String(7 * 24 * 3600), 1000)).toBe(MAX_MIRROR_COOLDOWN_MS);
  });

  it('honours a provider Retry-After after one failure and caps excessive values', () => {
    const h = new MirrorHealth();
    h.recordFailure('catboy', 1000, 30 * 60 * 1000);
    expect(h.status('catboy').consecutiveFailures).toBe(1);
    expect(h.status('catboy').unavailableUntil).toBe(1000 + 30 * 60 * 1000);
    expect(h.canAttempt('catboy', 1000 + 30 * 60 * 1000 - 1)).toBe(false);
    expect(h.canAttempt('catboy', 1000 + 30 * 60 * 1000)).toBe(true);

    h.recordFailure('nerinyan', 1000, 7 * 24 * 3600 * 1000);
    expect(h.status('nerinyan').unavailableUntil).toBe(1000 + MAX_MIRROR_COOLDOWN_MS);
  });

  it('uses Retry-After from a real rate-limited mirror response', async () => {
    const h = new MirrorHealth();
    const mock = (async (url: string) =>
      url.includes('catboy')
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '1800' } })
        : new Response(responseZip)
    ) as unknown as typeof fetch;
    const out = await fetchBeatmapset('123', mock, h, () => 1000);
    expect(out.mirror).toBe('nerinyan');
    expect(h.status('catboy').unavailableUntil).toBe(1000 + 1800_000);
    expect(h.canAttempt('catboy', 1000 + 1799_999)).toBe(false);
  });

  it('never shortens an existing cooldown when a later retry hint arrives', () => {
    const h = new MirrorHealth();
    h.recordFailure('catboy', 1000, 60 * 60 * 1000);
    h.recordFailure('catboy', 2000, 10 * 60 * 1000);
    expect(h.status('catboy').unavailableUntil).toBe(1000 + 60 * 60 * 1000);
    h.recordFailure('catboy', 3000, 2 * 60 * 60 * 1000);
    expect(h.status('catboy').unavailableUntil).toBe(3000 + 2 * 60 * 60 * 1000);
  });
});
