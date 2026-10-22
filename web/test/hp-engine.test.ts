import { describe, expect, it } from 'vitest';
import { hpAt, simulateHp } from '../src/game/hp-engine';

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
  it('seeks between events, freezes during breaks, and applies simultaneous gains', () => {
    const trace = simulateHp(0, 100, [{ start: 20, end: 60 }], [
      { t: 70, amount: 10 },
      { t: 70, amount: -3 },
    ], { initial: 100, maximum: 100, drainPerMs: 1 });
    expect(hpAt(trace, -10)).toBe(100);
    expect(hpAt(trace, 10)).toBe(90);
    expect(hpAt(trace, 30)).toBe(80);
    expect(hpAt(trace, 55)).toBe(80);
    expect(hpAt(trace, 65)).toBe(75);
    expect(hpAt(trace, 70)).toBe(77);
    expect(hpAt(trace, 80)).toBe(67);
    expect(hpAt(trace, 120)).toBe(47);
    expect(hpAt(trace, 10)).toBe(90);
    expect(() => hpAt(trace, NaN)).toThrow(RangeError);
  });
  it('seeks accurately through overlapping breaks and HP-zero crossings', () => {
    const trace = simulateHp(0, 100, [
      { start: 20, end: 45 }, { start: 30, end: 60 },
    ], [], { initial: 30, maximum: 100, drainPerMs: 1 });
    expect(hpAt(trace, 40)).toBe(10);
    expect(hpAt(trace, 60)).toBe(10);
    expect(hpAt(trace, 70)).toBe(0);
    expect(trace.zeroTime).toBe(70);
  });
  it('matches direct interval arithmetic across many breaks and event timestamps', () => {
    const breaks = Array.from({ length: 120 }, (_, i) => ({
      start: i * 100 + 25, end: i * 100 + 75,
    }));
    const deltas = Array.from({ length: 300 }, (_, i) => ({
      t: i * 40, amount: i % 3 === 0 ? 1 : 0,
    }));
    const trace = simulateHp(0, 12000, breaks, deltas, {
      initial: 500, maximum: 1000, drainPerMs: 0.01,
    });
    for (let t = 0; t <= 12000; t += 137) {
      const elapsed = t - breaks.reduce((sum, b) =>
        sum + Math.max(0, Math.min(t, b.end) - Math.min(t, b.start)), 0);
      const gains = deltas.filter(d => d.t <= t).reduce((sum, d) => sum + d.amount, 0);
      expect(hpAt(trace, t)).toBeCloseTo(500 - elapsed * 0.01 + gains, 7);
    }
  });
  it('validates calibration, event timestamps and break ranges', () => {
    expect(() => simulateHp(0, 10, [], [], { initial: 101, maximum: 100, drainPerMs: 1 })).toThrow(RangeError);
    expect(() => simulateHp(0, 10, [], [], { initial: 10, maximum: 100, drainPerMs: NaN })).toThrow(RangeError);
    expect(() => simulateHp(0, 10, [], [{ t: 11, amount: 5 }], calibration)).toThrow(RangeError);
    expect(() => simulateHp(0, 10, [{ start: 8, end: 2 }], [], calibration)).toThrow(RangeError);
    expect(() => simulateHp(10, 10, [{ start: 8, end: 2 }], [], calibration)).toThrow(RangeError);
  });
});
