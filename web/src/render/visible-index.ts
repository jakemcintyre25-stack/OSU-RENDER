import type { HitObj } from '../game/prepare';

/** Seekable index for the playfield's active object window.
 * Sorting is performed once per map, not on every animation frame.
 * Prefix maxima retain long sliders/spinners overlapping later circles.
 */
export class VisibleObjectIndex {
  private readonly objects: HitObj[];
  private readonly maxEnd: number[];
  constructor(objects: readonly HitObj[]) {
    this.objects = [...objects].sort((a, b) => a.start - b.start || a.index - b.index);
    this.maxEnd = [];
    let max = -Infinity;
    for (const obj of this.objects) {
      max = Math.max(max, obj.end);
      this.maxEnd.push(max);
    }
  }

  at(t: number, preempt: number, fadeAfter: number): HitObj[] {
    if (!Number.isFinite(t) || !Number.isFinite(preempt) || !Number.isFinite(fadeAfter) ||
        preempt < 0 || fadeAfter < 0) throw new RangeError('Invalid visibility query');
    // Upper bound on start <= now+preempt.
    let lo = 0, hi = this.objects.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.objects[mid].start <= t + preempt) lo = mid + 1;
      else hi = mid;
    }
    const last = lo;
    // First prefix maxEnd >= now-fadeAfter; all earlier objects are expired.
    lo = 0; hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.maxEnd[mid] < t - fadeAfter) lo = mid + 1;
      else hi = mid;
    }
    const visible: HitObj[] = [];
    for (let i = lo; i < last; i++) {
      if (this.objects[i].end + fadeAfter >= t) visible.push(this.objects[i]);
    }
    return visible;
  }
}
