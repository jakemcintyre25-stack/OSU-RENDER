import { describe, expect, it } from 'vitest';
import { playbackEndTime } from '../src/audio/timeline';

describe('replay time bounds', () => {
  it('plays through a song outro longer than the final circle', () => {
    expect(playbackEndTime(45_000, 60_000)).toBe(60_000);
  });
  it('keeps enough time for result flashes when audio ends early', () => {
    expect(playbackEndTime(45_000, 43_000)).toBe(45_500);
  });
  it('works for silent autoplay maps with no music', () => {
    expect(playbackEndTime(60_000, 0)).toBe(60_500);
  });
  it('sanitizes invalid metadata to avoid NaN slider positions', () => {
    expect(playbackEndTime(NaN, NaN)).toBe(1);
    expect(playbackEndTime(Infinity, 30_000)).toBe(30_000);
    expect(playbackEndTime(-1000, -1)).toBe(1);
  });
});
