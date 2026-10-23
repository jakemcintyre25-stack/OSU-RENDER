/** Whether a recent score can be opened by this renderer. */
export interface ScorePlayability {
  playable: boolean;
  reason: string | null;
}

export function recentScorePlayability(score: { hasReplay: boolean; isLazer: boolean }): ScorePlayability {
  if (!score.hasReplay) {
    return { playable: false, reason: 'osu! did not keep a replay for this play' };
  }
  if (score.isLazer) {
    return { playable: false, reason: 'osu!lazer replays are not supported yet' };
  }
  return { playable: true, reason: null };
}
