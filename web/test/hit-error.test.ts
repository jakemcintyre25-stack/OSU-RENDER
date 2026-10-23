import { describe, expect, it } from 'vitest';
import type { HitObj } from '../src/game/prepare';
import type { ObjectJudgement } from '../src/game/judge';
import { hitErrorSamples, hitErrorSummary } from '../src/render/hit-error';

const object = (start: number): HitObj => ({ start } as HitObj);
const judged = (result: number, hitTime: number | null): ObjectJudgement =>
  ({ result, hitTime, resultTime: 0 } as ObjectJudgement);

describe('M8 hit-error summary', () => {
  it('collects only successful hits and computes offsets', () => {
    const samples = hitErrorSamples(
      [object(1000), object(2000), object(3000), object(4000)],
      [judged(300, 1005), judged(0, null), judged(100, 2990), judged(50, 4000)],
    );
    expect(samples).toEqual([
      { offset: 5, result: 300 },
      { offset: -10, result: 100 },
      { offset: 0, result: 50 },
    ]);
    expect(hitErrorSamples([object(1)], [])).toEqual([]);
  });

  it('computes average, mean absolute error and UR', () => {
    const summary = hitErrorSummary([
      { offset: -10, result: 300 },
      { offset: 0, result: 300 },
      { offset: 10, result: 300 },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.average).toBeCloseTo(0, 9);
    expect(summary.meanAbsolute).toBeCloseTo(20 / 3, 9);
    expect(summary.unstableRate).toBeCloseTo(Math.sqrt(200 / 3) * 10, 6);
  });

  it('is zero-safe for no samples', () => {
    expect(hitErrorSummary([])).toEqual({ count: 0, average: 0, meanAbsolute: 0, unstableRate: 0 });
  });

  it('ignores non-finite offsets', () => {
    expect(hitErrorSamples([object(NaN)], [judged(300, 5)])).toEqual([]);
  });
});
