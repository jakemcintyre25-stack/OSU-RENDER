import { describe, expect, it } from 'vitest';
import { VisibleObjectIndex } from '../src/render/visible-index';
import type { HitObj } from '../src/game/prepare';

const circle = (index: number, start: number): HitObj => ({
  index, kind: 'circle', start, end: start, x: 100, y: 100,
  comboNumber: index + 1, comboColor: 0xffffff, newCombo: false,
});
const spinner = (index: number, start: number, end: number): HitObj => ({
  ...circle(index, start), kind: 'spinner', end, spinsRequired: 3,
});

describe('M6 renderer visibility indexing', () => {
  it('includes overlapping long spinners and late objects across arbitrary seeks', () => {
    const objects = [circle(3, 3000), circle(1, 1000),
      spinner(0, 0, 6000), circle(2, 2000)];
    const index = new VisibleObjectIndex(objects);
    expect(index.at(2500, 500, 100).map(o => o.index)).toEqual([0, 2]);
    expect(index.at(4000, 500, 100).map(o => o.index)).toEqual([0]);
    expect(index.at(1000, 500, 100).map(o => o.index)).toEqual([0, 1]);
    expect(index.at(2500, 500, 100).map(o => o.index)).toEqual([0, 2]);
  });
  it('matches an exhaustive visibility scan over a large mixed-object map', () => {
    const objects: HitObj[] = Array.from({ length: 4000 }, (_, i) =>
      i % 13 === 0 ? spinner(i, i * 50, i * 50 + 1400) : circle(i, i * 50));
    const index = new VisibleObjectIndex([...objects].reverse());
    for (let t = -1000; t < 210000; t += 1279) {
      const expected = objects.filter(o => o.start - 900 <= t && o.end + 440 >= t)
        .map(o => o.index);
      expect(index.at(t, 900, 440).map(o => o.index)).toEqual(expected);
    }
  });
  it('handles empty maps, zero-width windows and invalid queries', () => {
    expect(new VisibleObjectIndex([]).at(0, 1200, 440)).toEqual([]);
    expect(new VisibleObjectIndex([circle(0, 100)]).at(100, 0, 0)).toHaveLength(1);
    expect(() => new VisibleObjectIndex([]).at(NaN, 1, 1)).toThrow(RangeError);
    expect(() => new VisibleObjectIndex([]).at(0, -1, 1)).toThrow(RangeError);
  });
});
