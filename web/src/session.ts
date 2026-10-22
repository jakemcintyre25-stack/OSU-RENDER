// Puts the pieces together: archive + replay (or autoplay) → everything the player needs.

import { openOsz, findFile, pickDifficulty, type OszArchive, type Difficulty } from './load/osz';
import { decodeReplay, type LoadedReplay, type ReplayFrame } from './load/replay';
import { prepareMap, type PreparedMap } from './game/prepare';
import { generateAutoplay } from './game/autoplay';
import { judge, type Judgement } from './game/judge';
import { planHitsounds, type HitSoundPlan } from './audio/hitsounds';

export interface Session {
  map: PreparedMap;
  frames: ReplayFrame[];
  judgement: Judgement;
  replay: LoadedReplay | null;
  player: string;
  audio: ArrayBuffer | null;
  hitsounds: HitSoundPlan;
  background: ImageBitmap | null;
  warnings: string[];
}

async function decodeImage(bytes: Uint8Array | null): Promise<ImageBitmap | null> {
  if (!bytes) return null;
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart]));
  } catch {
    return null;
  }
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export async function sessionFromReplay(replayBytes: Uint8Array, osz: OszArchive | null, osuFallback: string | null, beatmapId?: number, skinArchive: OszArchive | null = null): Promise<Session> {
  const replay = await decodeReplay(replayBytes);
  const warnings: string[] = [];
  if (replay.rulesetId !== 0) throw new Error('This replay is not osu!standard — only standard is supported for now');
  let diff: Difficulty | null = null;
  if (osz) {
    // A beatmap ID is not a content identity: maps can be updated while
    // retaining their ID. Never silently judge a replay on different hit objects.
    diff = pickDifficulty(osz, replay.beatmapMD5);
    if (!diff) {
      const sameId = beatmapId ? pickDifficulty(osz, null, beatmapId) : null;
      if (sameId) {
        throw new Error('Beatmap was updated: the downloaded difficulty has the same ID but a different MD5 checksum. Supply the exact .osz revision used by this replay.');
      }
      throw new Error('Beatmap archive does not contain a difficulty matching this replay MD5 checksum. Supply the exact .osz revision.');
    }
  }
  const osuText = diff?.text ?? osuFallback;
  if (!osuText) throw new Error('Could not find the difficulty this replay was played on');
  if (!osz) {
    warnings.push('No beatmap mirror had this map, so there is no music or background.');
    warnings.push('The .osu-only fallback has not been verified against the replay MD5; judgement and timing may differ.');
  }
  const map = prepareMap(osuText, replay.mods);
  const s = await finish(map, replay.frames, osz, replay.player || 'Player', warnings, osuText, diff?.fileName ?? '', skinArchive);
  s.replay = replay;
  return s;
}

export async function sessionFromAutoplay(osz: OszArchive, diff: Difficulty, mods: string[], skinArchive: OszArchive | null = null): Promise<Session> {
  const map = prepareMap(diff.text, mods);
  return finish(map, generateAutoplay(map), osz, 'osu! (autoplay)', [], diff.text, diff.fileName, skinArchive);
}

async function finish(
  map: PreparedMap, frames: ReplayFrame[], osz: OszArchive | null,
  player: string, warnings: string[], osuText: string, beatmapPath: string,
  skinArchive: OszArchive | null,
): Promise<Session> {
  const directory = beatmapPath.replace(/\\/g, '/').replace(/[^/]*$/, '');
  const asset = (name: string | null) => osz && name
    ? findFile(osz, directory + name) ?? findFile(osz, name)
    : null;
  const audioBytes = asset(map.audioFile);
  if (osz && map.audioFile && !audioBytes) warnings.push(`The map's audio file (${map.audioFile}) is missing from the download.`);
  const background = await decodeImage(asset(map.backgroundFile));
  const judgement = judge(map, frames);
  let hitsounds: HitSoundPlan = { events: [], samples: new Map(), unavailable: 0 };
  if (osz || skinArchive) {
    try {
      hitsounds = planHitsounds(osuText, map, judgement, osz, beatmapPath, skinArchive);
    } catch (error) {
      // A sample planner must not make the user's replay inaccessible.
      warnings.push('Beatmap-provided hitsounds could not be mapped safely: ' + (error as Error).message);
    }
  }
  return {
    map, frames, judgement, replay: null, player,
    audio: audioBytes ? toArrayBuffer(audioBytes) : null,
    hitsounds, background, warnings,
  };
}

export { openOsz };
