import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../src/audio/clock';

class TestAudioContext {
  currentTime = 10;
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  gain = { gain: { value: 1 }, connect: vi.fn() };
  sources: Array<{ playbackRate: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  createGain(): GainNode { return this.gain as unknown as GainNode; }
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
  decodeAudioData = vi.fn(async () => { throw new Error('not needed'); });
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
});
