/** Frame-by-frame export loop shared by tests and the real encoder pipeline. */

import type { ExportTimeline } from './timeline';

export interface FrameSink {
  add(timestamp: number, duration: number): Promise<void>;
}

export interface FrameSequenceOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }
}

/** Render and submit every frame in presentation order.
 * The renderer is advanced by map time, never by wall-clock time, so a slow
 * encoder or preview frame drops cannot change the exported frame timestamps.
 */
export async function renderFrameSequence(
  timeline: ExportTimeline,
  render: (mapTimeMs: number) => void,
  sink: FrameSink,
  options: FrameSequenceOptions = {},
): Promise<void> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  for (let frame = 0; frame < timeline.frameCount; frame++) {
    throwIfAborted(signal);
    render(timeline.mapTimeAtFrame(frame));
    await sink.add(timeline.outputTimeAtFrame(frame), timeline.frameDurationSeconds);
    throwIfAborted(signal);
    onProgress?.(frame + 1, timeline.frameCount);
  }
}
