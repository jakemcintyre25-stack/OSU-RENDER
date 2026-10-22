// osu!stable beatmap-provided hitsound planning (M5, first playable subset).
// Reads .osu hit sample metadata and uses only actual .osz assets. Missing
// default skin samples are NOT fabricated; layered skins and slider loops
// require later M5/M7 work.
import type { PreparedMap } from '../game/prepare';
import type { Judgement } from '../game/judge';
import { findFile, type OszArchive } from '../load/osz';

export interface HitSoundEvent {
  /** The precise playback time in osu! map milliseconds. */
  t: number;
  /** Key in HitSoundPlan.samples, normalized to the archive's path. */
  sample: string;
  /** Relative hitsound volume from .osu metadata, 0..1. */
  gain: number;
}
export interface HitSoundPlan {
  events: HitSoundEvent[];
  samples: Map<string, ArrayBuffer>;
  /** Number of sound requests for which no beatmap sample was available. */
  unavailable: number;
}

interface SampleSettings {
  normal: number;
  addition: number;
  index: number;
  volume: number;
  filename: string;
}
interface TimingSample {
  t: number;
  set: number;
  index: number;
  volume: number;
}
const names: Record<number, string> = { 1: 'normal', 2: 'soft', 3: 'drum' };

const int = (value: string | undefined, fallback = 0) => {
  if (value === undefined || value === '') return fallback;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : fallback;
};
const safePath = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) ||
      normalized.split('/').some((p) => !p || p === '.' || p === '..')) return null;
  return normalized.toLowerCase();
};
const toBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function sampleSettings(value: string | undefined): SampleSettings {
  const parts = (value ?? '').split(':');
  return {
    normal: int(parts[0]),
    addition: int(parts[1]),
    index: int(parts[2]),
    volume: int(parts[3]),
    filename: parts.slice(4).join(':').trim(),
  };
}

/**
 * Build actual sample events for circles and slider heads, repeats, tails and
 * ticks. Spinner spin/bonus, skin default samples and continuous slider
 * sliding loops are explicitly not implemented here.
 *
 * Every event references a beatmap-archive file that exists. Object order and
 * timestamp are verified against the prepared osu!standard map; if the parser
 * ever disagrees about object mapping, fail visibly instead of playing wrong
 * sounds during an inaccurate replay.
 */
export function planHitsounds(
  osuText: string,
  map: PreparedMap,
  judgement: Judgement,
  archive: OszArchive | null,
  beatmapPath = '',
): HitSoundPlan {
  const plan: HitSoundPlan = { events: [], samples: new Map(), unavailable: 0 };
  if (!archive) return plan;
  const directory = beatmapPath.replace(/\\/g, '/').replace(/[^/]*$/, '');
  const timing: TimingSample[] = [];
  const objects: string[][] = [];
  let metadataSet = 1;
  let section = '';
  for (const line of osuText.replace(/\r/g, '').split('\n')) {
    const value = line.trim();
    if (!value || value.startsWith('//')) continue;
    if (value.startsWith('[') && value.endsWith(']')) {
      section = value.slice(1, -1);
      continue;
    }
    if (section === 'General') {
      const match = /^SampleSet\s*:\s*(Normal|Soft|Drum)\s*$/i.exec(value);
      if (match) metadataSet = ({ normal: 1, soft: 2, drum: 3 } as const)[match[1].toLowerCase() as 'normal' | 'soft' | 'drum'];
    } else if (section === 'TimingPoints') {
      const row = value.split(',');
      const t = Number(row[0]);
      if (row.length >= 6 && Number.isFinite(t)) {
        timing.push({
          t,
          set: int(row[3]),
          index: Math.max(0, int(row[4])),
          volume: Math.max(0, Math.min(100, int(row[5], 100))),
        });
      }
    } else if (section === 'HitObjects') {
      objects.push(value.split(','));
    }
  }
  timing.sort((a, b) => a.t - b.t);
  if (objects.length !== map.objects.length || judgement.objects.length !== map.objects.length) {
    throw new Error('Hitsound preparation failed: parsed and prepared hit-object counts disagree');
  }

  const lookupSample = (file: string) => {
    const path = safePath(file);
    if (!path) return null;
    // Beatmap-relative: a map in "folder/diff.osu" looks for "folder/sample.wav".
    const qualified = safePath(directory + path);
    if (!qualified) return null;
    return { path: qualified, bytes: findFile(archive, qualified) };
  };
  const activeSample = (t: number): TimingSample => {
    // Overlapping objects can request sounds out of chronological order.
    // Use a binary search instead of a monotonic cursor into timing sections.
    let low = 0;
    let high = timing.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (timing[mid].t <= t) low = mid + 1;
      else high = mid;
    }
    return low ? timing[low - 1] : { t, set: metadataSet, index: 0, volume: 100 };
  };
  const scheduleFile = (t: number, file: string, volume: number) => {
    const resource = lookupSample(file);
    if (!resource?.bytes) { plan.unavailable++; return; }
    if (!plan.samples.has(resource.path)) plan.samples.set(resource.path, toBuffer(resource.bytes));
    plan.events.push({ t, sample: resource.path, gain: Math.max(0, Math.min(1, volume / 100)) });
  };
  const scheduleHit = (t: number, bits: number, settings: SampleSettings, normalOverride = 0, addOverride = 0) => {
    const tp = activeSample(t);
    const normal = normalOverride || settings.normal || tp.set || metadataSet;
    const addition = addOverride || settings.addition || normal;
    const sampleIndex = settings.index || tp.index;
    const volume = settings.volume || tp.volume;
    if (settings.filename) {
      // A named custom sample entirely replaces the layered hit sound.
      scheduleFile(t, settings.filename, volume);
      return;
    }
    const suffix = sampleIndex > 1 ? String(sampleIndex) : '';
    // osu!stable uses a normal layer by default, even with additions.
    scheduleFile(t, names[normal] + '-hitnormal' + suffix + '.wav', volume);
    for (const [mask, hit] of [[2, 'whistle'], [4, 'finish'], [8, 'clap']] as const) {
      if ((bits & mask) !== 0) scheduleFile(t, names[addition] + '-hit' + hit + suffix + '.wav', volume);
    }
  };

  for (let index = 0; index < objects.length; index++) {
    const row = objects[index];
    const object = map.objects[index];
    const judged = judgement.objects[index];
    const parsedTime = Number(row[2]);
    const type = int(row[3]);
    const kind = type & 2 ? 'slider' : type & 8 ? 'spinner' : 'circle';
    if (!Number.isFinite(parsedTime) || object.kind !== kind || Math.abs(parsedTime - object.start) > 0.001) {
      throw new Error('Hitsound preparation failed: prepared object differs from its .osu definition');
    }
    if (kind === 'spinner') continue;
    const bits = int(row[4]);
    if (kind === 'circle') {
      if (judged.hitTime !== null) scheduleHit(judged.hitTime, bits, sampleSettings(row[5]));
      continue;
    }
    if (object.kind !== 'slider') continue;
    const base = sampleSettings(row[10]);
    const edgeBits = row[8]?.split('|').map((v) => int(v)) ?? [];
    const edgeSets = row[9]?.split('|').map((v) => v.split(':').map((x) => int(x))) ?? [];
    const playEdge = (t: number, edge: number) => {
      const sets = edgeSets[edge] ?? [0, 0];
      scheduleHit(t, edgeBits[edge] ?? bits, base, sets[0], sets[1]);
    };
    if (judged.hitTime !== null) playEdge(judged.hitTime, 0);
    let edge = 1;
    for (let k = 0; k < object.parts.length; k++) {
      if (!judged.parts?.[k]) {
        if (object.parts[k].kind === 'repeat') edge++;
        continue;
      }
      const part = object.parts[k];
      if (part.kind === 'tick') {
        const tp = activeSample(part.t);
        const sample = base.normal || tp.set || metadataSet;
        const suffix = (base.index || tp.index) > 1 ? String(base.index || tp.index) : '';
        scheduleFile(part.t, names[sample] + '-slidertick' + suffix + '.wav', base.volume || tp.volume);
      } else if (part.kind === 'repeat') {
        playEdge(part.t, edge++);
      } else {
        playEdge(part.t, object.spans);
      }
    }
  }
  plan.events.sort((a, b) => a.t - b.t);
  return plan;
}
