import type { OszArchive } from '../load/osz';

export const VISUAL_SKIN_KEYS = [
  'hitcircle', 'hitcircleoverlay', 'approachcircle', 'sliderb', 'sliderfollowcircle',
  'cursor', 'cursormiddle', 'cursortrail', 'reversearrow', 'sliderstartcircle',
  'sliderstartcircleoverlay', 'sliderendcircle', 'sliderendcircleoverlay',
  'spinner-background', 'spinner-circle', 'spinner-approachcircle',
] as const;
export type VisualSkinKey = typeof VISUAL_SKIN_KEYS[number] | `sliderb${number}`;
export type VisualSkinFiles = Partial<Record<VisualSkinKey, Uint8Array>>;

export interface VisualSkinConfig {
  cursorRotate: boolean;
  cursorExpand: boolean;
  cursorCentre: boolean;
  sliderBallFlip: boolean;
  sliderBallFrames: number;
  /** 128 px skin cursor scaling; 1 is the osu! default. */
  cursorScale: number;
  /** [Colours] Combo1..Combo8 overrides, empty when the skin has none. */
  comboColors: number[];
  sliderBorder: number | null;
  sliderTrackOverride: number | null;
  spinnerBackground: number | null;
}

export const DEFAULT_VISUAL_SKIN_CONFIG: VisualSkinConfig = {
  cursorRotate: true, cursorExpand: true, cursorCentre: true,
  sliderBallFlip: true, sliderBallFrames: 1, cursorScale: 1,
  comboColors: [], sliderBorder: null, sliderTrackOverride: null, spinnerBackground: null,
};

function rgb(value: string): number | null {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (parts[0] << 16) | (parts[1] << 8) | parts[2];
}

/** Parse only known, bounded [General] and [Colours] skin.ini settings. */
export function visualSkinConfig(skin: OszArchive): VisualSkinConfig {
  const ini = skin.files.get('skin.ini');
  if (!ini || ini.length > 256 * 1024) return { ...DEFAULT_VISUAL_SKIN_CONFIG, comboColors: [] };
  const config: VisualSkinConfig = { ...DEFAULT_VISUAL_SKIN_CONFIG, comboColors: [] };
  const lines = new TextDecoder('utf-8').decode(ini).replace(/^\uFEFF/, '').split(/\r?\n/);
  let section = '';
  const combos = new Map<number, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim().toLowerCase();
      continue;
    }
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith(';')) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).split('//')[0].trim();
    if (section === 'general') {
      const boolean = /^(true|1)$/i.test(value) ? true : /^(false|0)$/i.test(value) ? false : null;
      if (key === 'cursorrotate' && boolean !== null) config.cursorRotate = boolean;
      if (key === 'cursorexpand' && boolean !== null) config.cursorExpand = boolean;
      if (key === 'cursorcentre' && boolean !== null) config.cursorCentre = boolean;
      if (key === 'sliderballflip' && boolean !== null) config.sliderBallFlip = boolean;
      if (key === 'sliderballframes' && /^\d+$/.test(value)) {
        const n = Number(value);
        if (n >= 1 && n <= 128) config.sliderBallFrames = n;
      }
      if (key === 'cursorscale' && /^\d+(?:\.\d+)?$/.test(value)) {
        const n = Number(value);
        if (n >= 0.1 && n <= 3) config.cursorScale = n;
      }
    } else if (section === 'colours') {
      const combo = /^combo([1-8])$/.exec(key);
      if (combo) {
        const color = rgb(value);
        if (color !== null) combos.set(Number(combo[1]), color);
      } else if (key === 'sliderborder') {
        config.sliderBorder = rgb(value);
      } else if (key === 'slidertrackoverride') {
        config.sliderTrackOverride = rgb(value);
      } else if (key === 'spinnerbackground') {
        config.spinnerBackground = rgb(value);
      }
    }
  }
  config.comboColors = [...combos.entries()].sort((a, b) => a[0] - b[0]).map(([, color]) => color);
  return config;
}

/** Pick a [Colours] override for an object while preserving the map's combo cycle. */
export function skinComboColor(mapColors: number[], mapColor: number, skinColors: number[]): number {
  if (!skinColors.length) return mapColor;
  const index = mapColors.indexOf(mapColor);
  return skinColors[(index < 0 ? 0 : index) % skinColors.length];
}


/** Resolve supported .osk root sprites. @2x assets take priority over 1x.
 * No nested files, arbitrary paths, SVG, or untrusted skin.ini references.
 */
export function visualSkinFiles(skin: OszArchive, sliderBallFrames = 0): VisualSkinFiles {
  const found: VisualSkinFiles = {};
  for (const key of VISUAL_SKIN_KEYS) {
    const hi = skin.files.get(`${key}@2x.png`);
    const lo = skin.files.get(`${key}.png`);
    if (hi?.length) found[key] = hi;
    else if (lo?.length) found[key] = lo;
  }
  const frameCount = Math.max(0, Math.min(128, Math.floor(sliderBallFrames)));
  for (let i = 0; i < frameCount; i++) {
    const hi = skin.files.get(`sliderb${i}@2x.png`);
    const lo = skin.files.get(`sliderb${i}.png`);
    if (hi?.length) found[`sliderb${i}`] = hi;
    else if (lo?.length) found[`sliderb${i}`] = lo;
  }
  return found;
}

/** Deterministic slider-ball animation frame at map time t. */
export function sliderBallFrame(t: number, frameCount: number, frameMs = 1000 / 60): number {
  if (!Number.isFinite(t) || !Number.isInteger(frameCount) || frameCount < 1 || !(frameMs > 0)) return 0;
  return ((Math.floor(t / frameMs) % frameCount) + frameCount) % frameCount;
}

export async function decodeVisualSkin(
  skin: OszArchive,
  decode: (bytes: Uint8Array) => Promise<ImageBitmap | HTMLImageElement>,
): Promise<Partial<Record<VisualSkinKey, ImageBitmap | HTMLImageElement>>> {
  const result: Partial<Record<VisualSkinKey, ImageBitmap | HTMLImageElement>> = {};
  const config = visualSkinConfig(skin);
  for (const [key, bytes] of Object.entries(visualSkinFiles(skin, config.sliderBallFrames))) {
    if (!bytes) continue;
    try {
      result[key as VisualSkinKey] = await decode(bytes);
    } catch {
      // Corrupt or unsupported sprites must not break replay playback.
    }
  }
  return result;
}
