import type { OszArchive } from '../load/osz';

export const VISUAL_SKIN_KEYS = [
  'hitcircle', 'hitcircleoverlay', 'approachcircle', 'sliderb', 'sliderfollowcircle',
  'cursor', 'cursormiddle', 'cursortrail', 'reversearrow', 'sliderstartcircle',
  'sliderendcircle', 'spinner-background', 'spinner-circle', 'spinner-approachcircle',
] as const;
export type VisualSkinKey = typeof VISUAL_SKIN_KEYS[number];
export type VisualSkinFiles = Partial<Record<VisualSkinKey, Uint8Array>>;

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
