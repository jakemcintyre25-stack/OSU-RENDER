import { ScoreDecoder } from 'osu-parsers';

/** One cursor sample. `t` is map time in ms, x/y in osu! pixels, keys = M1|M2|K1|K2|smoke bits. */
export interface ReplayFrame {
  t: number;
  x: number;
  y: number;
  keys: number;
}

export const KEY = { M1: 1, M2: 2, K1: 4, K2: 8, SMOKE: 16 } as const;

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
  mods: string[];
  stats: ReplayHeaderStats | null;
  frames: ReplayFrame[];
  date: Date | null;
}

export async function decodeReplay(data: Uint8Array): Promise<LoadedReplay> {
  const score = await new ScoreDecoder().decodeFromBuffer(data, true);
  const info = score.info;
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
    rawMods: info.rawMods as number,
    mods: modsFromBits(Number(info.rawMods) || 0),
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

/** Drops the RNG-seed frame and stable's off-screen placeholder frames, and sorts by time. */
export function cleanFrames(frames: ReplayFrame[]): ReplayFrame[] {
  return frames
    .filter((f) => Number.isFinite(f.t) && !(f.y === -500 && f.x === 256) && f.t !== -12345)
    .sort((a, b) => a.t - b.t);
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
