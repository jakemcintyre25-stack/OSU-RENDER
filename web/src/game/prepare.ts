// Turns a parsed .osu + mods into flat, render-ready objects in playfield coordinates.
// Map maths (stacking, slider paths, HR flip, AR/CS changes) comes from osu-standard-stable,
// a port of osu!'s own standard ruleset.

import { BeatmapDecoder } from 'osu-parsers';
import { StandardRuleset, Circle, Slider, Spinner, SliderTick, SliderRepeat, SliderTail } from 'osu-standard-stable';
import { difficultyMultiplier } from './score';
import { parseAudioLeadIn } from '../audio/lead-in';

export interface Vec {
  x: number;
  y: number;
}

interface Base {
  index: number;
  start: number;
  end: number;
  x: number;
  y: number;
  comboNumber: number;
  comboColor: number;
  newCombo: boolean;
}
export interface CircleObj extends Base {
  kind: 'circle';
}
export interface SliderPart {
  t: number;
  x: number;
  y: number;
  kind: 'tick' | 'repeat' | 'tail';
  /** Which span (0-based) this part belongs to. */
  span: number;
}
export interface SliderObj extends Base {
  kind: 'slider';
  /** Path points (absolute, stacked) from head to the far end, cut to the slider's length. */
  path: Vec[];
  spans: number;
  spanDuration: number;
  parts: SliderPart[];
  /** Position on the path for progress 0..1 (absolute, stacked). */
  pointAt(progress: number): Vec;
}
export interface SpinnerObj extends Base {
  kind: 'spinner';
  spinsRequired: number;
}
export type HitObj = CircleObj | SliderObj | SpinnerObj;

export interface PreparedMap {
  title: string;
  artist: string;
  version: string;
  creator: string;
  mods: string[];
  /** Playback speed: 1.5 for DT/NC, 0.75 for HT. */
  rate: number;
  cs: number;
  ar: number;
  od: number;
  hp: number;
  /** ScoreV1 difficulty multiplier from original (unmodded) values. */
  scoreDifficulty: number;
  radius: number;
  preempt: number;
  fadeIn: number;
  hidden: boolean;
  objects: HitObj[];
  comboColors: number[];
  audioFile: string | null;
  /** Explicit silence preceding the audio timeline, from [General] AudioLeadIn. */
  audioLeadIn?: number;
  backgroundFile: string | null;
  breaks: { start: number; end: number }[];
  /** Map time at which the first object appears; playback starts a little before this. */
  firstObjectTime: number;
  lastObjectTime: number;
}

/** osu! default skin combo colours, used when a map defines none. */
export const DEFAULT_COMBO_COLORS = [0xffc000, 0x00ca00, 0x127cff, 0xf21839];

export function rateForMods(mods: string[]): number {
  if (mods.includes('DT') || mods.includes('NC')) return 1.5;
  if (mods.includes('HT') || mods.includes('DC')) return 0.75;
  return 1;
}

// Mods that change the map itself. Others (NF, SD, PF, SO, TD...) don't affect what's drawn.
const MAP_MODS = ['EZ', 'HR', 'HD', 'DT', 'NC', 'HT', 'FL'];

export function prepareMap(osuText: string, mods: string[] = []): PreparedMap {
  const parsed = new BeatmapDecoder().decodeFromString(osuText, { parseStoryboard: false });
  if (parsed.mode !== 0) throw new Error('Only osu!standard maps are supported for now');
  const ruleset = new StandardRuleset();
  const modString = mods.filter((m) => MAP_MODS.includes(m)).join('') || 'NM';
  const beatmap = ruleset.applyToBeatmapWithMods(parsed, ruleset.createModCombination(modString));
  const d = beatmap.difficulty;

  // ScoreV1 uses the map's original values; mods don't change the difficulty multiplier's inputs.
  const original = ruleset.applyToBeatmapWithMods(parsed, ruleset.createModCombination('NM'));
  const originalHits = original.hitObjects;
  const breakMs = (parsed.events.breaks ?? []).reduce((sum, b) => sum + Math.max(0, b.endTime - b.startTime), 0);
  const drainSeconds = Math.max(1, (originalHits.at(-1)?.startTime ?? 0) - (originalHits[0]?.startTime ?? 0) - breakMs) / 1000;
  const scoreDifficulty = difficultyMultiplier(
    original.difficulty.drainRate,
    original.difficulty.circleSize,
    original.difficulty.overallDifficulty,
    originalHits.length,
    drainSeconds,
  );

  const colors = (parsed.colors?.comboColors ?? []).map((c) => (c.red << 16) | (c.green << 8) | c.blue);
  const comboColors = colors.length ? colors : DEFAULT_COMBO_COLORS;

  let radius = 0;
  let preempt = 0;
  let fadeIn = 0;
  const objects: HitObj[] = [];

  beatmap.hitObjects.forEach((o, index) => {
    const pos = o.stackedStartPosition;
    const base = {
      index,
      start: o.startTime,
      end: o.startTime,
      x: pos.x,
      y: pos.y,
      comboNumber: o.currentComboIndex + 1,
      comboColor: comboColors[o.comboIndexWithOffsets % comboColors.length],
      newCombo: o.isNewCombo,
    };
    if (!radius && !(o instanceof Spinner)) {
      radius = o.radius;
      preempt = o.timePreempt;
      fadeIn = o.timeFadeIn;
    }
    if (o instanceof Slider) {
      const s = o;
      const offX = pos.x;
      const offY = pos.y;
      const calc = s.path.calculatedPath;
      const path = calc.map((p) => ({ x: p.x + offX, y: p.y + offY }));
      const parts: SliderPart[] = [];
      for (const n of s.nestedHitObjects) {
        const kind = n instanceof SliderTick ? 'tick' : n instanceof SliderRepeat ? 'repeat' : n instanceof SliderTail ? 'tail' : null;
        if (!kind) continue;
        const np = (n as unknown as { stackedStartPosition: Vec }).stackedStartPosition;
        parts.push({ t: n.startTime, x: np.x, y: np.y, kind, span: Math.min(Math.floor((n.startTime - s.startTime) / s.spanDuration), s.spans - 1) });
      }
      parts.sort((a, b) => a.t - b.t);
      objects.push({
        ...base,
        kind: 'slider',
        end: s.endTime,
        path,
        spans: s.spans,
        spanDuration: s.spanDuration,
        parts,
        pointAt(progress: number) {
          const p = s.path.positionAt(Math.min(Math.max(progress, 0), 1));
          return { x: p.x + offX, y: p.y + offY };
        },
      });
    } else if (o instanceof Spinner) {
      objects.push({ ...base, kind: 'spinner', end: o.endTime, x: 256, y: 192, spinsRequired: o.spinsRequired });
    } else if (o instanceof Circle) {
      objects.push({ ...base, kind: 'circle' });
    }
  });

  return {
    title: parsed.metadata.title,
    artist: parsed.metadata.artist,
    version: parsed.metadata.version,
    creator: parsed.metadata.creator,
    mods,
    rate: rateForMods(mods),
    cs: d.circleSize,
    ar: d.approachRate,
    od: d.overallDifficulty,
    hp: d.drainRate,
    scoreDifficulty,
    radius: radius || 54.4 - 4.48 * d.circleSize,
    preempt: preempt || 1200,
    fadeIn: fadeIn || 400,
    hidden: mods.includes('HD'),
    objects,
    comboColors,
    audioFile: parsed.general.audioFilename || null,
    audioLeadIn: parseAudioLeadIn(osuText),
    backgroundFile: parsed.events.backgroundPath || null,
    breaks: (parsed.events.breaks ?? []).map((b) => ({ start: b.startTime, end: b.endTime })),
    firstObjectTime: objects[0]?.start ?? 0,
    lastObjectTime: objects.reduce((m, o) => Math.max(m, o.end), 0),
  };
}

/** Where the slider ball is at map time t. */
export function sliderBallAt(s: SliderObj, t: number): Vec {
  const elapsed = Math.min(Math.max(t - s.start, 0), s.end - s.start);
  const spanF = s.spanDuration > 0 ? elapsed / s.spanDuration : 0;
  const span = Math.min(Math.floor(spanF), s.spans - 1);
  let p = spanF - span;
  if (span % 2 === 1) p = 1 - p;
  return s.pointAt(p);
}

/** Stable hit windows in ms (±) for a given OD. */
export function hitWindows(od: number) {
  return { w300: 80 - 6 * od, w100: 140 - 8 * od, w50: 200 - 10 * od };
}
