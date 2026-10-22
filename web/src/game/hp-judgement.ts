import type { PreparedMap } from './prepare';
import type { Hit, Judgement } from './judge';
import { simulateHp, type HpCalibration, type HpTrace } from './hp-engine';

/** Explicit result-to-HP delta mapping.
 * These values must be validated against the target osu!stable build before
 * enabling a production HP meter or HP-zero failure.
 */
export type HpResultGains = Record<Hit, number>;

/** Replays the real judgement event stream through the deterministic HP core.
 * SD/PF failTime remains independent; this does not alter scoring or gameplay.
 */
export function hpFromJudgement(
  map: PreparedMap,
  judgement: Judgement,
  calibration: HpCalibration,
  gains: HpResultGains,
): HpTrace {
  for (const result of [0, 50, 100, 300] as const) {
    if (!Number.isFinite(gains[result])) throw new RangeError('Invalid HP result gain');
  }
  const deltas = judgement.events
    .filter((e): e is typeof e & { result: Hit } => e.result !== undefined)
    .map(e => ({ t: e.t, amount: gains[e.result] }));
  // Early press judgements can precede the first object; missed circles can
  // resolve after the last object. Preserve these event timestamps, but do
  // not manufacture HP drain before the first object or after the last one.
  const first = map.firstObjectTime;
  const last = map.lastObjectTime;
  const start = deltas.reduce((min, e) => Math.min(min, e.t), first);
  const end = deltas.reduce((max, e) => Math.max(max, e.t), last);
  const breaks = [
    ...map.breaks,
    ...(start < first ? [{ start, end: first }] : []),
    ...(end > last ? [{ start: last, end }] : []),
  ];
  return simulateHp(start, end, breaks, deltas, calibration);
}
