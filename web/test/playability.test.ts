import { describe, expect, it } from 'vitest';
import { recentScorePlayability } from '../src/playability';

describe('M10 recent score gating', () => {
  it('opens ordinary replay-backed scores', () => {
    expect(recentScorePlayability({ hasReplay: true, isLazer: false }))
      .toEqual({ playable: true, reason: null });
  });

  it('explains a score with no replay', () => {
    expect(recentScorePlayability({ hasReplay: false, isLazer: false }))
      .toEqual({ playable: false, reason: 'osu! did not keep a replay for this play' });
  });

  it('blocks lazer scores before any download starts', () => {
    expect(recentScorePlayability({ hasReplay: true, isLazer: true }))
      .toEqual({ playable: false, reason: 'osu!lazer replays are not supported yet' });
  });

  it('prefers the no-replay reason when both apply', () => {
    expect(recentScorePlayability({ hasReplay: false, isLazer: true }))
      .toEqual({ playable: false, reason: 'osu! did not keep a replay for this play' });
  });
});
