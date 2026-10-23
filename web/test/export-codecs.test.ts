import { describe, expect, it } from 'vitest';
import { describeCodecChoice, selectExportCodecs, type SupportedEncoders } from '../src/render/export/codecs';
import { detectExportCodecs } from '../src/render/export/export-video';

const none: SupportedEncoders = { avc: false, aac: false, vp9: false, vp8: false, opus: false };

describe('export codec selection', () => {
  it('prefers MP4 with H.264 and AAC when the browser supports both', () => {
    expect(selectExportCodecs({ ...none, avc: true, aac: true })).toEqual({
      container: 'mp4', extension: 'mp4', mime: 'video/mp4', video: 'avc', audio: 'aac',
    });
  });

  it('still chooses MP4 video-only when AAC is unavailable', () => {
    expect(selectExportCodecs({ ...none, avc: true, opus: true })).toMatchObject({
      container: 'mp4', video: 'avc', audio: null,
    });
  });

  it('falls back to WebM VP9 or VP8 with Opus', () => {
    expect(selectExportCodecs({ ...none, vp9: true, vp8: true, opus: true })).toMatchObject({
      container: 'webm', extension: 'webm', video: 'vp9', audio: 'opus',
    });
    expect(selectExportCodecs({ ...none, vp8: true, opus: true })).toMatchObject({
      container: 'webm', video: 'vp8', audio: 'opus',
    });
  });

  it('returns null when no video encoder exists, and describes the result', () => {
    expect(selectExportCodecs(none)).toBeNull();
    const choice = selectExportCodecs({ ...none, avc: true, aac: true })!;
    expect(describeCodecChoice(choice)).toBe('MP4 · H.264 / AAC');
    expect(describeCodecChoice({ ...choice, audio: null })).toContain('no audio');
  });

  it('reports no deterministic encoder when WebCodecs is unavailable', async () => {
    expect(typeof VideoEncoder).toBe('undefined');
    await expect(detectExportCodecs(1280, 720)).resolves.toBeNull();
  });
});
