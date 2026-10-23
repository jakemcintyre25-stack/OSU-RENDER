import { OSZ_LIMITS } from './archive-guard';
import { REPLAY_LIMITS } from './replay';

export type LocalUploadKind = 'osr' | 'osz' | 'osk';

/**
 * Check browser File.size before File.arrayBuffer() allocates a second copy.
 * ZIP content has additional per-entry checks in the archive loader.
 */
export function assertLocalUploadSize(kind: LocalUploadKind, size: number): void {
  const limit = kind === 'osr' ? REPLAY_LIMITS.compressedBytes : OSZ_LIMITS.compressedBytes;
  if (!Number.isSafeInteger(size) || size <= 0 || size > limit) {
    throw new Error('Invalid .' + kind + ' upload: file size outside supported limits (' +
      Math.floor(limit / (1024 * 1024)) + ' MiB max).');
  }
}
