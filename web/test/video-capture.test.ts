import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_MIME_TYPES, MAX_CAPTURE_BYTES, MAX_CAPTURE_MS, chooseCaptureMime, safeCaptureFilename, ReplayVideoCapture } from '../src/render/video-capture';

describe('M9 browser video capture', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('records actual recorder chunks and releases media tracks on stop', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    const canvas = { captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
    class FakeRecorder {
      static isTypeSupported = (mime: string) => mime === 'video/webm';
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, _options: unknown) {}
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['frame']) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const capture = new ReplayVideoCapture();
    capture.start(canvas, 30);
    expect(capture.active).toBe(true);
    const result = await capture.stop();
    expect(result.mime).toBe('video/webm');
    expect(result.blob.size).toBe(5);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(capture.active).toBe(false);
    expect(canvas.captureStream).toHaveBeenCalledWith(30);
  });

  it('cleans up media tracks and permits retry when recorder.start throws', () => {
    const stopTrack = vi.fn();
    const canvas = { captureStream: () => ({ getTracks: () => [{ stop: stopTrack }] }) } as unknown as HTMLCanvasElement;
    class BrokenRecorder {
      static isTypeSupported = () => true;
      start() { throw new Error('encoder initialization failed'); }
    }
    vi.stubGlobal('MediaRecorder', BrokenRecorder);
    const capture = new ReplayVideoCapture();
    expect(() => capture.start(canvas)).toThrow('encoder initialization failed');
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(capture.active).toBe(false);
    expect(() => capture.start(canvas)).toThrow('encoder initialization failed');
  });

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
    expect(safeCaptureFilename('A'.repeat(100))).toBe(`osu-replay-${'A'.repeat(48)}.webm`);
  });
  it('rejects invalid framerates before touching browser APIs', async () => {
    const capture = new ReplayVideoCapture();
    const canvas = {} as HTMLCanvasElement;
    for (const fps of [0, -1, 61, 29.5, Infinity, NaN]) {
      expect(() => capture.start(canvas, fps)).toThrow(RangeError);
    }
    expect(capture.active).toBe(false);
    await expect(capture.stop()).rejects.toThrow('No active capture');
  });
});
