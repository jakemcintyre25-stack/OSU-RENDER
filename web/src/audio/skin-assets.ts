import type { OszArchive } from '../load/osz';

/** Supported root-level audio resources from a user-selected .osk.
 * Visual sprites, skin.ini file references and nested skin folders are not
 * part of the current M7 subset.
 */
export function supportedSkinAudioFiles(skin: OszArchive): string[] {
  return [...skin.files.keys()].filter(name =>
    /^(?:normal|soft|drum)-(?:hit(?:normal|whistle|finish|clap)|sliderslide|sliderwhistle)(?:[0-9]+)?\.(?:wav|mp3|ogg)$/i.test(name));
}
