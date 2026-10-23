/** Deterministic export timeline: map milliseconds -> fixed video frames.
 *
 * Video time is always `frame / fps`; map time advances at the beatmap's
 * effective rate (DT/HT included). The viewer speed preference and audio/visual
 * sync offset are preview-only and deliberately excluded from an export.
 */

export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  { id: '720p30', label: '720p · 30 fps', width: 1280, height: 720, fps: 30 },
  { id: '720p60', label: '720p · 60 fps', width: 1280, height: 720, fps: 60 },
  { id: '1080p30', label: '1080p · 30 fps', width: 1920, height: 1080, fps: 30 },
  { id: '1080p60', label: '1080p · 60 fps', width: 1920, height: 1080, fps: 60 },
] as const;

export function exportPreset(id: string): ExportPreset {
  const preset = EXPORT_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new RangeError('Unknown export preset');
  return preset;
}

export interface ExportTimelineInput {
  /** First rendered map millisecond (may be negative for AudioLeadIn/preroll). */
  startMs: number;
  /** Last rendered map millisecond. */
  endMs: number;
  /** Effective map rate: 1.5 for DT, 0.75 for HT. */
  rate: number;
  /** Integer output frame rate. */
  fps: number;
}

export interface ExportTimeline {
  readonly startMs: number;
  readonly endMs: number;
  readonly rate: number;
  readonly fps: number;
  /** Map-time span divided by rate, in seconds. */
  readonly sourceDurationSeconds: number;
  /** Number of encoded frames; always at least one. */
  readonly frameCount: number;
  /** Exact encoded video duration, `frameCount / fps` seconds. */
  readonly videoDurationSeconds: number;
  /** Seconds per frame. */
  readonly frameDurationSeconds: number;
  /** Map time to render for frame `frame`. */
  mapTimeAtFrame(frame: number): number;
  /** Output timestamp for frame `frame`. */
  outputTimeAtFrame(frame: number): number;
}

const finite = (value: number) => typeof value === 'number' && Number.isFinite(value);

export function createExportTimeline(input: ExportTimelineInput): ExportTimeline {
  const { startMs, endMs, rate, fps } = input;
  if (!finite(startMs) || !finite(endMs) || !finite(rate) || !finite(fps)) {
    throw new RangeError('Invalid export timeline');
  }
  if (endMs <= startMs) throw new RangeError('Export end must follow its start');
  if (rate <= 0) throw new RangeError('Export rate must be positive');
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
    throw new RangeError('Export FPS must be an integer from 1 to 120');
  }
  const sourceDurationSeconds = (endMs - startMs) / 1000 / rate;
  // Avoid adding a spurious frame when the duration lands exactly on a frame.
  const frameCount = Math.max(1, Math.ceil((sourceDurationSeconds * fps) - 1e-9));
  const videoDurationSeconds = frameCount / fps;
  const frameDurationSeconds = 1 / fps;
  return {
    startMs,
    endMs,
    rate,
    fps,
    sourceDurationSeconds,
    frameCount,
    videoDurationSeconds,
    frameDurationSeconds,
    mapTimeAtFrame(frame: number) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
        throw new RangeError('Export frame out of range');
      }
      return startMs + (frame * 1000 * rate) / fps;
    },
    outputTimeAtFrame(frame: number) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
        throw new RangeError('Export frame out of range');
      }
      return frame / fps;
    },
  };
}

export function exportFilename(player: string, preset: ExportPreset, extension: 'mp4' | 'webm'): string {
  const name = player
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'player';
  return `osu-replay-${name}-${preset.height}p${preset.fps}.${extension}`;
}
