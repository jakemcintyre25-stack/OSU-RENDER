import { describe, expect, it, vi } from 'vitest';
import { planOfflineMix, renderOfflineMix } from '../src/audio/offline-mix';
import type { HitSoundPlan } from '../src/audio/hitsounds';

const emptyPlan = (): HitSoundPlan => ({ events: [], loops: [], samples: new Map(), unavailable: 0 });

describe('offline export mix plan', () => {
  it('maps negative preroll to a delayed music start and positive start to a seek offset', () => {
    expect(planOfflineMix({ startMs: -1500, rate: 1, durationSeconds: 60, hitsounds: emptyPlan(), hasMusic: true }).music)
      .toEqual({ when: 1.5, offset: 0, rate: 1 });
    expect(planOfflineMix({ startMs: 5000, rate: 1.5, durationSeconds: 60, hitsounds: emptyPlan(), hasMusic: true }).music)
      .toEqual({ when: 0, offset: 5, rate: 1.5 });
    expect(planOfflineMix({ startMs: 0, rate: 1, durationSeconds: 60, hitsounds: emptyPlan(), hasMusic: false }).music)
      .toBeNull();
  });

  it('places hitsound events on the fixed output timeline and drops out-of-range events', () => {
    const hitsounds = emptyPlan();
    hitsounds.events = [
      { t: 500, sample: 'before.wav', gain: 0.5 },
      { t: 2500, sample: 'a.wav', gain: 0.8 },
      { t: 4000, sample: 'b.wav', gain: 2 },
      { t: 9000, sample: 'after.wav', gain: 0.4 },
      { t: 5000, sample: 'bad.wav', gain: 0 },
    ];
    const plan = planOfflineMix({ startMs: 1000, rate: 1.5, durationSeconds: 4, hitsounds, hasMusic: true });
    expect(plan.events).toEqual([
      { when: 1, sample: 'a.wav', gain: 0.8 },
      { when: 2, sample: 'b.wav', gain: 1 },
    ]);
  });

  it('clips loops to the export window and preserves phase when seeking into one', () => {
    const hitsounds = emptyPlan();
    hitsounds.loops = [
      { start: 0, end: 3000, sample: 'slide.wav', gain: 0.6 },
      { start: 2000, end: 10_000, sample: 'late.wav', gain: 0.7 },
      { start: 0, end: 1000, sample: 'gone.wav', gain: 0.8 },
    ];
    const plan = planOfflineMix({ startMs: 1000, rate: 1, durationSeconds: 5, hitsounds, hasMusic: true });
    expect(plan.loops).toEqual([
      { when: 0, until: 2, sample: 'slide.wav', gain: 0.6, phaseSeconds: 1 },
      { when: 1, until: 5, sample: 'late.wav', gain: 0.7, phaseSeconds: 0 },
    ]);
  });

  it('rejects invalid mix timing', () => {
    expect(() => planOfflineMix({ startMs: 0, rate: 0, durationSeconds: 1, hitsounds: emptyPlan(), hasMusic: true })).toThrow(RangeError);
    expect(() => planOfflineMix({ startMs: 0, rate: 1, durationSeconds: 0, hitsounds: emptyPlan(), hasMusic: true })).toThrow(RangeError);
    expect(() => planOfflineMix({ startMs: NaN, rate: 1, durationSeconds: 1, hitsounds: emptyPlan(), hasMusic: true })).toThrow(RangeError);
  });
});

describe('offline export mix rendering', () => {
  class FakeNode {
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class FakeGain extends FakeNode {
    gain = { value: 1 };
  }
  class FakeSource extends FakeNode {
    buffer: AudioBuffer | null = null;
    playbackRate = { value: 1 };
    loop = false;
    start = vi.fn();
    stop = vi.fn();
    onended: (() => void) | null = null;
  }
  class FakeContext {
    destination = new FakeNode();
    gains: FakeGain[] = [];
    sources: FakeSource[] = [];
    createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
    createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
    async decodeAudioData() {
      return { duration: 10, numberOfChannels: 2, sampleRate: 48_000, length: 480_000 } as AudioBuffer;
    }
    async startRendering() {
      return { duration: this.duration, numberOfChannels: 2, sampleRate: 48_000 } as AudioBuffer;
    }
    duration = 0;
  }

  it('schedules music, hitsounds and loops through independent gain buses', async () => {
    const context = new FakeContext();
    context.duration = 5;
    const hitsounds = emptyPlan();
    hitsounds.samples.set('hit.wav', new ArrayBuffer(8));
    hitsounds.samples.set('loop.wav', new ArrayBuffer(8));
    hitsounds.events = [{ t: 2000, sample: 'hit.wav', gain: 0.8 }];
    hitsounds.loops = [{ start: 3000, end: 4000, sample: 'loop.wav', gain: 0.6 }];
    const buffer = await renderOfflineMix({
      audio: new ArrayBuffer(8), hitsounds, startMs: 1000, rate: 1, durationSeconds: 5,
      musicVolume: 0.5, effectsVolume: 0.25, createContext: () => context as unknown as OfflineAudioContext,
    });
    expect(buffer).not.toBeNull();
    expect(context.gains.map((g) => g.gain.value)).toEqual([0.5, 0.25, 0.8, 0.6]);
    // Music starts at output 0 with a 1 second seek; the event is at 1s; loop is 2s–3s.
    expect(context.sources[0].start).toHaveBeenCalledWith(0, 1);
    expect(context.sources[1].start).toHaveBeenCalledWith(1);
    expect(context.sources[2].start).toHaveBeenCalledWith(2, 0);
    expect(context.sources[2].stop).toHaveBeenCalledWith(3);
    expect(context.sources[2].loop).toBe(true);
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(context.gains[1].connect).toHaveBeenCalledWith(context.destination);
  });

  it('returns null without decoding when there is no music or audible sample', async () => {
    const createContext = vi.fn();
    await expect(renderOfflineMix({
      audio: null, hitsounds: emptyPlan(), startMs: 0, rate: 1, durationSeconds: 5,
      musicVolume: 1, effectsVolume: 1, createContext,
    })).resolves.toBeNull();
    expect(createContext).not.toHaveBeenCalled();
  });

  it('honours cancellation before rendering', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(renderOfflineMix({
      audio: new ArrayBuffer(8), hitsounds: emptyPlan(), startMs: 0, rate: 1, durationSeconds: 5,
      musicVolume: 1, effectsVolume: 1, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
