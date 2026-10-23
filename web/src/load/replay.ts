import { ScoreDecoder } from 'osu-parsers';

/** One cursor sample. `t` is map time in ms, x/y in osu! pixels, keys = M1|M2|K1|K2|smoke bits. */
export interface ReplayFrame {
  t: number;
  x: number;
  y: number;
  keys: number;
}

export const KEY = { M1: 1, M2: 2, K1: 4, K2: 8, SMOKE: 16 } as const;

/** Operational input safety ceilings; not official osu! format limits. */
export const REPLAY_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  frames: 1_000_000,
  timeAbsMs: 1_000_000_000,
  positionAbs: 100_000,
  maxKeyMask: 65535,
});

export interface ReplayHeaderStats {
  count300: number;
  count100: number;
  count50: number;
  countMiss: number;
  maxCombo: number;
  totalScore: number;
}

export interface LoadedReplay {
  player: string;
  rulesetId: number;
  beatmapMD5: string;
  rawMods: number;
  /** The replay's stored total is ScoreV2, not ScoreV1. */
  scoreV2: boolean;
  mods: string[];
  stats: ReplayHeaderStats | null;
  frames: ReplayFrame[];
  date: Date | null;
}

/** Stable's ScoreV2 mod bit. ScoreV2 totals are not comparable with ScoreV1. */
export const SCORE_V2_MOD_BIT = 1 << 29;

export function isScoreV2Mods(rawMods: number): boolean {
  return (rawMods & SCORE_V2_MOD_BIT) !== 0;
}

export async function decodeReplay(data: Uint8Array): Promise<LoadedReplay> {
  if (data.byteLength === 0 || data.byteLength > REPLAY_LIMITS.compressedBytes) {
    throw new Error('Invalid replay: .osr file size outside safe limits');
  }
  const score = await new ScoreDecoder().decodeFromBuffer(data, true);
  const info = score.info;
  const rawMods = Number(info.rawMods) || 0;
  const frames = cleanFrames(
    (score.replay?.frames ?? []).map((f) => {
      const lf = f as unknown as { startTime: number; position: { x: number; y: number }; buttonState?: number };
      return { t: lf.startTime, x: lf.position.x, y: lf.position.y, keys: lf.buttonState ?? 0 };
    }),
  );
  return {
    player: info.username ?? '',
    rulesetId: info.rulesetId ?? 0,
    beatmapMD5: (info.beatmapHashMD5 ?? '').toLowerCase(),
    rawMods,
    scoreV2: isScoreV2Mods(rawMods),
    mods: modsFromBits(rawMods),
    stats: {
      count300: info.count300,
      count100: info.count100,
      count50: info.count50,
      countMiss: info.countMiss,
      maxCombo: info.maxCombo,
      totalScore: info.totalScore,
    },
    frames,
    date: info.date instanceof Date ? info.date : null,
  };
}

/** Drop known osu!stable placeholders; reject malformed gameplay data, then sort. */
export function cleanFrames(frames: ReplayFrame[]): ReplayFrame[] {
  // Limit before copying or sorting to protect against decompression expansion.
  if (frames.length > REPLAY_LIMITS.frames) {
    throw new Error('Invalid replay: too many replay frames');
  }
  const valid: ReplayFrame[] = [];
  for (const frame of frames) {
    // Replay seed and legacy off-screen sentinel are not cursor samples.
    if (frame && ((frame.y === -500 && frame.x === 256) || frame.t === -12345)) continue;
    if (!frame || !Number.isFinite(frame.t) ||
        !Number.isFinite(frame.x) || !Number.isFinite(frame.y) ||
        Math.abs(frame.t) > REPLAY_LIMITS.timeAbsMs ||
        Math.abs(frame.x) > REPLAY_LIMITS.positionAbs ||
        Math.abs(frame.y) > REPLAY_LIMITS.positionAbs ||
        !Number.isInteger(frame.keys) || frame.keys < 0 || frame.keys > REPLAY_LIMITS.maxKeyMask) {
      throw new Error('Invalid replay: non-finite or out-of-range frame data');
    }
    valid.push(frame);
  }
  return valid.sort((a, b) => a.t - b.t);
}

const MOD_BITS: [number, string][] = [
  [1, 'NF'], [2, 'EZ'], [4, 'TD'], [8, 'HD'], [16, 'HR'], [32, 'SD'], [64, 'DT'], [128, 'RX'], [256, 'HT'],
  [512, 'NC'], [1024, 'FL'], [2048, 'AT'], [4096, 'SO'], [8192, 'AP'], [16384, 'PF'],
];

export function modsFromBits(bits: number): string[] {
  const out: string[] = [];
  for (const [bit, name] of MOD_BITS) if (bits & bit) out.push(name);
  // NC implies DT and PF implies SD in the bitfield — show only the stronger one.
  return out.filter((m) => !(m === 'DT' && out.includes('NC')) && !(m === 'SD' && out.includes('PF')));
}

/** Cursor position at time t, linearly interpolated between frames for smooth drawing. */
export function cursorAt(frames: ReplayFrame[], t: number, hint = 0): { x: number; y: number; keys: number; index: number } {
  if (frames.length === 0) return { x: 256, y: 192, keys: 0, index: 0 };
  let i = Math.min(Math.max(hint, 0), frames.length - 1);
  while (i > 0 && frames[i].t > t) i--;
  while (i < frames.length - 1 && frames[i + 1].t <= t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  if (!b || t <= a.t) return { x: a.x, y: a.y, keys: t < a.t ? 0 : a.keys, index: i };
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, keys: a.keys, index: i };
}
