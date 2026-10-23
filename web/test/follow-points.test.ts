import { describe, expect, it } from 'vitest';
import type { HitObj } from '../src/game/prepare';
import { firstFollowPointAtOrAfter, planFollowPoints } from '../src/render/follow-points';

const circle = (x: number, y: number, start: number, end = start): HitObj => ({
  kind: 'circle', x, y, start, end, index: 0, comboNumber: 1, comboColor: 0xffffff,
  newCombo: false, stackHeight: 0, preempt: 0,
} as unknown as HitObj);

const slider = (x: number, y: number, start: number, end: number, tail: { x: number; y: number }): HitObj => ({
  kind: 'slider', x, y, start, end, index: 0, comboNumber: 1, comboColor: 0xffffff,
  newCombo: false, stackHeight: 0, path: [{ x, y }, tail], spans: 1, spanDuration: end - start,
  parts: [], pointAt: () => tail,
} as unknown as HitObj);

describe('default-skin follow points', () => {
  it('places points evenly across a gap and sorts them by time', () => {
    const points = planFollowPoints([circle(0, 0, 0), circle(300, 0, 500, 500)], 30);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(12);
    expect(points.every((p) => p.t > 0 && p.t < 500)).toBe(true);
    expect(points.every((p) => p.y === 0 && p.x > 0 && p.x < 300)).toBe(true);
    expect(points.map((p) => p.t)).toEqual([...points.map((p) => p.t)].sort((a, b) => a - b));
  });

  it('skips spinners, short gaps and pairs that are too close together', () => {
    const spinner = { ...circle(0, 0, 0, 0), kind: 'spinner' } as HitObj;
    expect(planFollowPoints([spinner, circle(400, 0, 600)], 30)).toEqual([]);
    expect(planFollowPoints([circle(0, 0, 0, 0), circle(300, 0, 50)], 30)).toEqual([]);
    expect(planFollowPoints([circle(0, 0, 0, 0), circle(20, 0, 1000)], 30)).toEqual([]);
  });

  it('starts from a slider tail rather than its head', () => {
    const points = planFollowPoints([slider(0, 0, 0, 400, { x: 200, y: 0 }), circle(500, 0, 900)], 30);
    expect(points.length).toBeGreaterThan(0);
    expect(Math.min(...points.map((p) => p.x))).toBeGreaterThan(200);
    expect(Math.min(...points.map((p) => p.t))).toBeGreaterThan(400);
  });

  it('caps each gap and finds the first point at or after a timestamp', () => {
    const points = planFollowPoints([circle(0, 0, 0), circle(5000, 0, 4000)], 10);
    expect(points.length).toBeLessThanOrEqual(12);
    const index = firstFollowPointAtOrAfter(points, points[3].t);
    expect(index).toBe(3);
    expect(firstFollowPointAtOrAfter(points, -1)).toBe(0);
    expect(firstFollowPointAtOrAfter(points, 1e9)).toBe(points.length);
  });

  it('returns nothing for invalid input', () => {
    expect(planFollowPoints([], 30)).toEqual([]);
    expect(planFollowPoints([circle(0, 0, 0), circle(300, 0, 500)], 0)).toEqual([]);
    expect(planFollowPoints([circle(0, 0, 0), circle(300, 0, 500)], NaN)).toEqual([]);
  });
});
