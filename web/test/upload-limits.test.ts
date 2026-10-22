import { describe, expect, it } from 'vitest';
import { assertLocalUploadSize } from '../src/load/upload-limits';
import { OSZ_LIMITS } from '../src/load/archive-guard';
import { REPLAY_LIMITS } from '../src/load/replay';

describe('untrusted local file preflight', () => {
  it('accepts normal files and exact maximum sizes', () => {
    expect(() => assertLocalUploadSize('osr', 1024)).not.toThrow();
    expect(() => assertLocalUploadSize('osr', REPLAY_LIMITS.compressedBytes)).not.toThrow();
    expect(() => assertLocalUploadSize('osz', OSZ_LIMITS.compressedBytes)).not.toThrow();
    expect(() => assertLocalUploadSize('osk', OSZ_LIMITS.compressedBytes)).not.toThrow();
  });
  it('rejects oversized .osr before allocating an ArrayBuffer', () => {
    expect(() => assertLocalUploadSize('osr', REPLAY_LIMITS.compressedBytes + 1))
      .toThrow(/Invalid .osr upload/);
  });
  it('rejects oversized map and skin archives before ZIP inflation', () => {
    for (const kind of ['osz', 'osk'] as const) {
      expect(() => assertLocalUploadSize(kind, OSZ_LIMITS.compressedBytes + 1))
        .toThrow(/file size outside supported limits/);
    }
  });
  it('rejects zero, invalid, fractional or nonfinite file sizes', () => {
    for (const size of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => assertLocalUploadSize('osk', size)).toThrow(/Invalid .osk upload/);
    }
  });
});
