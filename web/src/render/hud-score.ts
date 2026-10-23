/** Running ScoreV1 shown in the HUD is a locally reconstructed value.
 * The engine has not yet passed real osu!stable score-header parity acceptance.
 */
export function formatCalculatedScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score) || score < 0) return '0';
  return Math.trunc(score).toLocaleString('en-US');
}

export function scoreHudLabel(score: number | null | undefined): string {
  return formatCalculatedScore(score) + ' · calculated';
}
