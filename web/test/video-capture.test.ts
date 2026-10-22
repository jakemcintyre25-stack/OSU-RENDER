import { describe, expect, it } from 'vitest';
import { CAPTURE_MIME_TYPES, MAX_CAPTURE_BYTES, MAX_CAPTURE_MS, chooseCaptureMime, safeCaptureFilename, ReplayVideoCapture } from '../src/render/video-capture';

describe('M9 browser video capture', () => {
  it('chooses an actually supported WebM encoder in preference order', () => {
    expect(chooseCaptureMime(x => x === 'video/webm;codecs=vp8')).toBe('video/webm;codecs=vp8');
    expect(chooseCaptureMime(() => false)).toBeNull();
    expect(CAPTURE_MIME_TYPES).toContain('video/webm');
  });
  it('enforces recording duration, memory and safe download names', () => {
    expect(MAX_CAPTURE_MS).toBe(60_000);
    expect(MAX_CAPTURE_BYTES).toBe(256 * 1024 * 1024);
    expect(safeCaptureFilename('../x:<danger>?')).toBe('osu-replay-x-danger.webm');
    expect(safeCaptureFilename('***')).toBe('osu-replay-player.webm');
    expect(safeCaptureFilename('A'.repeat(100)).toBe(`osu-replay-${'A'.repeat(48)}.webm`);
  });
  it('rejects invalid framerates before touching browser APIs', () => {
    const capture = new ReplayVideoCapture();
    const canvas = {} as HTMLCanvasElement;
    for (const fps of [0, -1, 61, 29.5, Infinity, NaN]) {
      expect(() => capture.start(canvas, fps)).toThrow(RangeError);
    }
    expect(capture.active).toBe(false);
    expect(capture.stop()).rejects.toThrow('No active capture');
  });
});
