import { describe, expect, it } from 'vitest';
import { activeDrainIntervals, activeDrainMilliseconds } from '../src/game/hp-timeline';

describe('M3 break-excluded HP timeline', () => {
  it('subtracts disjoint breaks from active map time', () => {
    const breaks = [{ start: 200, end: 300 }, { start: 600, end: 800 }];
    expect(activeDrainIntervals(100, 1000, breaks)).toEqual([[100,200],[300,600],[800,1000]]);
    expect(activeDrainMilliseconds(100,1000,breaks)).toBe(600);
  });
  it('merges overlapping, adjacent, unsorted and duplicated breaks', () => {
    const breaks = [{start:300,end:500},{start:200,end:400},{start:500,end:550},{start:200,end:400}];
    expect(activeDrainIntervals(100,600,breaks)).toEqual([[100,200],[550,600]]);
    expect(activeDrainMilliseconds(100,600,breaks)).toBe(150);
  });
  it('clips breaks outside the active timeline and handles fully paused play', () => {
    expect(activeDrainIntervals(100,200,[{start:0,end:120},{start:180,end:500}])).toEqual([[120,180]]);
    expect(activeDrainIntervals(100,200,[{start:0,end:500}])).toEqual([]);
    expect(activeDrainIntervals(100,100,[])).toEqual([]);
  });
  it('rejects invalid map or break timestamps instead of silently approximating', () => {
    for (const [a,b] of [[-1,100],[200,100],[NaN,100],[0,Infinity]]) {
      expect(() => activeDrainIntervals(a,b,[])).toThrow(RangeError);
    }
    for (const br of [{start:20,end:10},{start:-1,end:20},{start:0,end:NaN}]) {
      expect(() => activeDrainIntervals(0,100,[br])).toThrow(RangeError);
    }
  });
});
