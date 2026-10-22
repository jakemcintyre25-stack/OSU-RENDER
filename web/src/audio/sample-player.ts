import type { HitSoundEvent, HitSoundLoop, HitSoundPlan } from './hitsounds';

const LOOKAHEAD_SECONDS = 0.25;
const MAX_ACTIVE_VOICES = 48;

/**
 * Sample-accurate beatmap hitsound scheduling on the very same AudioContext
 * clock as the music. Works with decoded beatmap WAV/MP3 samples and
 * never substitutes synthesized placeholder sounds for missing skin assets.
 *
 * No audio is queued while the playback clock is stopped. Reset removes
 * previously scheduled voices after seek/rate changes to avoid ghost notes.
 */
export class HitSoundPlayer {
  private buffers = new Map<string, AudioBuffer>();
  private events: HitSoundEvent[] = [];
  private loops: HitSoundLoop[] = [];
  private nextLoop = 0;
  private next = 0;
  private generation = 0;
  private active = new Map<AudioBufferSourceNode, GainNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
  ) {}

  async load(plan: HitSoundPlan): Promise<{ loaded: number; failed: number }> {
    const generation = ++this.generation;
    this.reset(0);
    const buffers = new Map<string, AudioBuffer>();
    let failed = 0;
    const entries = [...plan.samples];
    let next = 0;
    // Decode no more than four clips concurrently to avoid spiking browser
    // memory for beatmaps with hundreds of distinct custom WAV samples.
    const decodeWorker = async () => {
      while (next < entries.length && generation === this.generation) {
        const [name, bytes] = entries[next++];
        try {
          // decodeAudioData may detach its input buffer. Keep the planner's data.
          const decoded = await this.context.decodeAudioData(bytes.slice(0));
          if (decoded.duration > 0) buffers.set(name, decoded);
          else failed++;
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, decodeWorker));
    if (generation !== this.generation) return { loaded: 0, failed: 0 };
    this.buffers = buffers;
    this.events = plan.events.filter((event) =>
      Number.isFinite(event.t) && Number.isFinite(event.gain) &&
      event.gain > 0 && buffers.has(event.sample),
    ).sort((a, b) => a.t - b.t);
    this.loops = (plan.loops ?? []).filter((loop) =>
      Number.isFinite(loop.start) && Number.isFinite(loop.end) &&
      loop.end > loop.start && Number.isFinite(loop.gain) && loop.gain > 0 &&
      buffers.has(loop.sample),
    ).sort((a, b) => a.start - b.start);
    this.next = 0;
    this.nextLoop = 0;
    return { loaded: buffers.size, failed };
  }

  /** Stop voices and seek to first event at/after visualTime (binary search). */
  reset(visualTime: number) {
    for (const [source, gain] of this.active) {
      source.onended = null;
      try { source.stop(); } catch { /* source already finished */ }
      source.disconnect();
      gain.disconnect();
    }
    this.active.clear();
    let low = 0;
    let high = this.events.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.events[mid].t < visualTime) low = mid + 1;
      else high = mid;
    }
    this.next = low;
    // A seek can land *inside* a currently tracked slider loop. Preserve
    // that interval, resuming it from the corresponding audio buffer offset.
    this.nextLoop = this.loops.findIndex(loop => loop.end > visualTime);
    if (this.nextLoop < 0) this.nextLoop = this.loops.length;
  }

  /** Positive visual offset delays sounds to match visual gameplay time. */
  schedule(startAudioMapMs: number, startContextSeconds: number, rate: number, offsetMs: number) {
    if (!(rate > 0) || !Number.isFinite(startContextSeconds)) return;
    const now = this.context.currentTime;
    while (this.next < this.events.length) {
      const event = this.events[this.next];
      const when = startContextSeconds + (event.t + offsetMs - startAudioMapMs) / (1000 * rate);
      if (when > now + LOOKAHEAD_SECONDS) break;
      this.next++;
      // Never replay past events after seeks/frame stalls or schedule notes in the past.
      if (when < now - 0.005 || this.active.size >= MAX_ACTIVE_VOICES) continue;
      const buffer = this.buffers.get(event.sample);
      if (!buffer) continue;
      const source = this.context.createBufferSource();
      const volume = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate; // DT/HT currently changes pitch
      volume.gain.value = Math.max(0, Math.min(1, event.gain));
      source.connect(volume);
      volume.connect(this.destination);
      source.onended = () => {
        this.active.delete(source);
        source.disconnect();
        volume.disconnect();
      };
      this.active.set(source, volume);
      source.start(Math.max(now, when));
    }
    // Continuous audio is bounded to *collected* slider tracking intervals.
    // A seek into a tracking interval restarts its loop at the correct phase;
    // paused and abandoned source nodes are cancelled by reset().
    while (this.nextLoop < this.loops.length) {
      const loop = this.loops[this.nextLoop];
      const begin = startContextSeconds + (loop.start + offsetMs - startAudioMapMs) / (1000 * rate);
      if (begin > now + LOOKAHEAD_SECONDS) break;
      this.nextLoop++;
      const until = startContextSeconds + (loop.end + offsetMs - startAudioMapMs) / (1000 * rate);
      if (until <= now || this.active.size >= MAX_ACTIVE_VOICES) continue;
      const buffer = this.buffers.get(loop.sample);
      if (!buffer || buffer.duration <= 0) continue;
      const when = Math.max(now, begin);
      const elapsedSampleSeconds = Math.max(0, when - begin) * rate;
      const sampleOffset = elapsedSampleSeconds % buffer.duration;
      const source = this.context.createBufferSource();
      const volume = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.loop = true;
      volume.gain.value = Math.max(0, Math.min(1, loop.gain));
      source.connect(volume);
      volume.connect(this.destination);
      source.onended = () => {
        this.active.delete(source);
        source.disconnect();
        volume.disconnect();
      };
      this.active.set(source, volume);
      source.start(when, sampleOffset);
      source.stop(until);
    }
  }

  dispose() {
    this.generation++;
    this.reset(0);
    this.events = [];
    this.loops = [];
    this.buffers.clear();
  }
}
