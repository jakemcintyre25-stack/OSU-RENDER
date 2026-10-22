// The music is the master clock: every frame asks "what map time is it?" and draws that.
// With no audio (e.g. the .osu-only fallback), a silent clock runs off performance.now().

export class Clock {
  private ctx: AudioContext;
  private gain: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** Map time (ms) when playback last (re)started. */
  private startMapTime = 0;
  /** AudioContext time (s) when playback last (re)started. */
  private startCtxTime = 0;
  private playing = false;
  /** Playback speed (1.5 for DT). v1 changes pitch too; time-stretch is a Phase 4 item. */
  rate = 1;
  /** User offset in ms; positive = visuals later. */
  offset = 0;
  duration = 0;
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  async load(data: ArrayBuffer | null) {
    this.buffer = data ? await this.ctx.decodeAudioData(data.slice(0)) : null;
    this.duration = this.buffer ? this.buffer.duration * 1000 : 0;
  }

  get hasAudio() {
    return this.buffer !== null;
  }

  get isPlaying() {
    return this.playing;
  }

  set volume(v: number) {
    this.gain.gain.value = v;
  }

  /** Current map time in ms. */
  now(): number {
    if (!this.playing) return this.startMapTime;
    return this.startMapTime + (this.ctx.currentTime - this.startCtxTime) * 1000 * this.rate - this.offset;
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.startCtxTime = this.ctx.currentTime + 0.05;
    this.startSource(this.startMapTime);
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.startMapTime = this.now() + this.offset;
    this.stopSource();
    this.playing = false;
  }

  seek(mapTime: number) {
    const was = this.playing;
    this.stopSource();
    this.playing = false;
    this.startMapTime = mapTime;
    if (was) void this.play();
  }

  setRate(rate: number) {
    const t = this.playing ? this.now() + this.offset : this.startMapTime;
    const was = this.playing;
    this.stopSource();
    this.playing = false;
    this.rate = rate;
    this.startMapTime = t;
    if (was) void this.play();
  }

  private startSource(fromMapTime: number) {
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    // Map time before 0 (lead-in) means the song starts a little later.
    const delay = Math.max(0, -fromMapTime) / 1000 / this.rate;
    const offset = Math.max(0, fromMapTime) / 1000;
    if (offset < this.buffer.duration) src.start(this.startCtxTime + delay, offset);
    src.onended = () => {
      if (this.source === src) this.onEnded?.();
    };
    this.source = src;
  }

  private stopSource() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      try {
        s.stop();
      } catch {
        /* not started yet */
      }
      s.disconnect();
    }
  }

  dispose() {
    this.stopSource();
    void this.ctx.close();
  }
}
