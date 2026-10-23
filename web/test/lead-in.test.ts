import { describe, expect, it } from 'vitest';
import { MAX_AUDIO_LEAD_IN_MS, parseAudioLeadIn, initialPlaybackTime } from '../src/audio/lead-in';
import { prepareMap } from '../src/game/prepare';

const prefix = `osu file format v14
[General]
Mode:0
AudioLeadIn: 7800
[Metadata]
Title:Lead in
Artist:Test
Creator:Tests
Version:Normal
[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
100,100,1000,1,0,0:0:0:0:
`;

describe('M5 precise beatmap AudioLeadIn selection', () => {
  it('reads AudioLeadIn exclusively from General and preserves real map start', () => {
    expect(parseAudioLeadIn(prefix)).toBe(7800);
    const map = prepareMap(prefix);
    expect(map.audioLeadIn).toBe(7800);
    expect(initialPlaybackTime(map.firstObjectTime, map.audioLeadIn)).toBe(-7800);
  });
  it('keeps the original familiar approach when no lead-in is set', () => {
    expect(parseAudioLeadIn(prefix.replace('AudioLeadIn: 7800', ''))).toBe(0);
    expect(initialPlaybackTime(1000, 0)).toBe(-500);
    expect(initialPlaybackTime(5000, 0)).toBe(0);
  });
  it('does not interpret incidental metadata fields or comments as lead-in', () => {
    expect(parseAudioLeadIn(prefix.replace('AudioLeadIn: 7800', '// AudioLeadIn: 450\n')
      .replace('Title:Lead in', 'AudioLeadIn: 250\nTitle:Lead in'))).toBe(0);
  });
  it('rejects malformed or unbounded untrusted lead-in values', () => {
    for (const bad of ['-1', '1.2', 'NaN', '90000000000000', String(MAX_AUDIO_LEAD_IN_MS + 1)]) {
      expect(() => parseAudioLeadIn(prefix.replace('7800', bad))).toThrow(/AudioLeadIn/);
    }
    expect(() => initialPlaybackTime(NaN, 0)).toThrow(/Invalid/);
    expect(() => initialPlaybackTime(1000, -1)).toThrow(/Invalid/);
  });
});
