/** Offline audio mix for deterministic video export.
 *
 * The live preview asks Web Audio to schedule a short lookahead; an export must
 * instead place every music/sample event on one fixed, pre-rendered timeline.
 * This module computes that placement in pure code and renders it with an
 * OfflineAudioContext. No copyrighted audio is embedded here.
 */

import type { HitSoundPlan } from './hitsounds';

export interface OfflineMixPlanInput {
  /** First exported map millisecond; may be negative for AudioLeadIn/preroll. */
  startMs: number;
  /** Effective map rate, e.g. 1.5 for DT. */
  rate: number;
  /** Exact exported duration in seconds, including any frame rounding. */
  durationSeconds: number;
  hitsounds: HitSoundPlan;
  hasMusic: boolean;
}

export interface PlannedSample {
  when: number;
  sample: string;
  gain: number;
}

export interface PlannedLoop {
  when: number;
  until: number;
  sample: string;
  gain: number;
  /** Sample-clock offset at output time 0 when the loop began before the export. */
  phaseSeconds: number;
}

export interface OfflineMixPlan {
  music: { when: number; offset: number; rate: number } | null;
  events: PlannedSample[];
  loops: PlannedLoop[];
}

const finite = (value: number) => typeof value === 'number' && Number.isFinite(value);

export function planOfflineMix(input: OfflineMixPlanInput): OfflineMixPlan {
  const { startMs, rate, durationSeconds, hitsounds, hasMusic } = input;
  if (!finite(startMs) || !finite(rate) || !finite(durationSeconds)) {
    throw new RangeError('Invalid offline mix timeline');
  }
  if (rate <= 0) throw new RangeError('Offline mix rate must be positive');
  if (durationSeconds <= 0) throw new RangeError('Offline mix duration must be positive');
  const music = hasMusic
    ? {
        when: Math.max(0, -startMs / 1000 / rate),
        offset: Math.max(0, startMs / 1000),
        rate,
      }
    : null;
  const events: PlannedSample[] = [];
  for (const event of hitsounds.events) {
    if (!finite(event.t) || !finite(event.gain) || event.gain <= 0) continue;
    const when = (event.t - startMs) / 1000 / rate;
    if (when < 0 || when >= durationSeconds) continue;
    events.push({ when, sample: event.sample, gain: Math.min(1, event.gain) });
  }
  events.sort((a, b) => a.when - b.when);
  const loops: PlannedLoop[] = [];
  for (const loop of hitsounds.loops ?? []) {
    if (!finite(loop.start) || !finite(loop.end) || !finite(loop.gain) || loop.gain <= 0) continue;
    if (loop.end <= loop.start) continue;
    const begin = (loop.start - startMs) / 1000 / rate;
    const until = Math.min(durationSeconds, (loop.end - startMs) / 1000 / rate);
    const when = Math.max(0, begin);
    if (until <= when) continue;
    loops.push({
      when,
      until,
      sample: loop.sample,
      gain: Math.min(1, loop.gain),
      phaseSeconds: Math.max(0, -begin) * rate,
    });
  }
  loops.sort((a, b) => a.when - b.when);
  return { music, events, loops };
}

export interface RenderOfflineMixInput extends Omit<OfflineMixPlanInput, 'hasMusic'> {
  audio: ArrayBuffer | null;
  musicVolume: number;
  effectsVolume: number;
  sampleRate?: number;
  signal?: AbortSignal;
  /** Test seam; defaults to the browser OfflineAudioContext. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

const MAX_SAMPLE_RATE = 96_000;
const MIN_SAMPLE_RATE = 8_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

/** Render music plus planned hitsounds into one AudioBuffer.
 * Returns null when there is nothing audible to export.
 */
export async function renderOfflineMix(input: RenderOfflineMixInput): Promise<AudioBuffer | null> {
  const {
    audio, hitsounds, startMs, rate, durationSeconds,
    musicVolume, effectsVolume, sampleRate = 48_000, signal, createContext,
  } = input;
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw new RangeError('Invalid offline mix sample rate');
  }
  const plan = planOfflineMix({ startMs, rate, durationSeconds, hitsounds, hasMusic: audio !== null });
  const audible = plan.music !== null || plan.events.length > 0 || plan.loops.length > 0;
  if (!audible) return null;
  throwIfAborted(signal);
  const frames = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const context = createContext?.(2, frames, sampleRate)
    ?? new OfflineAudioContext(2, frames, sampleRate);
  const musicGain = context.createGain();
  const effectsGain = context.createGain();
  musicGain.gain.value = Math.max(0, Math.min(1, musicVolume));
  effectsGain.gain.value = Math.max(0, Math.min(1, effectsVolume));
  musicGain.connect(context.destination);
  effectsGain.connect(context.destination);

  let musicBuffer: AudioBuffer | null = null;
  if (audio) {
    throwIfAborted(signal);
    musicBuffer = await context.decodeAudioData(audio.slice(0));
  }
  throwIfAborted(signal);

  // Decode only samples actually referenced by the plan, four at a time.
  const needed = new Set<string>();
  for (const event of plan.events) needed.add(event.sample);
  for (const loop of plan.loops) needed.add(loop.sample);
  const samples = new Map<string, AudioBuffer>();
  const entries = [...needed].filter((name) => hitsounds.samples.has(name));
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      throwIfAborted(signal);
      const name = entries[next++];
      const bytes = hitsounds.samples.get(name);
      if (!bytes) continue;
      try {
        const buffer = await context.decodeAudioData(bytes.slice(0));
        if (buffer.duration > 0) samples.set(name, buffer);
      } catch {
        // A single unreadable sample must not abort the whole export.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  throwIfAborted(signal);

  if (plan.music && musicBuffer && plan.music.offset < musicBuffer.duration) {
    const source = context.createBufferSource();
    source.buffer = musicBuffer;
    source.playbackRate.value = plan.music.rate;
    source.connect(musicGain);
    source.start(plan.music.when, plan.music.offset);
  }

  for (const event of plan.events) {
    const buffer = samples.get(event.sample);
    if (!buffer) continue;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = event.gain;
    source.connect(gain);
    gain.connect(effectsGain);
    source.start(event.when);
  }

  for (const loop of plan.loops) {
    const buffer = samples.get(loop.sample);
    if (!buffer || buffer.duration <= 0) continue;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.loop = true;
    gain.gain.value = loop.gain;
    source.connect(gain);
    gain.connect(effectsGain);
    source.start(loop.when, loop.phaseSeconds % buffer.duration);
    source.stop(loop.until);
  }

  throwIfAborted(signal);
  const rendered = await context.startRendering();
  throwIfAborted(signal);
  return rendered;
}
