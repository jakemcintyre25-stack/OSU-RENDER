/** Browser-native, real-time replay capture. Deterministic frame rendering,
 * full-length export and native MP4 encoding remain separate milestones. */
export const MAX_CAPTURE_MS = 60_000;
export const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;
export const CAPTURE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;
/** Audio variants are tried first when the caller supplies a capture tap. */
export const CAPTURE_AUDIO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export function chooseCaptureMime(supported: (mime: string) => boolean, withAudio = false): string | null {
  return (withAudio ? CAPTURE_AUDIO_MIME_TYPES : CAPTURE_MIME_TYPES).find(supported) ?? null;
}

export function captureFileExtension(mime: string): 'webm' | 'mp4' {
  return mime.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

export function safeCaptureFilename(player: string, mime = 'video/webm'): string {
  const name = player.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `osu-replay-${name || 'player'}.${captureFileExtension(mime)}`;
}

/** An audio tap owned by the caller until ReplayVideoCapture takes it. */
export interface CaptureAudioSource {
  track: MediaStreamTrack;
  /** Disconnect the tap and stop its track. The recorder calls this once. */
  dispose?: () => void;
}

export interface CaptureOptions {
  audio?: CaptureAudioSource | null;
}

export interface CaptureResult {
  blob: Blob;
  mime: string;
  /** Whether the recorder actually included the supplied audio track. */
  audio: boolean;
}

export class ReplayVideoCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private resolve: ((result: CaptureResult) => void) | null = null;
  private reject: ((error: Error) => void) | null = null;
  private promise: Promise<CaptureResult> | null = null;
  private failed: Error | null = null;
  private audioDispose: (() => void) | null = null;
  private audioCaptured = false;

  get active(): boolean { return this.recorder?.state === 'recording'; }

  /** Start recording. Returns whether the supplied audio tap was accepted. */
  start(canvas: HTMLCanvasElement, fps = 30, options: CaptureOptions = {}): boolean {
    if (this.recorder) throw new Error('A capture is already active');
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new RangeError('Invalid capture FPS');
    const audio = options.audio ?? null;
    if (audio && (audio.track.kind !== 'audio' || audio.track.readyState === 'ended'))
      throw new Error('Invalid capture audio track');
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function')
      throw new Error('Video capture is unsupported in this browser');
    let mime = chooseCaptureMime(type => MediaRecorder.isTypeSupported(type), Boolean(audio));
    let withAudio = Boolean(audio);
    if (!mime && audio) {
      // Not every browser can mux Opus into WebM through MediaRecorder. A
      // video-only file is still useful, but the caller is told it lost audio.
      mime = chooseCaptureMime(type => MediaRecorder.isTypeSupported(type), false);
      withAudio = false;
    }
    if (!mime) {
      audio?.dispose?.();
      throw new Error('This browser cannot encode WebM video');
    }
    if (!withAudio) audio?.dispose?.();
    const stream = canvas.captureStream(fps);
    // Some browsers return an empty stream while the canvas is not drawable.
    // Reject before allocating a recorder or starting a silent, empty capture.
    if (!stream.getVideoTracks().length) {
      this.release(stream, withAudio ? audio?.dispose : null);
      throw new Error('Canvas capture produced no video track');
    }
    try {
      if (withAudio && audio) stream.addTrack(audio.track);
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000,
        ...(withAudio ? { audioBitsPerSecond: 128_000 } : {}),
      });
      this.recorder = recorder;
      this.chunks = [];
      this.bytes = 0;
      this.failed = null;
      this.audioCaptured = withAudio;
      this.audioDispose = withAudio ? (audio?.dispose ?? null) : null;
      this.promise = new Promise<CaptureResult>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data.size) return;
        if (event.data.size > MAX_CAPTURE_BYTES - this.bytes) {
          this.failed = new Error('Capture exceeded the 256 MiB limit');
          void this.stop().catch(() => {});
          return;
        }
        this.bytes += event.data.size;
        this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.failed = new Error('Browser video encoding failed');
        void this.stop().catch(() => {});
      };
      recorder.onstop = () => {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        const disposeAudio = this.audioDispose;
        this.release(stream, disposeAudio);
        const result = new Blob(this.chunks, { type: mime as string });
        if (this.failed) this.reject?.(this.failed);
        else if (!result.size) this.reject?.(new Error('Capture produced no video frames'));
        else this.resolve?.({ blob: result, mime: mime as string, audio: this.audioCaptured });
        this.recorder = null;
        this.chunks = [];
        this.audioDispose = null;
        this.audioCaptured = false;
        this.resolve = null;
        this.reject = null;
        this.promise = null;
      };
      recorder.start(1000);
      // The caller may not be awaiting stop() yet when the safety timer fires.
      this.timeout = setTimeout(() => { void this.stop().catch(() => {}); }, MAX_CAPTURE_MS);
      return withAudio;
    } catch (error) {
      this.release(stream, withAudio ? audio?.dispose : null);
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = null;
      this.recorder = null;
      this.audioDispose = null;
      this.audioCaptured = false;
      this.promise = null;
      this.resolve = null;
      this.reject = null;
      throw error;
    }
  }

  stop(): Promise<CaptureResult> {
    if (!this.recorder || !this.promise) return Promise.reject(new Error('No active capture'));
    const promise = this.promise;
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch (error) {
        // A browser encoder can throw synchronously without ever firing onstop.
        // Release its tracks and settle the capture instead of leaving a hanging promise.
        const recorder = this.recorder;
        const stream = recorder.stream;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        this.release(stream, this.audioDispose);
        this.recorder = null;
        this.chunks = [];
        this.audioDispose = null;
        this.audioCaptured = false;
        this.resolve = null;
        this.reject?.(error instanceof Error ? error : new Error('Failed to stop browser video encoder'));
        this.reject = null;
        this.promise = null;
      }
    }
    return promise;
  }

  cancel(): void {
    if (!this.recorder) return;
    this.failed = new Error('Capture cancelled');
    // Avoid an unhandled rejection when navigating away without awaiting stop().
    void this.stop().catch(() => {});
  }

  private release(stream: MediaStream, dispose?: (() => void) | null): void {
    stream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch {
        /* track already ended */
      }
    });
    try {
      dispose?.();
    } catch {
      /* best-effort audio graph cleanup */
    }
  }
}
