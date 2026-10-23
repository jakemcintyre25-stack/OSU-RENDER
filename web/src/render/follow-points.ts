/** Default-skin follow points between consecutive hit objects. */
import type { HitObj } from '../game/prepare';

export interface FollowPoint {
  t: number;
  x: number;
  y: number;
}

const MAX_POINTS = 4000;
const MAX_PER_GAP = 12;

function centerOf(object: HitObj, atEnd: boolean): { x: number; y: number } {
  if (atEnd && object.kind === 'slider') {
    const tail = object.pointAt(1);
    return { x: tail.x, y: tail.y };
  }
  return { x: object.x, y: object.y };
}

/** Place evenly spaced dots along the straight gap between objects.
 * The dots appear over the gap after the previous object ends. This is an
 * approximation of stable's follow-point placement (which follows slider
 * paths across longer gaps), not a pixel-parity claim.
 */
export function planFollowPoints(objects: HitObj[], radius: number): FollowPoint[] {
  if (!(radius > 0) || objects.length < 2) return [];
  const spacing = Math.max(8, radius * 1.6);
  const points: FollowPoint[] = [];
  for (let i = 0; i < objects.length - 1; i++) {
    const a = objects[i];
    const b = objects[i + 1];
    if (a.kind === 'spinner' || b.kind === 'spinner') continue;
    const gap = b.start - a.end;
    if (!Number.isFinite(gap) || gap < 80) continue;
    const from = centerOf(a, true);
    const to = centerOf(b, false);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (!Number.isFinite(distance) || distance < spacing * 2) continue;
    const count = Math.min(MAX_PER_GAP, Math.floor(distance / spacing) - 1);
    for (let k = 1; k <= count; k++) {
      const f = k / (count + 1);
      points.push({
        t: a.end + gap * f,
        x: from.x + (to.x - from.x) * f,
        y: from.y + (to.y - from.y) * f,
      });
      if (points.length >= MAX_POINTS) return points;
    }
  }
  points.sort((p, q) => p.t - q.t);
  return points;
}

/** First point whose timestamp is at or after t, via binary search. */
export function firstFollowPointAtOrAfter(points: FollowPoint[], t: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
