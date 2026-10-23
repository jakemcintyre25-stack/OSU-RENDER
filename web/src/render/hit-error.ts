/** Hit-error and unstable-rate summary from a completed judgement. */
import type { HitObj } from '../game/prepare';
import type { ObjectJudgement } from '../game/judge';

export interface HitErrorSample {
  /** Milliseconds from the object's scheduled time; positive = late. */
  offset: number;
  result: number;
}

export interface HitErrorSummary {
  count: number;
  average: number;
  meanAbsolute: number;
  /** osu!-style unstable rate: population standard deviation × 10. */
  unstableRate: number;
}

export function hitErrorSamples(
  objects: HitObj[],
  judgements: ObjectJudgement[],
): HitErrorSample[] {
  const samples: HitErrorSample[] = [];
  const length = Math.min(objects.length, judgements.length);
  for (let i = 0; i < length; i++) {
    const judgement = judgements[i];
    const object = objects[i];
    if (judgement.result <= 0 || judgement.hitTime === null) continue;
    const offset = judgement.hitTime - object.start;
    if (!Number.isFinite(offset)) continue;
    samples.push({ offset, result: judgement.result });
  }
  return samples;
}

export function hitErrorSummary(samples: HitErrorSample[]): HitErrorSummary {
  if (!samples.length) return { count: 0, average: 0, meanAbsolute: 0, unstableRate: 0 };
  const offsets = samples.map((sample) => sample.offset);
  const average = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  const meanAbsolute = offsets.reduce((sum, value) => sum + Math.abs(value), 0) / offsets.length;
  const variance = offsets.reduce((sum, value) => sum + (value - average) ** 2, 0) / offsets.length;
  return {
    count: offsets.length,
    average,
    meanAbsolute,
    unstableRate: Math.sqrt(Math.max(0, variance)) * 10,
  };
}
