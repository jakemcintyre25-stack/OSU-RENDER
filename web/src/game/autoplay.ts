// Generates a perfect replay for a prepared map. Used for previewing maps without a replay
// and as a known-good input for tests (every object should judge as a 300).

import type { PreparedMap, Vec } from './prepare';
import { sliderBallAt } from './prepare';
import { KEY, type ReplayFrame } from '../load/replay';

const STEP = 1000 / 60;
const SPIN_RADIUS = 50;
const SPIN_SPEED = (Math.PI * 2 * 7) / 1000; // ~7 rotations per second, well above any requirement

export function generateAutoplay(map: PreparedMap): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  const push = (t: number, p: Vec, keys: number) => frames.push({ t, x: p.x, y: p.y, keys });
  let last: Vec = { x: 256, y: 192 };
  let lastT = Math.min(0, (map.objects[0]?.start ?? 0) - 1000);
  let useK1 = true;
  push(lastT, last, 0);

  for (let i = 0; i < map.objects.length; i++) {
    const o = map.objects[i];
    const key = useK1 ? KEY.K1 | KEY.M1 : KEY.K2 | KEY.M2;
    useK1 = !useK1;
    const target: Vec = o.kind === 'spinner' ? { x: 256 + SPIN_RADIUS, y: 192 } : { x: o.x, y: o.y };

    // Move in a straight line to the object, easing out, arriving exactly on time.
    const moveStart = Math.max(lastT, o.start - Math.max(map.preempt * 0.8, 100));
    for (let t = moveStart + STEP; t < o.start; t += STEP) {
      const k = (t - moveStart) / (o.start - moveStart);
      const e = 1 - (1 - k) * (1 - k);
      push(t, { x: last.x + (target.x - last.x) * e, y: last.y + (target.y - last.y) * e }, 0);
    }

    if (o.kind === 'circle') {
      push(o.start, target, key);
      // An exactly simultaneous 2B object has no time for a -1ms release.
      // Release on this timestamp instead of emitting a frame in the past.
      const release = Math.max(o.start, Math.min(o.start + 50, (map.objects[i + 1]?.start ?? Infinity) - 1));
      push(release, target, 0);
      last = target;
      lastT = release;
    } else if (o.kind === 'slider') {
      for (let t = o.start; t < o.end; t += STEP) push(t, sliderBallAt(o, t), key);
      const endPos = sliderBallAt(o, o.end);
      push(o.end, endPos, key);
      const release = Math.min(o.end + 20, (map.objects[i + 1]?.start ?? Infinity) - 1);
      push(release, endPos, 0);
      last = endPos;
      lastT = release;
    } else {
      let p = target;
      for (let t = o.start; t <= o.end; t += STEP) {
        const a = (t - o.start) * SPIN_SPEED;
        p = { x: 256 + Math.cos(a) * SPIN_RADIUS, y: 192 + Math.sin(a) * SPIN_RADIUS };
        push(t, p, key);
      }
      push(o.end + 1, p, 0);
      last = p;
      lastT = o.end + 1;
    }
  }
  return frames;
}
