/** Container/codec preference for deterministic export, kept independent of
 * Mediabunny so the policy is unit-testable without WebCodecs. */

export type ExportContainer = 'mp4' | 'webm';
export type ExportVideoCodec = 'avc' | 'vp9' | 'vp8';
export type ExportAudioCodec = 'aac' | 'opus';

export interface ExportCodecChoice {
  container: ExportContainer;
  extension: 'mp4' | 'webm';
  mime: string;
  video: ExportVideoCodec;
  /** Null when no supported audio encoder exists; the file is then video-only. */
  audio: ExportAudioCodec | null;
}

export interface SupportedEncoders {
  avc: boolean;
  aac: boolean;
  vp9: boolean;
  vp8: boolean;
  opus: boolean;
}

/** MP4/H.264/AAC first, then WebM/VP9/Opus, then WebM/VP8/Opus.
 * A video-only container is returned only if no audio encoder is available.
 */
export function selectExportCodecs(supported: SupportedEncoders): ExportCodecChoice | null {
  if (supported.avc) {
    return {
      container: 'mp4', extension: 'mp4', mime: 'video/mp4', video: 'avc',
      audio: supported.aac ? 'aac' : null,
    };
  }
  for (const [video, available] of [['vp9', supported.vp9], ['vp8', supported.vp8]] as const) {
    if (!available) continue;
    return {
      container: 'webm', extension: 'webm', mime: 'video/webm', video,
      audio: supported.opus ? 'opus' : null,
    };
  }
  return null;
}

export function describeCodecChoice(choice: ExportCodecChoice): string {
  const video = choice.video === 'avc' ? 'H.264' : choice.video.toUpperCase();
  const audio = choice.audio === 'aac' ? 'AAC' : choice.audio === 'opus' ? 'Opus' : null;
  return `${choice.extension.toUpperCase()} · ${video}${audio ? ` / ${audio}` : ' · no audio'}`;
}
