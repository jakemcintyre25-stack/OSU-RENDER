import { describe, expect, it } from 'vitest';
import { readBoundedResponse } from '../src/bounded-stream';

describe('bounded upstream streaming contract', () => {
  it('rejects malformed, negative, exponent and unsafe declared sizes', async () => {
    for (const length of ['-1', '1e30', 'Infinity', 'NaN', '9007199254740993', '01', '3.5']) {
      const response = new Response(new Uint8Array([1, 2]), { headers: { 'Content-Length': length } });
      await expect(readBoundedResponse(response, 10)).rejects.toThrow(/Content-Length|too large/);
    }
  });
  it('accepts exact limit and a zero-length body', async () => {
    expect(new Uint8Array(await readBoundedResponse(new Response(new Uint8Array([1, 2, 3])), 3))).toEqual(new Uint8Array([1, 2, 3]));
    expect((await readBoundedResponse(new Response(new Uint8Array()), 3)).byteLength).toBe(0);
  });
  it('rejects a streamed overrun despite a small declared length', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    }), { headers: { 'Content-Length': '2' } });
    await expect(readBoundedResponse(response, 4)).rejects.toThrow(/streamed length/);
  });
  it('rejects invalid operational limits', async () => {
    for (const limit of [0, -1, NaN, Infinity, 1.2]) {
      await expect(readBoundedResponse(new Response('abc'), limit)).rejects.toThrow(/byte limit/);
    }
  });
});
