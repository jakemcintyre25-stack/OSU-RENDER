// osu!standard beatmap-provided hitsound planning (M5/M7 partial).
// Reads .osu hit sample metadata and plays actual archive samples; missing
// map samples can fall back to real files in a user-supplied .osk skin.
// No default skin assets are fabricated or bundled.
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
  /** Stable positional pan, -0.4 (left) .. 0.4 (right); omitted at centre. */
  pan?: number;
}
export interface HitSoundLoop {
  start: number;
  end: number;
  sample: string;
  gain: number;
  pan?: number;
}
export interface HitSoundPlan {
  events: HitSoundEvent[];
  /** Genuine looping slider audio, restricted to observed tracking ranges. */
  loops?: HitSoundLoop[];
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
const MAX_SAMPLE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_SAMPLES_BYTES = 64 * 1024 * 1024;
const MAX_UNIQUE_SAMPLES = 256;
const MAX_HITSOUND_EVENTS = 50_000;

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
/** osu!stable positional pan: (x / 512 - 0.5) * 0.8, i.e. -0.4..0.4. */
const panForX = (x: number) => Math.max(-0.4, Math.min(0.4, (x / 512 - 0.5) * 0.8));
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
 * ticks and spinner end hits. Spinner spin/bonus, skin default samples and continuous slider
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
  skinArchive: OszArchive | null = null,
): HitSoundPlan {
  const plan: HitSoundPlan = { events: [], loops: [], samples: new Map(), unavailable: 0 };
  if (!archive && !skinArchive) return plan;
  const skinIni = skinArchive?.files.get('skin.ini');
  const ini = skinIni ? new TextDecoder().decode(skinIni) : '';
  // The osu! default skin configuration layers hitnormal onto additions.
  const layeredHitSounds = !/^\s*LayeredHitSounds\s*:\s*(?:0|false)\s*$/im.test(ini);
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

  const lookupSample = (file: string, allowSkin: boolean) => {
    const path = safePath(file);
    if (!path) return null;
    // Beatmap-relative: a map in "folder/diff.osu" looks for "folder/sample.wav".
    const qualified = safePath(directory + path);
    if (!qualified) return null;
    // Automatically generated chart sample names can be .wav, .mp3 or .ogg.
    // Prefer every chart-provided encoding before falling back to a user skin.
    // Explicitly named custom samples must match the filename verbatim.
    const formats = allowSkin && /\.(?:wav|mp3|ogg)$/i.test(qualified)
      ? ['wav', 'mp3', 'ogg'] : [];
    const beatmapNames = [qualified, ...formats.map((ext) =>
      qualified.replace(/\.(?:wav|mp3|ogg)$/i, '.' + ext))];
    for (const name of new Set(beatmapNames)) {
      const bytes = archive ? findFile(archive, name) : null;
      if (bytes) return { path: name, bytes };
    }
    if (!allowSkin || !skinArchive) return null;

    // A user's skin provides unindexed samples, regardless of the chart's
    // index. osu! skins may use WAV or other browser-decodable audio formats.
    // Explicit hitSample filenames never fall back to skin names.
    const base = path.replace(/\\/g, '/').split('/').at(-1)!;
    const stem = base.replace(/\d+(?=\.(?:wav|mp3|ogg)$)/i, '').replace(/\.(?:wav|mp3|ogg)$/i, '');
    for (const extension of ['wav', 'mp3', 'ogg']) {
      const name = stem + '.' + extension;
      const bytes = findFile(skinArchive, name);
      if (bytes) return { path: 'skin:' + name, bytes };
    }
    return null;
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
  let totalSamplesBytes = 0;
  const reserve = (file: string, allowSkin: boolean) => {
    const resource = lookupSample(file, allowSkin);
    if (!resource?.bytes || resource.bytes.byteLength > MAX_SAMPLE_FILE_BYTES) {
      plan.unavailable++;
      return null;
    }
    if (!plan.samples.has(resource.path)) {
      if (plan.samples.size >= MAX_UNIQUE_SAMPLES ||
          totalSamplesBytes + resource.bytes.byteLength > MAX_TOTAL_SAMPLES_BYTES) {
        plan.unavailable++;
        return null;
      }
      plan.samples.set(resource.path, toBuffer(resource.bytes));
      totalSamplesBytes += resource.bytes.byteLength;
    }
    return resource.path;
  };
  const clampPan = (pan: number) => Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
  const scheduleFile = (t: number, file: string, volume: number, allowSkin = true, pan = 0) => {
    if (plan.events.length >= MAX_HITSOUND_EVENTS) { plan.unavailable++; return; }
    const path = reserve(file, allowSkin);
    if (!path) return;
    const event: HitSoundEvent = { t, sample: path, gain: Math.max(0, Math.min(1, volume / 100)) };
    const value = clampPan(pan);
    if (Math.abs(value) > 1e-6) event.pan = value;
    plan.events.push(event);
  };
  const scheduleLoop = (start: number, end: number, file: string, volume: number, pan = 0) => {
    if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) return;
    if ((plan.loops?.length ?? 0) >= MAX_HITSOUND_EVENTS) return;
    const path = reserve(file, true);
    if (!path) return;
    const loop: HitSoundLoop = { start, end, sample: path, gain: Math.max(0, Math.min(1, volume / 100)) };
    const value = clampPan(pan);
    if (Math.abs(value) > 1e-6) loop.pan = value;
    plan.loops!.push(loop);
  };
  const scheduleHit = (
    t: number, bits: number, settings: SampleSettings,
    normalOverride = 0, addOverride = 0, metadataTime = t, pan = 0,
  ) => {
    // The sample is defined by the hit object's timing section; its playback
    // occurs at the actual successful press timestamp (which may be early).
    const tp = activeSample(metadataTime);
    const normalChoice = normalOverride || settings.normal || tp.set || metadataSet;
    const normal = names[normalChoice] ? normalChoice : metadataSet;
    const addChoice = addOverride || settings.addition || normal;
    const addition = names[addChoice] ? addChoice : normal;
    const sampleIndex = settings.index || tp.index;
    const volume = settings.volume || tp.volume;
    if (settings.filename) {
      // A named custom sample entirely replaces the layered hit sound.
      scheduleFile(t, settings.filename, volume, false, pan);
      return;
    }
    const suffix = sampleIndex > 1 ? String(sampleIndex) : '';
    // LayeredHitSounds defaults to true. When a user skin disables it,
    // don't force normal onto a note with only whistle/finish/clap additions.
    // A bare hitSound=0 must still play the default normal sample.
    if (layeredHitSounds || (bits & 1) !== 0 || (bits & 14) === 0) {
      scheduleFile(t, names[normal] + '-hitnormal' + suffix + '.wav', volume, true, pan);
    }
    for (const [mask, hit] of [[2, 'whistle'], [4, 'finish'], [8, 'clap']] as const) {
      if ((bits & mask) !== 0) scheduleFile(t, names[addition] + '-hit' + hit + suffix + '.wav', volume, true, pan);
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
    const bits = int(row[4]);
    if (kind === 'spinner') {
      const settings = sampleSettings(row[6]);
      const volume = settings.volume || activeSample(object.start).volume;
      // Spinning sound is a skin loop, independent of whether the spinner is
      // eventually completed. Use the judge's real first/last half-spin
      // timestamps instead of spreading ticks uniformly over the spinner.
      if (judged.spinnerSpinRange) {
        // Missing optional spinner samples must not inflate the unavailable
        // count for every bonus tick; check once before scheduling.
        if (lookupSample('spinnerspin.wav', true)) {
          scheduleLoop(judged.spinnerSpinRange[0], judged.spinnerSpinRange[1], 'spinnerspin.wav', volume);
        }
        const bonuses = judged.spinnerBonusTicks ?? [];
        if (bonuses.length && lookupSample('spinnerbonus.wav', true)) {
          for (const t of bonuses) scheduleFile(t, 'spinnerbonus.wav', volume);
        }
      }
      // osu!stable allows a spinner to carry a normal + addition hitsound
      // at its end. Do not sound an unsuccessful spinner completion.
      if (judged.result > 0) scheduleHit(object.end, bits, settings);
      continue;
    }
    if (kind === 'circle') {
      if (judged.hitTime !== null) {
        scheduleHit(judged.hitTime, bits, sampleSettings(row[5]), 0, 0, object.start, panForX(object.x));
      }
      continue;
    }
    if (object.kind !== 'slider') continue;
    const base = sampleSettings(row[10]);
    const edgeBits = row[8]?.split('|').map((v) => int(v)) ?? [];
    const edgeSets = row[9]?.split('|').map((v) => v.split(':').map((x) => int(x))) ?? [];
    const playEdge = (t: number, edge: number, metadataTime = t, x = object.x) => {
      const sets = edgeSets[edge] ?? [0, 0];
      scheduleHit(t, edgeBits[edge] ?? bits, base, sets[0], sets[1], metadataTime, panForX(x));
    };
    if (judged.hitTime !== null) playEdge(judged.hitTime, 0, object.start, object.x);
    // Follow the judge's actual tracking windows, not the slider's full span.
    // The clip must be supplied by the map or selected .osk; no synthesized
    // substitute is created when sliderslide/sliderwhistle is missing.
    for (const [start, end] of judged.tracking ?? []) {
      const from = Math.max(start, object.start);
      const to = Math.min(end, object.end);
      if (to <= from) continue;
      const tp = activeSample(from);
      const choice = base.normal || tp.set || metadataSet;
      const set = names[choice] ? choice : metadataSet;
      const suffix = (base.index || tp.index) > 1 ? String(base.index || tp.index) : '';
      const volume = base.volume || tp.volume;
      scheduleLoop(from, to, names[set] + '-sliderslide' + suffix + '.wav', volume);
      if ((bits & 2) !== 0) scheduleLoop(from, to, names[set] + '-sliderwhistle' + suffix + '.wav', volume);
    }
    let edge = 1;
    for (let k = 0; k < object.parts.length; k++) {
      if (!judged.parts?.[k]) {
        if (object.parts[k].kind === 'repeat') edge++;
        continue;
      }
      const part = object.parts[k];
      if (part.kind === 'tick') {
        const tp = activeSample(part.t);
        const choice = base.normal || tp.set || metadataSet;
        const sample = names[choice] ? choice : metadataSet;
        const suffix = (base.index || tp.index) > 1 ? String(base.index || tp.index) : '';
        scheduleFile(part.t, names[sample] + '-slidertick' + suffix + '.wav', base.volume || tp.volume, true, panForX(part.x));
      } else if (part.kind === 'repeat') {
        playEdge(part.t, edge++, part.t, part.x);
      } else {
        // Stable judges the slider tail a little early for leniency, while
        // the physical tail hitsound is an edge at the slider's actual end.
        playEdge(object.end, object.spans, object.end, object.pointAt(1).x);
      }
    }
  }
  plan.events.sort((a, b) => a.t - b.t);
  plan.loops?.sort((a, b) => a.start - b.start);
  return plan;
}
