import type { OszArchive } from '../load/osz';

export const VISUAL_SKIN_KEYS = [
  'hitcircle', 'hitcircleoverlay', 'approachcircle', 'sliderb', 'sliderfollowcircle',
  'cursor', 'cursormiddle', 'cursortrail', 'reversearrow', 'sliderstartcircle',
  'sliderendcircle', 'spinner-background', 'spinner-circle', 'spinner-approachcircle',
] as const;
export type VisualSkinKey = typeof VISUAL_SKIN_KEYS[number];
export type VisualSkinFiles = Partial<Record<VisualSkinKey, Uint8Array>>;

export interface VisualSkinConfig {
  cursorRotate: boolean;
  cursorExpand: boolean;
  cursorCentre: boolean;
  sliderBallFlip: boolean;
  sliderBallFrames: number;
}

const DEFAULT_CONFIG: VisualSkinConfig = {
  cursorRotate: true, cursorExpand: true, cursorCentre: true,
  sliderBallFlip: true, sliderBallFrames: 1,
};

/** Parse only known, bounded [General] skin.ini settings. */
export function visualSkinConfig(skin: OszArchive): VisualSkinConfig {
  const ini = skin.files.get('skin.ini');
  if (!ini || ini.length > 256 * 1024) return { ...DEFAULT_CONFIG };
  const config = { ...DEFAULT_CONFIG };
  const lines = new TextDecoder('utf-8').decode(ini).replace(/^\uFEFF/, '').split(/\r?\n/);
  let general = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      general = trimmed.toLowerCase() === '[general]';
      continue;
    }
    if (!general || !trimmed || trimmed.startsWith('//') || trimmed.startsWith(';')) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).split('//')[0].trim();
    const boolean = /^(true|1)$/i.test(value) ? true : /^(false|0)$/i.test(value) ? false : null;
    if (key === 'cursorrotate' && boolean !== null) config.cursorRotate = boolean;
    if (key === 'cursorexpand' && boolean !== null) config.cursorExpand = boolean;
    if (key === 'cursorcentre' && boolean !== null) config.cursorCentre = boolean;
    if (key === 'sliderballflip' && boolean !== null) config.sliderBallFlip = boolean;
    if (key === 'sliderballframes' && /^\d+$/.test(value)) {
      const n = Number(value);
      if (n >= 1 && n <= 128) config.sliderBallFrames = n;
    }
  }
  return config;
}


/** Resolve supported .osk root sprites. @2x assets take priority over 1x.
 * No nested files, arbitrary paths, SVG, or untrusted skin.ini references.
 */
export function visualSkinFiles(skin: OszArchive): VisualSkinFiles {
  const found: VisualSkinFiles = {};
  for (const key of VISUAL_SKIN_KEYS) {
    const hi = skin.files.get(`${key}@2x.png`);
    const lo = skin.files.get(`${key}.png`);
    if (hi?.length) found[key] = hi;
    else if (lo?.length) found[key] = lo;
  }
  return found;
}

export async function decodeVisualSkin(
  skin: OszArchive,
  decode: (bytes: Uint8Array) => Promise<ImageBitmap | HTMLImageElement>,
): Promise<Partial<Record<VisualSkinKey, ImageBitmap | HTMLImageElement>>> {
  const result: Partial<Record<VisualSkinKey, ImageBitmap | HTMLImageElement>> = {};
  for (const [key, bytes] of Object.entries(visualSkinFiles(skin))) {
    try {
      result[key as VisualSkinKey] = await decode(bytes);
    } catch {
      // Corrupt or unsupported sprites must not break replay playback.
    }
  }
  return result;
}
