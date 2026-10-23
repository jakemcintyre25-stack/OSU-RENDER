import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_AUDIO_MIME_TYPES, CAPTURE_MIME_TYPES, MAX_CAPTURE_BYTES, MAX_CAPTURE_MS, chooseCaptureMime, safeCaptureFilename, ReplayVideoCapture } from '../src/render/video-capture';

describe('M9 browser video capture', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('records actual recorder chunks and releases media tracks on stop', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{}] };
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

  it('records synchronized audio and disposes the capture tap once', async () => {
    const stopVideo = vi.fn();
    const stopAudio = vi.fn();
    const disposeAudio = vi.fn();
    const videoTrack = { stop: stopVideo };
    const audioTrack = { kind: 'audio', readyState: 'live', stop: stopAudio };
    const tracks: Array<{ stop: () => void }> = [videoTrack];
    const stream = {
      getTracks: () => tracks,
      getVideoTracks: () => [videoTrack],
      addTrack: vi.fn((track: { stop: () => void }) => { tracks.push(track); }),
    };
    const canvas = { captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
    let optionsSeen: MediaRecorderOptions | null = null;
    class FakeRecorder {
      static isTypeSupported = (mime: string) => mime === 'video/webm;codecs=vp9,opus';
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, options: MediaRecorderOptions) { optionsSeen = options; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['av']) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const capture = new ReplayVideoCapture();
    expect(capture.start(canvas, 30, {
      audio: { track: audioTrack as unknown as MediaStreamTrack, dispose: disposeAudio },
    })).toBe(true);
    expect(stream.addTrack).toHaveBeenCalledWith(audioTrack);
    expect(optionsSeen!.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(optionsSeen!.audioBitsPerSecond).toBe(128_000);
    const result = await capture.stop();
    expect(result.mime).toBe('video/webm;codecs=vp9,opus');
    expect(result.audio).toBe(true);
    expect(result.blob.size).toBe(2);
    expect(stopAudio).toHaveBeenCalled();
    expect(disposeAudio).toHaveBeenCalledOnce();
  });

  it('falls back to video-only and releases the tap when Opus muxing is unsupported', async () => {
    const disposeAudio = vi.fn();
    const audioTrack = { kind: 'audio', readyState: 'live', stop: vi.fn() };
    const stream = { getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{}] };
    const canvas = { captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
    let mimeSeen = '';
    class FakeRecorder {
      static isTypeSupported = (mime: string) => mime === 'video/webm;codecs=vp9';
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, options: MediaRecorderOptions) { mimeSeen = options.mimeType ?? ''; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['video']) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const capture = new ReplayVideoCapture();
    expect(capture.start(canvas, 30, {
      audio: { track: audioTrack as unknown as MediaStreamTrack, dispose: disposeAudio },
    })).toBe(false);
    expect(mimeSeen).toBe('video/webm;codecs=vp9');
    expect(disposeAudio).toHaveBeenCalledOnce();
    const result = await capture.stop();
    expect(result.audio).toBe(false);
  });

  it('rejects a non-audio or ended capture track before touching the canvas', () => {
    const canvas = { captureStream: vi.fn() } as unknown as HTMLCanvasElement;
    const capture = new ReplayVideoCapture();
    expect(() => capture.start(canvas, 30, {
      audio: { track: { kind: 'video', readyState: 'live' } as unknown as MediaStreamTrack },
    })).toThrow('Invalid capture audio track');
    expect(() => capture.start(canvas, 30, {
      audio: { track: { kind: 'audio', readyState: 'ended' } as unknown as MediaStreamTrack },
    })).toThrow('Invalid capture audio track');
    expect(canvas.captureStream).not.toHaveBeenCalled();
  });

  it('rejects a canvas stream with no video track and releases stray tracks', () => {
    const stopTrack = vi.fn();
    const canvas = { captureStream: () => ({
      getVideoTracks: () => [], getTracks: () => [{ stop: stopTrack }],
    }) } as unknown as HTMLCanvasElement;
    class FakeRecorder { static isTypeSupported = () => true; }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    expect(() => new ReplayVideoCapture().start(canvas)).toThrow('no video track');
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('cleans up media tracks and permits retry when recorder.start throws', () => {
    const stopTrack = vi.fn();
    const canvas = { captureStream: () => ({ getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{}] }) } as unknown as HTMLCanvasElement;
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

  it('rejects and releases tracks when a browser encoder throws during stop', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{}] };
    const canvas = { captureStream: () => stream } as unknown as HTMLCanvasElement;
    class BrokenStopRecorder {
      static isTypeSupported = () => true;
      state = 'inactive';
      stream = stream;
      start() { this.state = 'recording'; }
      stop() { throw new Error('encoder stop failed'); }
    }
    vi.stubGlobal('MediaRecorder', BrokenStopRecorder);
    const capture = new ReplayVideoCapture();
    capture.start(canvas);
    await expect(capture.stop()).rejects.toThrow('encoder stop failed');
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(capture.active).toBe(false);
    await expect(capture.stop()).rejects.toThrow('No active capture');
  });
  it('chooses an actually supported WebM encoder in preference order', () => {
    expect(chooseCaptureMime(x => x === 'video/webm;codecs=vp8')).toBe('video/webm;codecs=vp8');
    expect(chooseCaptureMime(() => false)).toBeNull();
    expect(CAPTURE_MIME_TYPES).toContain('video/webm');
    expect(CAPTURE_AUDIO_MIME_TYPES[0]).toContain('opus');
    expect(chooseCaptureMime(x => x === 'video/webm;codecs=vp8,opus', true)).toBe('video/webm;codecs=vp8,opus');
    expect(chooseCaptureMime(x => x === 'video/webm;codecs=vp9', true)).toBeNull();
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
