import { describe, expect, it } from 'vitest';
import { simulateHp } from '../src/game/hp-engine';

const calibration = { initial: 100, maximum: 100, drainPerMs: 1 };

describe('M3 calibrated HP timeline mechanics (not stable coefficients)', () => {
  it('drains only in active time and applies gains at event timestamps', () => {
    const trace = simulateHp(0, 100, [{ start: 20, end: 60 }], [
      { t: 40, amount: 10 },
      { t: 80, amount: -5 },
    ], calibration);
    expect(trace.snapshots).toEqual([
      { t: 0, hp: 100 },
      { t: 40, hp: 90 },
      { t: 80, hp: 65 },
      { t: 100, hp: 45 },
    ]);
    expect(trace.zeroTime).toBeNull();
  });
  it('records exact zero crossing after a break rather than inside it', () => {
    const trace = simulateHp(0, 100, [{ start: 20, end: 60 }], [], {
      initial: 30, maximum: 100, drainPerMs: 1,
    });
    expect(trace.zeroTime).toBe(70);
    expect(trace.snapshots.at(-1)?.hp).toBe(0);
  });
  it('never retroactively removes first failure when later HP is recovered', () => {
    const trace = simulateHp(0, 100, [], [{ t: 50, amount: 100 }], {
      initial: 20, maximum: 100, drainPerMs: 1,
    });
    expect(trace.zeroTime).toBe(20);
    expect(trace.snapshots[1].hp).toBe(100);
    expect(trace.snapshots.at(-1)?.hp).toBe(50);
  });
  it('clips gains and losses to the calibrated range and retains event order', () => {
    const trace = simulateHp(0, 20, [], [
      { t: 10, amount: 300 },
      { t: 10, amount: -500 },
      { t: 10, amount: 20 },
    ], { initial: 30, maximum: 100, drainPerMs: 0 });
    expect(trace.snapshots.map(s => s.hp)).toEqual([30, 100, 0, 20, 20]);
    expect(trace.zeroTime).toBe(10);
  });
  it('validates calibration, event timestamps and break ranges', () => {
    expect(() => simulateHp(0, 10, [], [], { initial: 101, maximum: 100, drainPerMs: 1 })).toThrow(RangeError);
    expect(() => simulateHp(0, 10, [], [], { initial: 10, maximum: 100, drainPerMs: NaN })).toThrow(RangeError);
    expect(() => simulateHp(0, 10, [], [{ t: 11, amount: 5 }], calibration)).toThrow(RangeError);
    expect(() => simulateHp(0, 10, [{ start: 8, end: 2 }], [], calibration)).toThrow(RangeError);
  });
});
