// The music is the master clock: every frame asks "what map time is it?" and draws that.
// With no audio (e.g. .osu-only fallback), AudioContext still runs as a silent clock.
import { HitSoundPlayer } from './sample-player';
import type { HitSoundPlan } from './hitsounds';

/** A live tap of the music and hit-effect buses for browser video capture. */
export interface CaptureAudio {
  track: MediaStreamTrack;
  /** Disconnect the tap and stop its track. Safe to call more than once. */
  dispose: () => void;
}

export class Clock {
  private ctx: AudioContext;
  private gain: GainNode;
  private effectsGain: GainNode;
  private hitsounds: HitSoundPlayer;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private captureTaps = new Set<{ dest: MediaStreamAudioDestinationNode; track: MediaStreamTrack }>();
  /** Map time (ms) when playback last (re)started. */
  private startMapTime = 0;
  /** AudioContext time (s) when playback last (re)started. */
  private startCtxTime = 0;
  private playing = false;
  private generation = 0;
  private disposed = false;
  private resumePromise: Promise<void> | null = null;
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
    this.effectsGain = this.ctx.createGain();
    this.effectsGain.connect(this.ctx.destination);
    this.hitsounds = new HitSoundPlayer(this.ctx, this.effectsGain);
  }

  async load(data: ArrayBuffer | null) {
    this.buffer = data ? await this.ctx.decodeAudioData(data.slice(0)) : null;
    this.duration = this.buffer ? this.buffer.duration * 1000 : 0;
  }

  /** Decode beatmap-provided samples on the same audio device as the music. */
  async loadHitsounds(plan: HitSoundPlan): Promise<{ loaded: number; failed: number }> {
    return this.hitsounds.load(plan);
  }

  /** Queue samples a short distance ahead of the AudioContext's master time. */
  scheduleHitsounds() {
    if (this.playing) this.hitsounds.schedule(this.startMapTime, this.startCtxTime, this.rate, this.offset);
  }

  /** Update user sync offset and discard previously queued cues at the old offset. */
  setOffset(milliseconds: number) {
    if (!Number.isFinite(milliseconds)) return;
    this.offset = milliseconds;
    this.hitsounds.reset(this.now());
  }

  get hasAudio() {
    return this.buffer !== null;
  }

  get isPlaying() {
    return this.playing;
  }

  set volume(v: number) {
    if (Number.isFinite(v)) this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Sound effects use an independent output bus from beatmap music. */
  set effectsVolume(v: number) {
    if (Number.isFinite(v)) this.effectsGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Tap music and hit effects into a real-time MediaStream for video capture.
   * The returned track is silent while playback is paused, as expected.
   */
  createCaptureAudio(): CaptureAudio {
    if (this.disposed) throw new Error('Audio is no longer available');
    const dest = this.ctx.createMediaStreamDestination();
    const track = dest.stream.getAudioTracks()[0];
    if (!track) throw new Error('Audio capture produced no track');
    this.gain.connect(dest);
    this.effectsGain.connect(dest);
    const tap = { dest, track };
    this.captureTaps.add(tap);
    let released = false;
    return {
      track,
      dispose: () => {
        if (released) return;
        released = true;
        this.releaseCaptureTap(tap);
      },
    };
  }

  private releaseCaptureTap(tap: { dest: MediaStreamAudioDestinationNode; track: MediaStreamTrack }): void {
    if (!this.captureTaps.delete(tap)) return;
    try {
      this.gain.disconnect(tap.dest);
    } catch {
      /* already disconnected */
    }
    try {
      this.effectsGain.disconnect(tap.dest);
    } catch {
      /* already disconnected */
    }
    try {
      tap.track.stop();
    } catch {
      /* track already ended */
    }
  }

  /** Current visual map time in ms, including user audio/visual offset. */
  now(): number {
    // startMapTime is the AUDIO timeline position. Apply the visual offset
    // consistently while stopped and running, including seek/pause boundaries.
    if (!this.playing) return this.startMapTime - this.offset;
    // The Web Audio source is scheduled 50ms in the future. Do not let that
    // scheduling lead-in rewind the visible map timeline.
    const elapsed = Math.max(0, this.ctx.currentTime - this.startCtxTime);
    return this.startMapTime + elapsed * 1000 * this.rate - this.offset;
  }

  async play() {
    if (this.playing || this.disposed) return;
    const generation = this.generation;
    if (this.ctx.state === 'suspended') {
      // One resume promise for concurrent user clicks: two suspended starts
      // must not create two independently resolving playback continuations.
      if (!this.resumePromise) {
        this.resumePromise = this.ctx.resume().finally(() => { this.resumePromise = null; });
      }
      await this.resumePromise;
    }
    // Closing, seeking, or changing speed while resume() was pending must
    // not allow an older continuation to start its abandoned audio source.
    if (this.disposed || generation !== this.generation || this.playing) return;
    this.startCtxTime = this.ctx.currentTime + 0.05;
    this.hitsounds.reset(this.startMapTime - this.offset);
    this.startSource(this.startMapTime);
    this.playing = true;
  }

  pause() {
    this.generation++;
    if (!this.playing) return;
    const visualTime = this.now();
    this.startMapTime = visualTime + this.offset;
    this.stopSource();
    this.playing = false;
    this.hitsounds.reset(visualTime);
  }

  seek(mapTime: number) {
    this.generation++;
    const was = this.playing;
    this.stopSource();
    this.playing = false;
    // The public seek argument is visual/map time; the stored position is
    // audio time, which runs offset milliseconds ahead of the visuals.
    this.startMapTime = mapTime + this.offset;
    this.hitsounds.reset(mapTime);
    if (was) void this.play();
  }

  setRate(rate: number) {
    this.generation++;
    const t = this.playing ? this.now() + this.offset : this.startMapTime;
    const was = this.playing;
    this.stopSource();
    this.playing = false;
    this.rate = rate;
    this.startMapTime = t;
    this.hitsounds.reset(this.startMapTime - this.offset);
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
    this.generation++;
    this.disposed = true;
    this.playing = false;
    this.stopSource();
    for (const tap of [...this.captureTaps]) this.releaseCaptureTap(tap);
    this.hitsounds.dispose();
    void this.ctx.close();
  }
}
