import { describe, expect, it } from 'vitest';
import { readLimitedResponse } from '../src/api';

const response = (chunks: number[][], headers: HeadersInit = {}) => new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  }),
  { headers },
);

describe('client-side bounded download streaming', () => {
  it('reports progress and assembles the exact bytes of a valid stream', async () => {
    const seen: number[] = [];
    const downloaded = await readLimitedResponse(
      response([[1, 2], [3, 4]], { 'content-length': '4' }), 4, (p) => seen.push(p),
    );
    expect([...downloaded]).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([0.5, 1]);
  });

  it('rejects an excessive Content-Length before allocating a download buffer', async () => {
    await expect(readLimitedResponse(response([[1]], { 'content-length': '99' }), 3))
      .rejects.toThrow(/too large/i);
  });

  it('rejects streamed overrun when Content-Length is missing or misleading', async () => {
    await expect(readLimitedResponse(response([[1, 2], [3, 4]]), 3))
      .rejects.toThrow(/too large/i);
    await expect(readLimitedResponse(response([[1, 2], [3, 4]], { 'content-length': '2' }), 3))
      .rejects.toThrow(/too large/i);
  });

  it('reports unknown-size progress and handles empty readable responses', async () => {
    const seen: number[] = [];
    const bytes = await readLimitedResponse(response([[8], [9]]), 5, (p) => seen.push(p));
    expect([...bytes]).toEqual([8, 9]);
    expect(seen).toEqual([-1, -1]);
    expect([...await readLimitedResponse(response([]), 5)]).toEqual([]);
  });
});
