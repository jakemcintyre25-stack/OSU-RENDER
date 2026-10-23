import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../src/audio/clock';

interface TestCaptureTap {
  stream: { getAudioTracks: () => Array<{ kind: string; readyState: string; stop: ReturnType<typeof vi.fn> }> };
  disconnect: ReturnType<typeof vi.fn>;
  track: { kind: string; readyState: string; stop: ReturnType<typeof vi.fn> };
}

class TestAudioContext {
  currentTime = 10;
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  sources: Array<{ playbackRate: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  dests: TestCaptureTap[] = [];
  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    const track = { kind: 'audio', readyState: 'live', stop: vi.fn() };
    const tap = { stream: { getAudioTracks: () => [track] }, disconnect: vi.fn(), track };
    this.dests.push(tap);
    return tap as unknown as MediaStreamAudioDestinationNode;
  }
  createGain(): GainNode {
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: (channel: number) => data[channel],
    } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    const source = {
      playbackRate: { value: 1 }, buffer: null, connect: vi.fn(),
      start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null,
    };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn(async (): Promise<AudioBuffer> => { throw new Error('not needed'); });
}

let audio: TestAudioContext;

beforeEach(() => {
  class InstrumentedContext extends TestAudioContext {
    constructor() { super(); audio = this; }
  }
  vi.stubGlobal('AudioContext', InstrumentedContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Web Audio master clock seek, rate, pause and visual offset', () => {
  it('preserves the requested visual timeline with an offset while paused', () => {
    const clock = new Clock();
    clock.offset = 125;
    clock.seek(1500);
    expect(clock.now()).toBe(1500);
    clock.seek(-500);
    expect(clock.now()).toBe(-500);
    clock.dispose();
  });

  it('does not rewind by its 50 ms scheduled source lead-in on play', async () => {
    const clock = new Clock();
    clock.seek(1000);
    await clock.play();
    expect(clock.now()).toBe(1000);
    audio.currentTime += 0.03;
    expect(clock.now()).toBe(1000);
    audio.currentTime += 0.12;
    expect(clock.now()).toBeCloseTo(1100, 6);
    clock.pause();
    expect(clock.now()).toBeCloseTo(1100, 6);
    clock.dispose();
  });

  it('keeps nonzero offset consistent across playback, pause and repeated seeks', async () => {
    const clock = new Clock();
    clock.offset = 200;
    clock.seek(2000);
    await clock.play();
    audio.currentTime += 0.25; // 50 ms scheduled lead-in + 200 ms of playback
    expect(clock.now()).toBeCloseTo(2200, 6);
    clock.pause();
    expect(clock.now()).toBeCloseTo(2200, 6);
    clock.seek(500);
    expect(clock.now()).toBe(500);
    await clock.play();
    audio.currentTime += 0.15;
    expect(clock.now()).toBeCloseTo(600, 6);
    clock.dispose();
  });

  it('preserves map time when changing speed and when seeking during playback', async () => {
    const clock = new Clock();
    clock.offset = 80;
    clock.seek(1000);
    await clock.play();
    audio.currentTime += 0.25;
    expect(clock.now()).toBeCloseTo(1200, 6);
    clock.setRate(1.5);
    expect(clock.now()).toBeCloseTo(1200, 6);
    // setRate restarts asynchronously; finish resumed playback before advancing time.
    await Promise.resolve();
    audio.currentTime += 0.15;
    expect(clock.now()).toBeCloseTo(1350, 6);
    clock.seek(3000);
    expect(clock.now()).toBeCloseTo(3000, 6);
    await Promise.resolve();
    audio.currentTime += 0.15;
    expect(clock.now()).toBeCloseTo(3150, 6);
    clock.dispose();
  });
  it('separates master music volume and hit-effect volume without altering clock timing', () => {
    const clock = new Clock();
    expect(audio.gains.length).toBeGreaterThanOrEqual(2);
    clock.volume = 0.35;
    clock.effectsVolume = 0.8;
    expect(audio.gains[0].gain.value).toBe(0.35);
    expect(audio.gains[1].gain.value).toBe(0.8);
    clock.effectsVolume = 0;
    expect(audio.gains[0].gain.value).toBe(0.35);
    expect(audio.gains[1].gain.value).toBe(0);
    clock.volume = 3;
    clock.effectsVolume = -1;
    expect(audio.gains[0].gain.value).toBe(1);
    expect(audio.gains[1].gain.value).toBe(0);
    clock.seek(1000);
    expect(clock.now()).toBe(1000);
    clock.dispose();
  });

  it('uses a pitch-stretched music buffer for DT/HT playback', async () => {
    const clock = new Clock();
    audio.decodeAudioData.mockResolvedValue(audio.createBuffer(2, 12_000, 48_000));
    await clock.load(new ArrayBuffer(8));
    expect(await clock.prepareRate(1.5)).toBe(true);
    clock.rate = 1.5;
    clock.seek(150);
    await clock.play();
    const source = audio.sources.at(-1) as unknown as {
      playbackRate: { value: number };
      start: ReturnType<typeof vi.fn>;
    };
    expect(source.playbackRate.value).toBe(1);
    // 150 ms of map time is 100 ms inside the stretched buffer.
    expect(source.start.mock.calls[0][1]).toBeCloseTo(0.1, 6);
    clock.dispose();
  });

  it('does not start delayed Web Audio playback after player disposal', async () => {
    const clock = new Clock();
    audio.state = 'suspended';
    let resume!: () => void;
    audio.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; }));
    const pending = clock.play();
    clock.dispose();
    resume();
    await pending;
    expect(clock.isPlaying).toBe(false);
    expect(audio.sources).toHaveLength(0);
  });

  it('cancels pending suspended-context play requests after a seek or pause', async () => {
    const clock = new Clock();
    audio.state = 'suspended';
    let resume!: () => void;
    audio.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; }));
    const pending = clock.play();
    clock.seek(2500);
    resume();
    await pending;
    expect(clock.isPlaying).toBe(false);
    expect(clock.now()).toBe(2500);
    clock.dispose();
  });

  it('starts at most one source for concurrent suspended-context play calls', async () => {
    const clock = new Clock();
    audio.state = 'suspended';
    let resume!: () => void;
    audio.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; }));
    const p1 = clock.play();
    const p2 = clock.play();
    expect(audio.resume).toHaveBeenCalledTimes(1);
    resume();
    await Promise.all([p1, p2]);
    expect(clock.isPlaying).toBe(true);
    clock.dispose();
  });

  it('integrates loaded map sample cues with playback, pause and seek', async () => {
    const clock = new Clock();
    audio.decodeAudioData.mockResolvedValue({ duration: 0.1 } as AudioBuffer);
    const plan = {
      samples: new Map([['map/sample.wav', new Uint8Array([1, 2]).buffer]]),
      events: [
        { t: 1000, sample: 'map/sample.wav', gain: 0.8 },
        { t: 2000, sample: 'map/sample.wav', gain: 0.8 },
      ],
      unavailable: 0,
    };
    expect(await clock.loadHitsounds(plan)).toEqual({ loaded: 1, failed: 0 });
    clock.seek(900);
    await clock.play();
    clock.scheduleHitsounds();
    expect(audio.sources).toHaveLength(1);
    expect(audio.sources[0].start.mock.calls[0][0]).toBeCloseTo(10.15, 6);
    clock.pause();
    expect(audio.sources[0].stop).toHaveBeenCalledTimes(1);
    clock.seek(1900);
    await clock.play();
    clock.scheduleHitsounds();
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources[1].start.mock.calls[0][0]).toBeCloseTo(10.15, 6);
    clock.dispose();
    expect(audio.sources[1].stop).toHaveBeenCalledTimes(1);
  });

  it('taps music and hit effects into one capture stream and releases it idempotently', () => {
    const clock = new Clock();
    const capture = clock.createCaptureAudio();
    expect(audio.dests).toHaveLength(1);
    const dest = audio.dests[0];
    expect(audio.gains[0].connect).toHaveBeenCalledWith(dest);
    expect(audio.gains[1].connect).toHaveBeenCalledWith(dest);
    capture.dispose();
    capture.dispose();
    expect(dest.track.stop).toHaveBeenCalledOnce();
    expect(audio.gains[0].disconnect).toHaveBeenCalledWith(dest);
    expect(audio.gains[1].disconnect).toHaveBeenCalledWith(dest);
    clock.dispose();
  });

  it('releases an active capture tap when the player is disposed', () => {
    const clock = new Clock();
    const capture = clock.createCaptureAudio();
    clock.dispose();
    expect(audio.dests[0].track.stop).toHaveBeenCalledOnce();
    expect(audio.gains[0].disconnect).toHaveBeenCalledWith(audio.dests[0]);
    expect(() => clock.createCaptureAudio()).toThrow('no longer available');
    capture.dispose();
    expect(audio.dests[0].track.stop).toHaveBeenCalledOnce();
  });

});
