/** Browser-native, video-only replay capture. MP4 and synchronized audio remain separate milestones. */
export const MAX_CAPTURE_MS = 60_000;
export const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;
export const CAPTURE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export function chooseCaptureMime(supported: (mime: string) => boolean): string | null {
  return CAPTURE_MIME_TYPES.find(supported) ?? null;
}

export function safeCaptureFilename(player: string): string {
  const name = player.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `osu-replay-${name || 'player'}.webm`;
}

export interface CaptureResult {
  blob: Blob;
  mime: string;
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

  get active(): boolean { return this.recorder?.state === 'recording'; }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.recorder) throw new Error('A capture is already active');
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new RangeError('Invalid capture FPS');
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function')
      throw new Error('Video capture is unsupported in this browser');
    const mime = chooseCaptureMime(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('This browser cannot encode WebM video');
    const stream = canvas.captureStream(fps);
    try {
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      this.recorder = recorder;
      this.chunks = [];
      this.bytes = 0;
      this.failed = null;
      this.promise = new Promise<CaptureResult>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > MAX_CAPTURE_BYTES) {
          this.failed = new Error('Capture exceeded the 256 MiB limit');
          void this.stop().catch(() => {});
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.failed = new Error('Browser video encoding failed');
        void this.stop().catch(() => {});
      };
      recorder.onstop = () => {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        stream.getTracks().forEach(track => track.stop());
        const result = new Blob(this.chunks, { type: mime });
        if (this.failed) this.reject?.(this.failed);
        else if (!result.size) this.reject?.(new Error('Capture produced no video frames'));
        else this.resolve?.({ blob: result, mime });
        this.recorder = null;
        this.chunks = [];
        this.resolve = null;
        this.reject = null;
        this.promise = null;
      };
      recorder.start(1000);
      // The caller may not be awaiting stop() yet when the safety timer fires.
      this.timeout = setTimeout(() => { void this.stop().catch(() => {}); }, MAX_CAPTURE_MS);
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = null;
      this.recorder = null;
      this.promise = null;
      this.resolve = null;
      this.reject = null;
      throw error;
    }
  }

  stop(): Promise<CaptureResult> {
    if (!this.recorder || !this.promise) return Promise.reject(new Error('No active capture'));
    const promise = this.promise;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    return promise;
  }

  cancel(): void {
    if (!this.recorder) return;
    this.failed = new Error('Capture cancelled');
    // Avoid an unhandled rejection when navigating away without awaiting stop().
    void this.stop().catch(() => {});
  }
}
