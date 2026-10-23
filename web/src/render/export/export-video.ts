/** Deterministic replay export: fixed-frame CanvasSource + offline audio mix,
 * muxed by Mediabunny into MP4 (H.264/AAC) or WebM (VP9/VP8 + Opus).
 *
 * This path is intentionally separate from the real-time MediaRecorder
 * fallback. It never reads the wall clock and never records the visible canvas.
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import { renderFrameSequence, throwIfAborted } from './frames';
import {
  describeCodecChoice,
  selectExportCodecs,
  type ExportCodecChoice,
  type SupportedEncoders,
} from './codecs';
import type { ExportPreset, ExportTimeline } from './timeline';

export interface ExportRenderer {
  readonly app: { readonly canvas: HTMLCanvasElement | OffscreenCanvas };
  render(mapTimeMs: number): void;
}

export interface ExportVideoOptions {
  renderer: ExportRenderer;
  timeline: ExportTimeline;
  preset: ExportPreset;
  codecs: ExportCodecChoice;
  audio: AudioBuffer | null;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface ExportVideoResult {
  buffer: ArrayBuffer;
  mime: string;
  extension: 'mp4' | 'webm';
  codecs: ExportCodecChoice;
  bytes: number;
  durationSeconds: number;
  frameCount: number;
  description: string;
}

async function safeCheck(check: Promise<boolean>): Promise<boolean> {
  try {
    return await check;
  } catch {
    return false;
  }
}

/** Probe the encoders this browser can actually provide for a given frame size. */
export async function detectExportCodecs(width: number, height: number): Promise<ExportCodecChoice | null> {
  const quality = new Quality('high');
  const [avc, aac, vp9, vp8, opus] = await Promise.all([
    safeCheck(canEncodeVideo('avc', { width, height, quality })),
    safeCheck(canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, quality })),
    safeCheck(canEncodeVideo('vp9', { width, height, quality })),
    safeCheck(canEncodeVideo('vp8', { width, height, quality })),
    safeCheck(canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48_000, quality })),
  ]);
  const supported: SupportedEncoders = { avc, aac, vp9, vp8, opus };
  return selectExportCodecs(supported);
}

/** Export the complete replay. Caller owns the renderer and audio buffer. */
export async function exportReplayVideo(options: ExportVideoOptions): Promise<ExportVideoResult> {
  const { renderer, timeline, codecs, audio, signal, onProgress } = options;
  throwIfAborted(signal);
  const canvas = renderer.app.canvas;
  const output = new Output({
    format: codecs.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, {
    codec: codecs.video,
    quality: new Quality('high'),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: timeline.fps });
  let audioSource: AudioBufferSource | null = null;
  if (audio && codecs.audio) {
    audioSource = new AudioBufferSource({ codec: codecs.audio, quality: new Quality('high') });
    output.addAudioTrack(audioSource);
  }
  try {
    await output.start();
    // Do not await output.getMimeType() here: it waits for the first encoded
    // packet's codec metadata, which cannot arrive before frames are submitted.
    if (audioSource && audio) await audioSource.add(audio);
    throwIfAborted(signal);
    await renderFrameSequence(timeline, (mapTime) => renderer.render(mapTime), {
      add: (timestamp, duration) => videoSource.add(timestamp, duration),
    }, { signal, onProgress });
    throwIfAborted(signal);
    await output.finalize();
  } catch (error) {
    try {
      await output.cancel();
    } catch {
      /* already finalized or cancelled */
    }
    throw error;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Export produced no file');
  return {
    buffer,
    mime: codecs.mime,
    extension: codecs.extension,
    codecs,
    bytes: buffer.byteLength,
    durationSeconds: timeline.videoDurationSeconds,
    frameCount: timeline.frameCount,
    description: describeCodecChoice(codecs),
  };
}
