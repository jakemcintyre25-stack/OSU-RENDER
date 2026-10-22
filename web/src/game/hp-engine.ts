import { activeDrainIntervals, activeDrainMilliseconds } from './hp-timeline';

/** A deterministic HP timeline driven by explicitly supplied calibration.
 *
 * This is an engine for replaying calibrated HP changes, NOT a claim that
 * these coefficients match osu!stable. The caller must supply independently
 * validated values before displaying a stable-parity HP bar.
 */
export interface HpCalibration {
  /** HP units lost per active (non-break) map millisecond. */
  drainPerMs: number;
  /** Initial HP in the same units as the changes. */
  initial: number;
  /** Maximum permitted HP in these units. */
  maximum: number;
}

export interface HpDelta {
  t: number;
  /** Signed HP change, applied after drain up to this timestamp. */
  amount: number;
}

export interface HpSnapshot {
  t: number;
  hp: number;
}

export interface HpTrace {
  snapshots: HpSnapshot[];
  /** First time HP reaches zero, including during drain between events. */
  zeroTime: number | null;
}

export function simulateHp(
  start: number,
  end: number,
  breaks: ReadonlyArray<{ start: number; end: number }>,
  deltas: ReadonlyArray<HpDelta>,
  calibration: HpCalibration,
): HpTrace {
  const { drainPerMs, initial, maximum } = calibration;
  if (![drainPerMs, initial, maximum].every(Number.isFinite) ||
      drainPerMs < 0 || maximum <= 0 || initial < 0 || initial > maximum) {
    throw new RangeError('Invalid HP calibration');
  }
  // Validate time and break boundaries even when there are no events.
  activeDrainMilliseconds(start, end, breaks);
  const changes = deltas.map((delta, i) => {
    if (!Number.isFinite(delta.t) || !Number.isFinite(delta.amount) ||
        delta.t < start || delta.t > end) throw new RangeError('Invalid HP event');
    return { ...delta, index: i };
  }).sort((a, b) => a.t - b.t || a.index - b.index);
  let t = start;
  let hp = initial;
  let zeroTime: number | null = initial === 0 ? start : null;
  const snapshots: HpSnapshot[] = [{ t, hp }];
  for (const change of [...changes, { t: end, amount: 0, index: changes.length }]) {
    const elapsed = activeDrainMilliseconds(t, change.t, breaks);
    const drained = elapsed * drainPerMs;
    if (zeroTime === null && drainPerMs > 0 && drained >= hp) {
      // Solve for the exact crossing inside the union of active intervals,
      // never counting time inside a beatmap break.
      let remaining = hp / drainPerMs;
      const active = activeIntervalsWithin(t, change.t, breaks);
      for (const [a, b] of active) {
        if (remaining <= b - a) {
          zeroTime = a + remaining;
          break;
        }
        remaining -= b - a;
      }
    }
    hp = Math.max(0, hp - drained);
    hp = Math.min(maximum, Math.max(0, hp + change.amount));
    t = change.t;
    snapshots.push({ t, hp });
    if (zeroTime === null && hp === 0) zeroTime = t;
  }
  return { snapshots, zeroTime };
}

function activeIntervalsWithin(start: number, end: number, breaks: ReadonlyArray<{ start: number; end: number }>) {
  // Import kept here as an explicit named dependency, not an approximation.
  return activeDrainIntervals(start, end, breaks);
}
