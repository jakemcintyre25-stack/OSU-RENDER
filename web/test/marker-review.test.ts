import { describe, expect, it } from 'vitest';
import { markerReviewTime } from '../src/render/marker-review';
import { playbackEndTime } from '../src/audio/timeline';

describe('M8 direct review of score timeline events', () => {
  it('seeks two seconds before misses and 100s in map-time units', () => {
    expect(markerReviewTime(6000)).toBe(4000);
    expect(markerReviewTime(2500)).toBe(500);
  });
  it('clamps very early events to map start', () => {
    expect(markerReviewTime(500)).toBe(0);
    expect(markerReviewTime(2000)).toBe(0);
  });
  it('protects against malformed values and poisoned result times', () => {
    for (const t of [-1, NaN, Infinity]) expect(markerReviewTime(t)).toBe(0);
    for (const lead of [-1, NaN, Infinity]) expect(markerReviewTime(6000, lead)).toBe(0);
  });
  it('does not use playback rate or elapsed wall-clock milliseconds', () => {
    const end = playbackEndTime(10000, 12000);
    const review = markerReviewTime(9000);
    expect(review).toBe(7000);
    expect(review).toBeLessThan(end);
  });
});
