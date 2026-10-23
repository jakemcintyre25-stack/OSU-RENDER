import { describe, expect, it } from 'vitest';
import { prepareMap, spinnerHalfSpinsRequired, type PreparedMap, type SliderObj } from '../src/game/prepare';
import type { Judgement, ObjectJudgement } from '../src/game/judge';
import {
  STABLE_HP_MAXIMUM,
  computeStableHpCoefficients,
  stableDifficultyRange,
  stableHpFromJudgement,
  stableHpGains,
} from '../src/game/hp-stable';

function chart(overrides = '', objects = ''): string {
  return `osu file format v14
[General]
Mode:0
[Metadata]
Title:HP fixture
Artist:Test
Creator:Tests
Version:HP
[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,0,100,1,0
${overrides}
[HitObjects]
${objects}
`;
}

function circleMap(count = 10, hp = 5): PreparedMap {
  const objects = Array.from({ length: count }, (_, i) =>
    `100,100,${1000 + i * 500},1,0,0:0:0:0:`).join('\n');
  return prepareMap(chart('', objects).replace('HPDrainRate:5', `HPDrainRate:${hp}`));
}

function mixedMap(): PreparedMap {
  return prepareMap(chart('', [
    '100,100,1000,1,0,0:0:0:0:',
    '200,100,2000,2,0,L|300:100,2,200',
    '256,192,4000,8,0,6000',
  ].join('\n')));
}

function judgementFor(map: PreparedMap, result: 0 | 50 | 100 | 300): Judgement {
  const objects: ObjectJudgement[] = map.objects.map((object) => ({
    result,
    hitTime: result === 0 ? null : object.start,
    resultTime: result === 0 ? object.start + 150 : object.start,
  }));
  return {
    objects,
    events: [],
    maxCombo: 0,
    counts: { c300: 0, c100: 0, c50: 0, miss: 0 },
    totalScore: 0,
    scoring: [],
    failTime: null,
  };
}

describe('stable HP calibration', () => {
  it('uses the 200-unit stable health bar and a positive drain', () => {
    const coefficients = computeStableHpCoefficients(circleMap());
    expect(coefficients.maximum).toBe(STABLE_HP_MAXIMUM);
    expect(coefficients.initial).toBe(STABLE_HP_MAXIMUM);
    expect(coefficients.drainPerMs).toBeGreaterThan(0);
    expect(coefficients.hpMultiplierNormal).toBeGreaterThanOrEqual(1);
    expect(coefficients.hpMultiplierComboEnd).toBeGreaterThanOrEqual(1);
  });

  it('drains harder at higher HP drain rate', () => {
    const low = computeStableHpCoefficients(circleMap(20, 2));
    const high = computeStableHpCoefficients(circleMap(20, 9));
    expect(high.drainPerMs).toBeGreaterThan(low.drainPerMs);
  });

  it('does not manufacture drain for a map with no objects', () => {
    const empty = { ...circleMap(1), objects: [] };
    const coefficients = computeStableHpCoefficients(empty);
    expect(coefficients.drainPerMs).toBe(0);
    expect(coefficients.hpMultiplierNormal).toBe(1);
  });

  it('maps difficulty values with stable endpoints', () => {
    expect(stableDifficultyRange(0, 90, 150, 225)).toBe(90);
    expect(stableDifficultyRange(5, 90, 150, 225)).toBe(150);
    expect(stableDifficultyRange(10, 90, 150, 225)).toBe(225);
  });

  it('exposes the stable health-gain shape', () => {
    const coefficients = computeStableHpCoefficients(circleMap());
    const gains = stableHpGains(5, coefficients);
    expect(gains.miss).toBeLessThan(0);
    expect(gains.sliderBreak).toBeLessThan(0);
    expect(gains.hit300).toBeGreaterThan(0);
    expect(gains.comboEndGeki).toBeGreaterThan(gains.hit300);
  });
});

describe('stable HP trace from judgements', () => {
  it('keeps an all-300 run alive without a health failure', () => {
    const map = circleMap(10);
    const judged = stableHpFromJudgement(map, judgementFor(map, 300));
    expect(judged.trace.snapshots.length).toBeGreaterThan(0);
    expect(judged.failTime).toBeNull();
    expect(judged.trace.zeroTime).toBeNull();
  });

  it('fails a miss-heavy run at a negative judgement', () => {
    const map = circleMap(10);
    // Isolate failure semantics from the calibration search: a deliberately
    // harsh drain guarantees the bar reaches zero during the miss sequence.
    const coefficients = { ...computeStableHpCoefficients(map), drainPerMs: 0.2 };
    const judged = stableHpFromJudgement(map, judgementFor(map, 0), coefficients);
    expect(judged.failTime).not.toBeNull();
    expect(judged.failTime!).toBeGreaterThanOrEqual(map.firstObjectTime);
    expect(judged.trace.zeroTime).not.toBeNull();
  });

  it('honours No Fail when health reaches zero', () => {
    const map = circleMap(10);
    map.mods = ['NF'];
    const coefficients = { ...computeStableHpCoefficients(map), drainPerMs: 0.2 };
    const judged = stableHpFromJudgement(map, judgementFor(map, 0), coefficients);
    expect(judged.failTime).toBeNull();
    expect(judged.trace.zeroTime).not.toBeNull();
  });

  it('handles slider and spinner nested health without throwing', () => {
    const map = mixedMap();
    const slider = map.objects[1] as SliderObj;
    const spinner = map.objects[2];
    const required = spinnerHalfSpinsRequired(map.od, spinner.end - spinner.start);
    const judgement: Judgement = {
      objects: [
        { result: 300, hitTime: 1000, resultTime: 1000 },
        { result: 300, hitTime: slider.start, resultTime: slider.end, parts: slider.parts.map(() => true) },
        { result: 300, hitTime: null, resultTime: spinner.end, halfSpins: 20, halfSpinsRequired: required },
      ],
      events: [], maxCombo: 3,
      counts: { c300: 3, c100: 0, c50: 0, miss: 0 },
      totalScore: 0, scoring: [], failTime: null,
    };
    const judged = stableHpFromJudgement(map, judgement);
    expect(judged.trace.snapshots.length).toBeGreaterThan(0);
    expect(judged.failTime).toBeNull();
  });

  it('applies slider-break health loss for a missed tick', () => {
    const map = mixedMap();
    const slider = map.objects[1] as SliderObj;
    const parts = slider.parts.map(() => false);
    const judgement: Judgement = {
      objects: [
        { result: 300, hitTime: 1000, resultTime: 1000 },
        { result: 50, hitTime: slider.start, resultTime: slider.end, parts },
        { result: 0, hitTime: null, resultTime: map.objects[2].end },
      ],
      events: [], maxCombo: 0,
      counts: { c300: 1, c100: 0, c50: 1, miss: 1 },
      totalScore: 0, scoring: [], failTime: null,
    };
    const judged = stableHpFromJudgement(map, judgement);
    expect(judged.gains.sliderBreak).toBeLessThan(0);
    expect(judged.trace.snapshots.length).toBeGreaterThan(0);
  });

  it('adds combo-end health for a perfect combo', () => {
    const map = circleMap(1);
    const coefficients = computeStableHpCoefficients(map);
    const gains = stableHpGains(5, coefficients);
    const judged = stableHpFromJudgement(map, judgementFor(map, 300), coefficients);
    // The single object is both the hit and the combo end; the last snapshot
    // includes the 300 plus the geki increase.
    const last = judged.trace.snapshots.at(-1)!.hp;
    expect(last).toBeLessThanOrEqual(STABLE_HP_MAXIMUM);
    expect(gains.comboEndGeki).toBeGreaterThan(0);
  });
});
