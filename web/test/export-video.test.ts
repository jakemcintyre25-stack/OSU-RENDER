import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportCodecChoice } from '../src/render/export/codecs';
import { createExportTimeline, exportPreset } from '../src/render/export/timeline';

const mock = vi.hoisted(() => ({
  outputs: [] as Array<Record<string, unknown>>,
  video: [] as Array<Record<string, unknown>>,
  audio: [] as Array<Record<string, unknown>>,
  cancelled: 0,
}));

vi.mock('mediabunny', () => {
  class Quality { constructor(public level: string) {} }
  class BufferTarget { buffer: ArrayBuffer | null = null; }
  class Mp4OutputFormat { mimeType = 'video/mp4'; }
  class WebMOutputFormat { mimeType = 'video/webm'; }
  class Output {
    state = 'pending';
    target: InstanceType<typeof BufferTarget>;
    format: { mimeType: string };
    videoTrack: Record<string, unknown> | null = null;
    audioTrack: Record<string, unknown> | null = null;
    constructor(options: { format: { mimeType: string }; target: InstanceType<typeof BufferTarget> }) {
      this.format = options.format;
      this.target = options.target;
      mock.outputs.push(this as unknown as Record<string, unknown>);
    }
    addVideoTrack(source: unknown, metadata: unknown) { this.videoTrack = { source, metadata }; }
    addAudioTrack(source: unknown, metadata: unknown) { this.audioTrack = { source, metadata }; }
    async start() { this.state = 'started'; }
    // Regression guard: real Mediabunny waits for the first encoded packet
    // here, so exporting must never call getMimeType() before submitting frames.
    async getMimeType(): Promise<string> { throw new Error('getMimeType called too early'); }
    async finalize() { this.state = 'finalized'; this.target.buffer = new ArrayBuffer(16); }
    async cancel() { this.state = 'cancelled'; mock.cancelled++; }
  }
  class CanvasSource {
    config: unknown;
    frames: Array<{ timestamp: number; duration: number }> = [];
    constructor(_canvas: unknown, config: unknown) { this.config = config; mock.video.push(this as unknown as Record<string, unknown>); }
    async add(timestamp: number, duration?: number) {
      this.frames.push({ timestamp, duration: duration ?? 0 });
    }
  }
  class AudioBufferSource {
    config: unknown;
    buffers: AudioBuffer[] = [];
    constructor(config: unknown) { this.config = config; mock.audio.push(this as unknown as Record<string, unknown>); }
    async add(buffer: AudioBuffer) { this.buffers.push(buffer); }
  }
  return { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, AudioBufferSource, Quality };
});

import { exportReplayVideo } from '../src/render/export/export-video';

const mp4: ExportCodecChoice = {
  container: 'mp4', extension: 'mp4', mime: 'video/mp4', video: 'avc', audio: 'aac',
};
const preset = exportPreset('720p30');

beforeEach(() => {
  mock.outputs.length = 0;
  mock.video.length = 0;
  mock.audio.length = 0;
  mock.cancelled = 0;
});

function fakeRenderer() {
  const rendered: number[] = [];
  return {
    rendered,
    renderer: {
      app: { canvas: {} as HTMLCanvasElement },
      render: (t: number) => { rendered.push(t); },
    },
  };
}

describe('deterministic export pipeline', () => {
  it('adds audio, renders every frame and finalises the file', async () => {
    const { rendered, renderer } = fakeRenderer();
    const timeline = createExportTimeline({ startMs: 0, endMs: 100, rate: 1, fps: 30 });
    const audio = { duration: 1 } as AudioBuffer;
    const result = await exportReplayVideo({ renderer, timeline, preset, codecs: mp4, audio });
    expect(mock.outputs).toHaveLength(1);
    const output = mock.outputs[0] as unknown as {
      state: string;
      videoTrack: Record<string, unknown>;
      audioTrack: Record<string, unknown>;
    };
    const videoSource = mock.video[0] as unknown as { frames: Array<{ timestamp: number; duration: number }> };
    const audioSource = mock.audio[0] as unknown as { buffers: AudioBuffer[] };
    expect(output.state).toBe('finalized');
    expect(output.videoTrack.metadata).toEqual({ frameRate: 30 });
    expect(output.audioTrack).toBeTruthy();
    expect(audioSource.buffers).toEqual([audio]);
    expect(videoSource.frames).toEqual([
      { timestamp: 0, duration: 1 / 30 },
      { timestamp: 1 / 30, duration: 1 / 30 },
      { timestamp: 2 / 30, duration: 1 / 30 },
    ]);
    expect(rendered).toHaveLength(3);
    expect(rendered[1]).toBeCloseTo(100 / 3, 6);
    expect(result).toMatchObject({ bytes: 16, extension: 'mp4', mime: 'video/mp4', frameCount: 3 });
  });

  it('omits the audio track when no audio encoder or buffer is available', async () => {
    const { renderer } = fakeRenderer();
    const timeline = createExportTimeline({ startMs: 0, endMs: 100, rate: 1, fps: 30 });
    await exportReplayVideo({ renderer, timeline, preset, codecs: { ...mp4, audio: null }, audio: null });
    const output = mock.outputs[0] as unknown as { audioTrack: unknown };
    expect(output.audioTrack).toBeNull();
    expect(mock.audio).toHaveLength(0);
  });

  it('rejects before creating an output when already cancelled', async () => {
    const { renderer } = fakeRenderer();
    const timeline = createExportTimeline({ startMs: 0, endMs: 100, rate: 1, fps: 30 });
    const controller = new AbortController();
    controller.abort();
    await expect(exportReplayVideo({
      renderer, timeline, preset, codecs: mp4, audio: null, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.outputs).toHaveLength(0);
  });

  it('cancels an in-flight output when the frame loop is aborted', async () => {
    const { renderer } = fakeRenderer();
    const controller = new AbortController();
    renderer.render = (t: number) => { if (t > 0) controller.abort(); };
    const timeline = createExportTimeline({ startMs: 0, endMs: 100, rate: 1, fps: 30 });
    await expect(exportReplayVideo({
      renderer, timeline, preset, codecs: mp4, audio: null, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.cancelled).toBe(1);
  });
});
