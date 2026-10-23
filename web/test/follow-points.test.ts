import { describe, expect, it } from 'vitest';
import { followPointPositions } from '../src/render/follow-points';

describe('default-skin follow points', () => {
  it('places dots strictly between the two objects', () => {
    const points = followPointPositions({ x: 0, y: 0 }, { x: 128, y: 0 });
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 32, y: 0 });
    expect(points[2]).toEqual({ x: 96, y: 0 });
  });

  it('does not draw follow points for very short jumps', () => {
    expect(followPointPositions({ x: 0, y: 0 }, { x: 40, y: 0 })).toEqual([]);
  });

  it('rejects invalid coordinates or spacing', () => {
    expect(followPointPositions({ x: NaN, y: 0 }, { x: 10, y: 0 })).toEqual([]);
    expect(followPointPositions({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual([]);
  });
});
