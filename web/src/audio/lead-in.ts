/** osu! AudioLeadIn: silence before the music timeline begins, in map ms.
 * This is an operational bound for untrusted input, not a format definition.
 */
export const MAX_AUDIO_LEAD_IN_MS = 10 * 60 * 1000;

export function parseAudioLeadIn(osuText: string): number {
  let section = '';
  for (const line of osuText.replace(/\r/g, '').replace(/^\uFEFF/, '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).toLowerCase();
      continue;
    }
    if (section !== 'general') continue;
    const match = /^AudioLeadIn\s*:\s*(.*?)\s*$/i.exec(trimmed);
    if (!match) continue;
    if (!/^\d+$/.test(match[1])) throw new Error('Invalid osu! AudioLeadIn value');
    const ms = Number(match[1]);
    if (!Number.isSafeInteger(ms) || ms > MAX_AUDIO_LEAD_IN_MS) {
      throw new Error('AudioLeadIn exceeds the supported safe range');
    }
    return ms;
  }
  return 0;
}

/** Preserve the existing 1.5s approach lead-in, but never skip explicit
 * AudioLeadIn silence requested by the beatmap.
 */
export function initialPlaybackTime(firstObjectTime: number, audioLeadIn: number): number {
  if (!Number.isFinite(firstObjectTime) || !Number.isFinite(audioLeadIn) ||
      audioLeadIn < 0 || audioLeadIn > MAX_AUDIO_LEAD_IN_MS)
    throw new Error('Invalid playback lead-in');
  const start = Math.min(0, firstObjectTime - 1500, -audioLeadIn);
  return start === 0 ? 0 : start;
}
