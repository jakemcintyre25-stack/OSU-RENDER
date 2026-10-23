import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackRequestGate } from '../src/playback-gate';
import { getBeatmapset, getOsuFile, getReplayFile, lookupBeatmap } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

describe('M8 abort-aware browser API integrations', () => {
  it('forwards an abort signal through replay, set, osu and lookup fetches', async () => {
    const captured: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      captured.push({ url, signal: options?.signal ?? undefined });
      if (url.includes('lookup')) return new Response(JSON.stringify({ beatmapId: 3, beatmapsetId: 4 }), { headers: { 'content-type': 'application/json' } });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const gate = new PlaybackRequestGate();
    const lease = gate.begin();
    expect([...await getReplayFile(42, lease.signal)]).toEqual([1, 2, 3]);
    expect([...await getBeatmapset(10, undefined, lease.signal)]).toEqual([1, 2, 3]);
    expect(await getOsuFile(7, lease.signal)).toHaveLength(3);
    expect(await lookupBeatmap('abcdef', lease.signal)).toEqual({ beatmapId: 3, beatmapsetId: 4 });
    expect(captured.map(x => x.url)).toEqual([
      '/api/scores/42/replay',
      '/api/beatmapsets/10/download',
      '/api/beatmaps/7/osu',
      '/api/beatmaps/lookup?checksum=abcdef',
    ]);
    expect(captured.every(x => x.signal === lease.signal)).toBe(true);
  });

  it('aborts a pending replay fetch when a new selection starts', async () => {
    const gate = new PlaybackRequestGate();
    vi.stubGlobal('fetch', (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }));
    const lease = gate.begin();
    const pending = getReplayFile(123, lease.signal);
    gate.begin();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
