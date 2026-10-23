import { describe, expect, it } from 'vitest';
import { stretchChannels } from '../src/audio/time-stretch';

const SAMPLE_RATE = 48_000;

function sine(frequency: number, seconds: number): Float32Array {
  const data = new Float32Array(Math.round(SAMPLE_RATE * seconds));
  for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  return data;
}

function estimateFrequency(data: Float32Array): number {
  let first = -1;
  let last = -1;
  let crossings = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  }
  return crossings > 1 && last > first ? ((crossings - 1) * SAMPLE_RATE) / (last - first) : 0;
}

describe('M5 pitch-preserving time stretch', () => {
  it('shortens DT audio while preserving a 440 Hz tone', () => {
    const input = sine(440, 1);
    const [output] = stretchChannels([input], 1.5);
    expect(output.length).toBeCloseTo(input.length / 1.5, -2);
    expect(estimateFrequency(output)).toBeCloseTo(440, -1.5);
  });

  it('lengthens HT audio while preserving pitch and both stereo channels', () => {
    const input = sine(440, 1);
    const [left, right] = stretchChannels([input, input.slice()], 0.75);
    expect(left.length).toBeCloseTo(input.length / 0.75, -2);
    expect(right.length).toBe(left.length);
    expect(estimateFrequency(left)).toBeCloseTo(440, -1.5);
    expect(estimateFrequency(right)).toBeCloseTo(440, -1.5);
  });

  it('returns a copy at rate 1 and rejects invalid input', () => {
    const input = sine(220, 0.1);
    const [copy] = stretchChannels([input], 1);
    expect(copy).not.toBe(input);
    expect([...copy]).toEqual([...input]);
    expect(() => stretchChannels([], 1.5)).toThrow(RangeError);
    expect(() => stretchChannels([input], 0.1)).toThrow(RangeError);
    expect(() => stretchChannels([input], 5)).toThrow(RangeError);
    expect(() => stretchChannels([input, new Float32Array(8)], 1.5)).toThrow(RangeError);
    expect(() => stretchChannels([input], 1.5, { frameSize: 1000 })).toThrow(RangeError);
  });

  it('does not produce NaN/Infinity or silent output', () => {
    const input = sine(330, 0.5);
    const [output] = stretchChannels([input], 1.25);
    expect(output.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(output.some((sample) => Math.abs(sample) > 0.2)).toBe(true);
  });
});
