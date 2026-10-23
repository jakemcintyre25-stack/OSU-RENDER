import { describe, expect, it } from 'vitest';
import { renderFrameSequence, throwIfAborted } from '../src/render/export/frames';
import { createExportTimeline } from '../src/render/export/timeline';

describe('deterministic frame sequence', () => {
  it('renders every frame in order with exact output timestamps', async () => {
    const timeline = createExportTimeline({ startMs: 1000, endMs: 2000, rate: 1, fps: 30 });
    const rendered: number[] = [];
    const added: Array<{ timestamp: number; duration: number }> = [];
    const progress: Array<[number, number]> = [];
    await renderFrameSequence(timeline, (t) => rendered.push(t), {
      async add(timestamp, duration) { added.push({ timestamp, duration }); },
    }, { onProgress: (done, total) => progress.push([done, total]) });
    expect(rendered).toHaveLength(30);
    expect(rendered[0]).toBe(1000);
    expect(rendered[29]).toBeCloseTo(1000 + (29 * 1000) / 30, 6);
    expect(added[0]).toEqual({ timestamp: 0, duration: 1 / 30 });
    expect(added[29].timestamp).toBeCloseTo(29 / 30, 9);
    expect(progress).toHaveLength(30);
    expect(progress[0]).toEqual([1, 30]);
    expect(progress.at(-1)).toEqual([30, 30]);
  });

  it('rejects immediately when already aborted', async () => {
    const timeline = createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 30 });
    const controller = new AbortController();
    controller.abort();
    const render = () => { throw new Error('must not render'); };
    await expect(renderFrameSequence(timeline, render, { async add() {} }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops before the next frame when cancelled during encoding', async () => {
    const timeline = createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 30 });
    const controller = new AbortController();
    let renders = 0;
    await expect(renderFrameSequence(timeline, () => { renders++; }, {
      async add() { controller.abort(); },
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(renders).toBe(1);
  });

  it('propagates encoder errors unchanged', async () => {
    const timeline = createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 30 });
    await expect(renderFrameSequence(timeline, () => {}, {
      async add() { throw new Error('encoder failed'); },
    })).rejects.toThrow('encoder failed');
  });

  it('exposes the abort guard used by the audio mixer', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(/cancel/i);
  });
});
