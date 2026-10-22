import { describe, expect, it, vi } from 'vitest';
import { HitSoundPlayer } from '../src/audio/sample-player';
import type { HitSoundPlan } from '../src/audio/hitsounds';

type FakeSource = {
  buffer: AudioBuffer | null;
  playbackRate: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};

class FakeAudioContext {
  currentTime = 10;
  sources: FakeSource[] = [];
  gains: Array<{ gain: { value: number }; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> = [];
  createBufferSource() {
    const source: FakeSource = {
      buffer: null, playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn(),
      connect: vi.fn(), disconnect: vi.fn(), onended: null,
    };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  createGain() {
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
  decodeAudioData = vi.fn(async (_bytes: ArrayBuffer): Promise<AudioBuffer> =>
    ({ duration: 0.06 } as AudioBuffer));
}

const namedPlan = (times: number[], gain = 0.75): HitSoundPlan => ({
  events: times.map(t => ({ t, sample: 'map/hit.wav', gain })),
  samples: new Map([['map/hit.wav', new Uint8Array([1, 2, 3]).buffer]]),
  unavailable: 0,
});
const fixture = () => {
  const context = new FakeAudioContext();
  const player = new HitSoundPlayer(context as unknown as AudioContext, {} as AudioNode);
  return { context, player };
};

describe('M5 Web Audio sample scheduling and lifecycle', () => {
  it('schedules decoded audio samples on the music clock, at source sample time', async () => {
    const { context, player } = fixture();
    expect(await player.load(namedPlan([1000, 1150]))).toEqual({ loaded: 1, failed: 0 });
    player.reset(900);
    player.schedule(900, 10.05, 1, 0);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].start).toHaveBeenCalledWith(10.15);
    expect(context.sources[1].start).toHaveBeenCalledWith(10.3);
    expect(context.sources[0].playbackRate.value).toBe(1);
    expect(context.gains[0].gain.value).toBe(0.75);
    player.schedule(900, 10.05, 1, 0);
    expect(context.sources).toHaveLength(2); // do not schedule duplicates
  });

  it('preserves mod rate and visual offset in the scheduled AudioContext time', async () => {
    const { context, player } = fixture();
    await player.load(namedPlan([1300]));
    player.reset(1200);
    player.schedule(1200, 10.05, 1.5, 100);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10.05 + 0.2 / 1.5);
    expect(context.sources[0].playbackRate.value).toBe(1.5);
  });

  it('cancels existing sample voices on seek and does not replay past events', async () => {
    const { context, player } = fixture();
    await player.load(namedPlan([1000, 1100, 2000]));
    player.reset(1000);
    player.schedule(1000, 10.05, 1, 0);
    expect(context.sources).toHaveLength(2);
    player.reset(1900);
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources[1].stop).toHaveBeenCalledOnce();
    context.currentTime = 10.15;
    player.schedule(1900, 10.2, 1, 0);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2].start).toHaveBeenCalledWith(10.3);
  });

  it('skips events after a stalled frame and never starts a sound in the past', async () => {
    const { context, player } = fixture();
    await player.load(namedPlan([1000, 1300]));
    player.reset(1000);
    context.currentTime = 11;
    player.schedule(1000, 10.05, 1, 0);
    expect(context.sources).toHaveLength(0);
  });

  it('ignores absent and broken audio decoders, keeping valid samples playable', async () => {
    const { context, player } = fixture();
    context.decodeAudioData
      .mockResolvedValueOnce({ duration: 0.1 } as AudioBuffer)
      .mockRejectedValueOnce(new Error('unsupported format'));
    const plan: HitSoundPlan = {
      events: [
        { t: 1000, sample: 'valid', gain: 1 },
        { t: 1000, sample: 'invalid', gain: 1 },
        { t: 1000, sample: 'absent', gain: 1 },
      ],
      samples: new Map([
        ['valid', new Uint8Array([1]).buffer],
        ['invalid', new Uint8Array([2]).buffer],
      ]),
      unavailable: 1,
    };
    expect(await player.load(plan)).toEqual({ loaded: 1, failed: 1 });
    player.reset(900);
    player.schedule(900, 10.05, 1, 0);
    expect(context.sources).toHaveLength(1);
    player.dispose();
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
  });

  it('caps concurrent queued voices rather than unboundedly allocating nodes', async () => {
    const { context, player } = fixture();
    await player.load(namedPlan(Array.from({ length: 70 }, () => 1000)));
    player.reset(1000);
    player.schedule(1000, 10.05, 1, 0);
    expect(context.sources).toHaveLength(48);
    player.dispose();
    expect(context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  });
});
