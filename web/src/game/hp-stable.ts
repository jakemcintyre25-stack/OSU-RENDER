import type { PreparedMap, SliderObj, SpinnerObj } from './prepare';
import type { Hit, Judgement } from './judge';
import { hpAt, simulateHp, type HpCalibration, type HpDelta, type HpTrace } from './hp-engine';

/** osu!stable normalizes the health bar to 200 units. */
export const STABLE_HP_MAXIMUM = 200;

/** Coefficients recovered by replaying stable's simulated perfect play. */
export interface StableHpCoefficients extends HpCalibration {
  /** Multiplier applied to normal hit/slider/spinner health gains. */
  hpMultiplierNormal: number;
  /** Multiplier applied to combo-end (geki/katu) health gains. */
  hpMultiplierComboEnd: number;
}

/** Per-event stable health changes, in the same 0..200 units as the bar. */
export interface StableHpGains {
  miss: number;
  hit50: number;
  hit100: number;
  hit300: number;
  sliderBreak: number;
  sliderHead: number;
  sliderTick: number;
  sliderRepeat: number;
  spinnerSpin: number;
  spinnerBonus: number;
  comboEndGeki: number;
  comboEndKatu300: number;
  comboEndKatu100: number;
  comboEndMu: number;
}

export interface StableHpTrace {
  trace: HpTrace;
  coefficients: StableHpCoefficients;
  gains: StableHpGains;
  /** First negative judgement at zero health; null with No Fail or no failure. */
  failTime: number | null;
}

/** osu! `MapDifficultyRange`: min at difficulty 0, mid at 5, max at 10. */
export function stableDifficultyRange(value: number, min: number, mid: number, max: number): number {
  if (value > 5) return mid + (max - mid) * (value - 5) / 5;
  if (value < 5) return mid - (mid - min) * (5 - value) / 5;
  return mid;
}

function isEndOfCombo(map: PreparedMap, index: number): boolean {
  return index === map.objects.length - 1 || map.objects[index + 1].newCombo;
}

/** Stable's HP drain-rate search, ported from McOsu's `computeDrainRate()`.
 *
 * The original client repeatedly simulates a perfect play and lowers the
 * trial drain until the simulated health stays above three HP targets and
 * leaves enough recoverable health. This is why stable's drain rate is not a
 * simple formula of the HP setting.
 */
export function computeStableHpCoefficients(map: PreparedMap): StableHpCoefficients {
  const objects = map.objects;
  if (objects.length === 0) {
    return {
      drainPerMs: 0,
      initial: STABLE_HP_MAXIMUM,
      maximum: STABLE_HP_MAXIMUM,
      hpMultiplierNormal: 1,
      hpMultiplierComboEnd: 1,
    };
  }
  const hp = map.hp;
  const version = map.fileFormat ?? 14;
  const firstStart = objects[0].start;
  const approach = map.preempt;
  const breaks = map.breaks;
  const lowestHpEver = stableDifficultyRange(hp, 195, 160, 60);
  const lowestHpComboEnd = stableDifficultyRange(hp, 198, 170, 80);
  const lowestHpEnd = stableDifficultyRange(hp, 198, 180, 80);
  const recoveryAvailable = stableDifficultyRange(hp, 8, 4, 0);
  const spinnerSpinsPerSecond = stableDifficultyRange(map.od, 3, 5, 7.5);

  let testDrop = 0.05;
  let multiplierNormal = 1;
  let multiplierComboEnd = 1;

  // Deterministic fixed-point search. Stable's loop converges quickly; the
  // cap only protects against malformed maps or a future formula regression.
  for (let iteration = 0; iteration < 10_000; iteration++) {
    let health = STABLE_HP_MAXIMUM;
    let healthUncapped = STABLE_HP_MAXIMUM;
    const increase = (amount: number) => {
      healthUncapped += amount;
      health += amount;
      if (health > STABLE_HP_MAXIMUM) health = STABLE_HP_MAXIMUM;
      if (health < 0) health = 0;
      if (healthUncapped < 0) healthUncapped = 0;
    };
    const decrease = (amount: number) => {
      health -= amount;
      if (health < 0) health = 0;
      if (health > STABLE_HP_MAXIMUM) health = STABLE_HP_MAXIMUM;
      healthUncapped -= amount;
      if (healthUncapped < 0) healthUncapped = 0;
    };
    const gain = (kind: '300' | 'slider10' | 'slider30' | 'spinner'): number => {
      switch (kind) {
        case '300':
          return multiplierNormal * 6 / STABLE_HP_MAXIMUM;
        case 'slider10':
          return multiplierNormal * 3 / STABLE_HP_MAXIMUM;
        case 'slider30':
          return multiplierNormal * 4 / STABLE_HP_MAXIMUM;
        case 'spinner':
          return multiplierNormal * 1.7 / STABLE_HP_MAXIMUM;
      }
    };
    const comboEndGain = (): number => multiplierComboEnd * 14 / STABLE_HP_MAXIMUM;

    let lowestHp = health;
    let lastTime = firstStart - approach;
    let breakIndex = 0;
    let comboTooLowCount = 0;
    let failed = false;

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      const localLastTime = lastTime;
      let breakTime = 0;
      if (breakIndex < breaks.length) {
        const nextBreak = breaks[breakIndex];
        if (nextBreak.start >= localLastTime && nextBreak.end <= object.start) {
          // Stable versions before 8 count a break from its own start; newer
          // versions stop draining at the previous object's end instead.
          breakTime = version < 8 ? nextBreak.end - nextBreak.start : nextBreak.end - localLastTime;
          breakIndex++;
        }
      }

      decrease(testDrop * (object.start - localLastTime - breakTime));
      lastTime = object.end;
      if (health < lowestHp) lowestHp = health;

      if (health > lowestHpEver) {
        const longObjectDrop = testDrop * (object.end - object.start);
        const maxLongObjectDrop = Math.max(0, longObjectDrop - health);
        decrease(longObjectDrop);

        if (object.kind === 'slider') {
          addSliderPerfectHealth(object as SliderObj, increase, gain);
        } else if (object.kind === 'spinner') {
          const spinner = object as SpinnerObj;
          const rotations = Math.trunc((spinner.end - spinner.start) / 1000 * spinnerSpinsPerSecond);
          for (let r = 0; r < rotations; r++) increase(gain('spinner'));
        }

        if (!(maxLongObjectDrop > 0) || health - maxLongObjectDrop > lowestHpEver) {
          increase(gain('300'));
          if (isEndOfCombo(map, i)) {
            increase(comboEndGain());
            if (health < lowestHpComboEnd) {
              comboTooLowCount++;
              if (comboTooLowCount > 2) {
                multiplierComboEnd *= 1.07;
                multiplierNormal *= 1.03;
                failed = true;
                break;
              }
            }
          }
          continue;
        }
      }

      failed = true;
      testDrop *= 0.96;
      break;
    }

    if (!failed && health < lowestHpEnd) {
      failed = true;
      testDrop *= 0.94;
      multiplierComboEnd *= 1.01;
      multiplierNormal *= 1.01;
    }
    const recovery = (healthUncapped - STABLE_HP_MAXIMUM) / objects.length;
    if (!failed && recovery < recoveryAvailable) {
      failed = true;
      testDrop *= 0.96;
      multiplierComboEnd *= 1.02;
      multiplierNormal *= 1.01;
    }
    if (!failed) {
      return {
        drainPerMs: testDrop,
        initial: STABLE_HP_MAXIMUM,
        maximum: STABLE_HP_MAXIMUM,
        hpMultiplierNormal: multiplierNormal,
        hpMultiplierComboEnd: multiplierComboEnd,
      };
    }
  }
  throw new Error('Stable HP simulation did not converge');
}

function addSliderPerfectHealth(
  slider: SliderObj,
  increase: (amount: number) => void,
  gain: (kind: '300' | 'slider10' | 'slider30' | 'spinner') => number,
): void {
  increase(gain('slider30')); // head
  for (const part of slider.parts) increase(gain(part.kind === 'tick' ? 'slider10' : 'slider30'));
}

/** Stable health gains for every judgement/part type. */
export function stableHpGains(hp: number, coefficients: StableHpCoefficients): StableHpGains {
  const normal = coefficients.hpMultiplierNormal;
  const comboEnd = coefficients.hpMultiplierComboEnd;
  const range = (min: number, mid: number, max: number) =>
    stableDifficultyRange(hp, min, mid, max) / STABLE_HP_MAXIMUM;
  return {
    miss: range(-6, -25, -40),
    hit50: normal * range(3.2, 0.4, 0.4),
    hit100: normal * range(17.6, 2.2, 2.2),
    hit300: normal * 6 / STABLE_HP_MAXIMUM,
    sliderBreak: range(-4, -15, -28),
    sliderHead: normal * 4 / STABLE_HP_MAXIMUM,
    sliderTick: normal * 3 / STABLE_HP_MAXIMUM,
    sliderRepeat: normal * 4 / STABLE_HP_MAXIMUM,
    spinnerSpin: normal * 1.7 / STABLE_HP_MAXIMUM,
    spinnerBonus: normal * 2 / STABLE_HP_MAXIMUM,
    comboEndGeki: comboEnd * 14 / STABLE_HP_MAXIMUM,
    comboEndKatu300: comboEnd * 10 / STABLE_HP_MAXIMUM,
    comboEndKatu100: comboEnd * 10 / STABLE_HP_MAXIMUM,
    comboEndMu: comboEnd * 6 / STABLE_HP_MAXIMUM,
  };
}

function resultGain(result: Hit, gains: StableHpGains): number {
  if (result === 300) return gains.hit300;
  if (result === 100) return gains.hit100;
  if (result === 50) return gains.hit50;
  return gains.miss;
}

interface TraceDelta extends HpDelta {
  negative: boolean;
}

/** Build a deterministic stable HP trace from the real judged replay. */
export function stableHpFromJudgement(
  map: PreparedMap,
  judgement: Judgement,
  coefficients = computeStableHpCoefficients(map),
): StableHpTrace {
  const gains = stableHpGains(map.hp, coefficients);
  const deltas: TraceDelta[] = [];
  const add = (t: number, amount: number, negative = amount < 0) => deltas.push({ t, amount, negative });

  let comboBitmask = 0;
  let comboLastResult: Hit = 300;

  for (let i = 0; i < map.objects.length; i++) {
    const object = map.objects[i];
    const judged = judgement.objects[i];
    if (!judged) throw new RangeError('Missing object judgement for HP trace');
    const result = judged.result;
    const resultTime = judged.hitTime ?? judged.resultTime;

    if (result === 100) comboBitmask |= 1;
    else if (result === 50 || result === 0) comboBitmask |= 2;
    comboLastResult = result;

    if (object.kind === 'circle') {
      add(resultTime, resultGain(result, gains));
    } else if (object.kind === 'slider') {
      if (judged.hitTime !== null) add(judged.hitTime, gains.sliderHead);
      else add(judged.headMissTime ?? object.end, gains.sliderBreak);
      if (judged.parts?.length !== object.parts.length) {
        throw new RangeError('Incomplete slider part judgements for HP trace');
      }
      for (const [index, part] of object.parts.entries()) {
        const got = judged.parts[index];
        const amount = part.kind === 'tick' ? gains.sliderTick : gains.sliderRepeat;
        add(part.t, got ? amount : gains.sliderBreak);
      }
      add(judged.resultTime, resultGain(result, gains));
    } else {
      add(judged.resultTime, resultGain(result, gains));
      const halfSpins = judged.halfSpins ?? 0;
      const required = judged.halfSpinsRequired ?? 0;
      const bonusThreshold = required + 3;
      const total = Math.max(1, halfSpins);
      for (let count = 2; count <= halfSpins; count++) {
        const t = object.start + (object.end - object.start) * (count / total);
        if (count > bonusThreshold && (count - bonusThreshold) % 2 === 0) add(t, gains.spinnerBonus);
        else if (count % 2 === 0) add(t, gains.spinnerSpin);
      }
    }

    if (isEndOfCombo(map, i)) {
      const comboEndTime = judged.resultTime;
      if (comboBitmask === 0) add(comboEndTime, gains.comboEndGeki);
      else if ((comboBitmask & 2) === 0) {
        if (comboLastResult === 300) add(comboEndTime, gains.comboEndKatu300);
        else if (comboLastResult === 100) add(comboEndTime, gains.comboEndKatu100);
      } else if (comboLastResult !== 0) {
        add(comboEndTime, gains.comboEndMu);
      }
      comboBitmask = 0;
      comboLastResult = 300;
    }
  }

  const first = map.firstObjectTime;
  const last = map.lastObjectTime;
  const start = deltas.reduce((min, event) => Math.min(min, event.t), first);
  const end = deltas.reduce((max, event) => Math.max(max, event.t), last);
  const breaks = [
    ...map.breaks,
    ...(start < first ? [{ start, end: first }] : []),
    ...(end > last ? [{ start: last, end }] : []),
  ];
  const trace = simulateHp(start, end, breaks, deltas, coefficients);

  let failTime: number | null = null;
  if (!map.mods.includes('NF')) {
    const ordered = [...deltas].sort((a, b) => a.t - b.t);
    for (const event of ordered) {
      if (!event.negative) continue;
      if (hpAt(trace, event.t) <= 0.001) {
        failTime = event.t;
        break;
      }
    }
  }

  return { trace, coefficients, gains, failTime };
}
