// Judgement engine v0 — works out hits from the replay so circles disappear when they were
// actually clicked and misses show as misses. This is a first pass at stable's rules:
//   ✓ hit windows from OD, circle radius check, note-lock (only the earliest live object can be hit)
//   ✓ early clicks inside the miss window count as misses
//   ✓ slider tracking with a 2.4× follow area, parts-ratio slider result, spinner spin counting
//   ✗ not yet exact: stable's slider-start leniency, 2B edge cases, spinner rpm smoothing, HP
// Phase 6 replaces the ✗ items; header stats in the replay are the yardstick.

import type { PreparedMap, SliderObj, SpinnerObj } from './prepare';
import { hitWindows, sliderBallAt } from './prepare';
import { cursorAt, KEY, type ReplayFrame } from '../load/replay';
import { hitPoints, modMultiplier, sliderPartPoints, spinnerSpinPoints } from './score';

export type Hit = 300 | 100 | 50 | 0;

export interface ObjectJudgement {
  /** Final result for the object. */
  result: Hit;
  /** When the head was hit (circles, slider heads); null if missed. */
  hitTime: number | null;
  /** When a slider-head was explicitly clicked too early to hit; separate from final resultTime. */
  headMissTime?: number;
  /** When the final result is decided (head miss time for circles, end for sliders/spinners). */
  resultTime: number;
  /** Slider only: whether each part (in SliderObj.parts order) was collected. */
  parts?: boolean[];
  /** Slider only: time ranges when the follow circle was active. */
  tracking?: [number, number][];
  /** Spinner only: completed rotations. */
  spins?: number;
}

export interface ComboEvent {
  t: number;
  combo: number;
  /** Running accuracy 0..1 after this event (only changes on final object results). */
  accuracy: number;
  counts: { c300: number; c100: number; c50: number; miss: number };
  /** Running ScoreV1 total after this event. */
  score: number;
  /** The result that caused this event, if it was an object result. */
  result?: Hit;
  x?: number;
  y?: number;
}

export interface Judgement {
  objects: ObjectJudgement[];
  events: ComboEvent[];
  maxCombo: number;
  counts: { c300: number; c100: number; c50: number; miss: number };
  totalScore: number;
  /** Every point-scoring hit in time order, for checking score formulas against headers. */
  scoring: { t: number; base: number; before: number; flat: number }[];
}

const MISS_WINDOW = 400;
const FOLLOW_SCALE = 2.4;
const PRESS_MASK = KEY.M1 | KEY.M2; // K1 sets M1 and K2 sets M2 in the replay bitfield

interface Press {
  t: number;
  x: number;
  y: number;
  /** Nearby cursor positions (previous and next frame), used when pressPositionFrames is on. */
  nearby: { x: number; y: number }[];
}

export function findPresses(frames: ReplayFrame[]): Press[] {
  const out: Press[] = [];
  let prev = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const down = f.keys & PRESS_MASK;
    const newly = down & ~prev;
    const nearby = [frames[i - 1], frames[i + 1]].filter(Boolean).map((n) => ({ x: n.x, y: n.y }));
    // Pressing both keys on the same frame counts as two presses, like stable.
    if (newly & KEY.M1) out.push({ t: f.t, x: f.x, y: f.y, nearby });
    if (newly & KEY.M2) out.push({ t: f.t, x: f.x, y: f.y, nearby });
    prev = down;
  }
  return out;
}

function headResult(offset: number, w: ReturnType<typeof hitWindows>): Hit {
  // stable: round the measured error, truncate each OD window, and use strict <.
  // At OD5, 49.4ms is a 300, 49.5ms is a 100, 99.5ms is a 50.
  const a = Math.round(Math.abs(offset));
  if (a < Math.trunc(w.w300)) return 300;
  if (a < Math.trunc(w.w100)) return 100;
  if (a < Math.trunc(w.w50)) return 50;
  return 0;
}

export interface JudgeOptions {
  /** Multiplies all three hit windows. Experimental: used by the M2 sweep, default 1. */
  windowScale?: number;
  /** Multiplies the circle hit radius for head clicks. Experimental, default 1. */
  radiusScale?: number;
  /** Optional experimental reduction of the 300 window before truncation, default 0. */
  window300Offset?: number;
  /** Count a click as on a circle if the cursor was within radius on the frame before or after the press. */
  pressPositionFrames?: boolean;
}

export function judge(map: PreparedMap, frames: ReplayFrame[], options: JudgeOptions = {}): Judgement {
  const base = hitWindows(map.od);
  const ws = options.windowScale ?? 1;
  const off = options.window300Offset ?? 0;
  const w = { w300: Math.max(0, base.w300 * ws - off), w100: base.w100 * ws, w50: base.w50 * ws };
  const r = map.radius * (options.radiusScale ?? 1);
  const presses = findPresses(frames);
  const objects: ObjectJudgement[] = map.objects.map((o) => ({ result: 0, hitTime: null, resultTime: o.kind === 'circle' ? o.start + w.w50 : o.end }));
  const headDone: boolean[] = map.objects.map((o) => o.kind === 'spinner');
  const headHit: (Hit | null)[] = map.objects.map(() => null);

  // 1. Heads (circles and slider starts), in press order, with note-lock.
  let first = 0;
  for (const p of presses) {
    // Expire heads whose window has fully passed.
    while (first < map.objects.length && (headDone[first] || map.objects[first].start + w.w50 < p.t)) {
      if (!headDone[first]) {
        headDone[first] = true;
        headHit[first] = 0;
      }
      first++;
    }
    // A click goes to the earliest still-open object it lands on (inside its radius and window).
    // A click that lands on nothing is wasted; it does not hit a later object (osu! behaviour).
    for (let k = first; k < map.objects.length; k++) {
      const o = map.objects[k];
      if (o.start - MISS_WINDOW > p.t) break; // later objects can't be reached yet
      if (headDone[k]) continue;
      const offset = p.t - o.start;
      if (offset > w.w50) continue; // too late for this object; it will expire
      const cands = options.pressPositionFrames ? [p, ...p.nearby] : [p];
      if (!cands.some((c) => Math.hypot(c.x - o.x, c.y - o.y) <= r)) continue; // click missed this circle's area
      const res = headResult(offset, w); // early clicks inside MISS_WINDOW count as a miss
      headDone[k] = true;
      headHit[k] = res;
      if (res > 0) objects[k].hitTime = p.t;
      else {
        objects[k].resultTime = p.t;
        if (o.kind === 'slider') objects[k].headMissTime = p.t;
      }
      break;
    }
  }
  map.objects.forEach((o, i) => {
    if (!headDone[i]) headHit[i] = 0;
  });

  // 2. Final results per object.
  map.objects.forEach((o, i) => {
    const j = objects[i];
    if (o.kind === 'circle') {
      j.result = headHit[i] ?? 0;
    } else if (o.kind === 'slider') {
      judgeSlider(o, j, headHit[i] ?? 0, frames, r);
    } else {
      judgeSpinner(o, j, frames);
    }
  });

  return buildEvents(map, objects, w.w50);
}

function judgeSlider(s: SliderObj, j: ObjectJudgement, head: Hit, frames: ReplayFrame[], r: number) {
  const tracking: [number, number][] = [];
  const startFrom = j.hitTime ?? s.start;
  let trackStart: number | null = null;
  let hint = 0;

  // stable: tracking must first begin within the slider-ball radius; only an
  // already tracked slider uses the larger 2.4x follow area. Key-up always
  // cancels tracking, even if another key is pressed immediately afterwards.
  //
  // Include exact part and replay-frame timestamps in addition to our 4ms
  // samples. A tick on a key-up timestamp must not be awarded because a nearby
  // sample happened to be tracking.
  const times = new Set<number>([startFrom, s.end]);
  for (let t = startFrom; t < s.end; t += 4) times.add(t);
  s.parts.forEach((part) => {
    if (part.t >= startFrom && part.t <= s.end) times.add(part.t);
  });
  // Frames are time-sorted by the replay loader. Find the first frame at or
  // after the slider starts without scanning the entire replay per slider.
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < startFrom) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < frames.length && frames[i].t <= s.end; i++) {
    times.add(frames[i].t);
  }

  const partIndexes = new Map<number, number[]>();
  s.parts.forEach((part, index) => {
    const previous = partIndexes.get(part.t) ?? [];
    previous.push(index);
    partIndexes.set(part.t, previous);
  });
  const collected = s.parts.map(() => false);
  let tracked = false;
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t < startFrom || t > s.end) continue;
    const cursor = cursorAt(frames, t, hint);
    hint = cursor.index;
    const ball = sliderBallAt(s, t);
    const held = (cursor.keys & PRESS_MASK) !== 0;
    const distance = Math.hypot(cursor.x - ball.x, cursor.y - ball.y);
    const trackingNow: boolean = held && distance <= (tracked ? r * FOLLOW_SCALE : r);

    if (trackingNow && trackStart === null) trackStart = t;
    if (!trackingNow && trackStart !== null) {
      tracking.push([trackStart, t]);
      trackStart = null;
    }
    tracked = trackingNow;
    for (const index of partIndexes.get(t) ?? []) {
      collected[index] = tracked;
    }
  }
  if (trackStart !== null) tracking.push([trackStart, s.end]);

  j.tracking = tracking;
  j.parts = collected;
  const total = 1 + s.parts.length;
  const got = (head > 0 ? 1 : 0) + collected.filter(Boolean).length;
  j.result = got === total ? 300 : got * 2 >= total ? 100 : got > 0 ? 50 : 0;
  j.resultTime = s.end;
}

/**
 * Integrate held cursor movement into spinner revolutions.
 *
 * Stable supports spinning in either direction and caps speed at 477 RPM.
 * Integrating signed angles and taking abs at the end cancels legitimate spins
 * after a reversal; instead, count each direction's angular displacement.
 *
 * stable: this is a per-frame capped integration; the original client's
 * velocity smoothing and frame-rate-specific behaviour still require
 * reference-replay parity checks before M2 can be marked complete.
 */
export function spinnerRotations(frames: ReplayFrame[], start: number, end: number): number {
  const maxRadiansPerMs = (2 * Math.PI * (477 / 60)) / 1000;
  const pressMask = KEY.M1 | KEY.M2;
  let previousAngle: number | null = null;
  let previousTime: number | null = null;
  let accumulated = 0;

  for (const frame of frames) {
    if (frame.t < start) continue;
    if (frame.t > end) break;
    if (!(frame.keys & pressMask) ||
        !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) {
      previousAngle = null;
      previousTime = null;
      continue;
    }
    const angle = Math.atan2(frame.y - 192, frame.x - 256);
    if (previousAngle !== null && previousTime !== null) {
      const elapsed = frame.t - previousTime;
      if (elapsed > 0) {
        let difference = angle - previousAngle;
        if (difference > Math.PI) difference -= 2 * Math.PI;
        else if (difference < -Math.PI) difference += 2 * Math.PI;
        accumulated += Math.min(Math.abs(difference), elapsed * maxRadiansPerMs);
      }
    }
    previousAngle = angle;
    previousTime = frame.t;
  }
  return accumulated / (2 * Math.PI);
}

function judgeSpinner(s: SpinnerObj, j: ObjectJudgement, frames: ReplayFrame[]) {
  const spins = spinnerRotations(frames, s.start, s.end);
  j.spins = spins;
  const need = s.spinsRequired;
  j.result = spins >= need ? 300 : spins >= need - 1 ? 100 : spins >= need * 0.25 ? 50 : 0;
  j.resultTime = s.end;
}

function buildEvents(map: PreparedMap, objects: ObjectJudgement[], w50: number): Judgement {
  // base: ScoreV1 base points for a combo-adding hit (gets the combo bonus).
  // flat: points that never get a combo bonus (spinners).
  // flat: points with no combo bonus (slider ticks/repeats/tails, spinner spins).
  // A result carries the judged 300/100/50 that is scored with the combo bonus.
  type Raw = {
    t: number;
    kind: 'combo+' | 'break' | 'result';
    result?: Hit;
    x?: number;
    y?: number;
    slider?: boolean;
    flat?: number;
  };
  const raw: Raw[] = [];
  map.objects.forEach((o, i) => {
    const j = objects[i];
    if (o.kind === 'slider') {
      if (j.hitTime !== null) raw.push({ t: j.hitTime, kind: 'combo+', flat: sliderPartPoints('head') });
      else raw.push({ t: j.headMissTime ?? Math.min(o.start + w50, o.end), kind: 'break' });
      o.parts.forEach((p, k) => {
        const got = j.parts?.[k];
        // stable: a missed tick or repeat is a slider break even when the overall
        // slider judgement is 100/50 rather than MISS. A missed tail reduces
        // accuracy but does NOT break combo. Its true event time is p.t.
        if (got) raw.push({ t: p.t, kind: 'combo+', flat: sliderPartPoints(p.kind) });
        else if (p.kind !== 'tail') raw.push({ t: p.t, kind: 'break' });
      });
      raw.push({ t: j.resultTime, kind: 'result', result: j.result, x: o.parts.at(-1)?.x ?? o.x, y: o.parts.at(-1)?.y ?? o.y, slider: true });
    } else if (o.kind === 'spinner') {
      raw.push({ t: j.resultTime, kind: 'result', result: j.result, x: o.x, y: o.y, flat: spinnerSpinPoints(j.spins ?? 0, o.spinsRequired) });
    } else {
      raw.push({ t: j.result > 0 ? (j.hitTime ?? j.resultTime) : j.resultTime, kind: 'result', result: j.result, x: o.x, y: o.y });
    }
  });
  raw.sort((a, b) => a.t - b.t);

  const counts = { c300: 0, c100: 0, c50: 0, miss: 0 };
  let combo = 0;
  let maxCombo = 0;
  let score = 0;
  const diff = map.scoreDifficulty;
  const mod = modMultiplier(map.mods);
  const events: ComboEvent[] = [];
  const scoring: Judgement['scoring'] = [];
  const acc = () => {
    const n = counts.c300 + counts.c100 + counts.c50 + counts.miss;
    return n === 0 ? 1 : (300 * counts.c300 + 100 * counts.c100 + 50 * counts.c50) / (300 * n);
  };
  for (const e of raw) {
    const before = combo;
    if (e.kind === 'combo+') {
      combo++;
      if (e.flat) {
        score += e.flat;
        scoring.push({ t: e.t, base: 0, before, flat: e.flat });
      }
    } else if (e.kind === 'break') combo = 0;
    else {
      if (e.result === 300) counts.c300++;
      else if (e.result === 100) counts.c100++;
      else if (e.result === 50) counts.c50++;
      else counts.miss++;
      // Circles, sliders and spinners each score their judged result with the combo bonus.
      if (e.result) {
        const base = e.result;
        score += hitPoints(base, before, diff, mod);
        scoring.push({ t: e.t, base, before, flat: 0 });
      }
      if (e.flat) {
        score += e.flat;
        scoring.push({ t: e.t, base: 0, before, flat: e.flat });
      }
      // Circles and spinners add combo on their result; misses reset it.
      // Slider results don't add combo themselves (their head and parts already did).
      if (e.result === 0) combo = 0;
      else if (!e.slider) combo++;
    }
    maxCombo = Math.max(maxCombo, combo);
    events.push({ t: e.t, combo, accuracy: acc(), counts: { ...counts }, score, result: e.kind === 'result' ? e.result : undefined, x: e.x, y: e.y });
  }
  return { objects, events, maxCombo, counts, totalScore: score, scoring };
}

/** Latest combo event at or before t (binary search). */
export function eventAt(j: Judgement, t: number): ComboEvent | null {
  let lo = 0;
  let hi = j.events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (j.events[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? j.events[ans] : null;
}
