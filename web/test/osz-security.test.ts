import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectOszArchive, OSZ_LIMITS } from '../src/load/archive-guard';
import { findFile, openOsz, pickDifficulty } from '../src/load/osz';

const osu = strToU8(`osu file format v14
[General]
Mode: 0
[Metadata]
Version: Insane
BeatmapID: 1234
[HitObjects]
100,100,1000,1,0,0:0:0:0:
`);

const archive = (entries: Record<string, Uint8Array>) => zipSync(entries);
const inspect = (bytes: Uint8Array) => inspectOszArchive(bytes);

function centralOffset(bytes: Uint8Array): number {
  const eocd = bytes.length - 22;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  return v.getUint32(eocd + 16, true);
}

describe('untrusted .osz archive guard and integration', () => {
  it('accepts a valid ZIP, keeps exact beatmap hashes and case-insensitive assets', () => {
    const bytes = archive({
      'folder/Map.osu': osu,
      'folder/Audio.MP3': new Uint8Array([1, 2, 3]),
    });
    const entries = inspect(bytes);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, e) => sum + e.inflatedBytes, 0)).toBe(osu.length + 3);
    const parsed = openOsz(bytes);
    expect(parsed.difficulties).toHaveLength(1);
    expect(parsed.difficulties[0].beatmapId).toBe(1234);
    expect(pickDifficulty(parsed, parsed.difficulties[0].md5.toUpperCase()))
      .toBe(parsed.difficulties[0]);
    expect([...findFile(parsed, 'FOLDER\\AUDIO.MP3')!]).toEqual([1, 2, 3]);
  });

  it('accepts UTF-8 filenames and well-formed directory entries', () => {
    const bytes = archive({ '曲/': new Uint8Array(), '曲/譜面.osu': osu });
    expect(openOsz(bytes).difficulties[0].fileName).toBe('曲/譜面.osu');
  });

  it('rejects traversal, absolute paths, drive paths and normalization collisions', () => {
    for (const name of ['../evil.osu', '/absolute.osu', 'C:/drive.osu', 'a/../evil.osu', 'a//b.osu']) {
      expect(() => openOsz(archive({ [name]: osu })), name).toThrow(/unsafe entry path/);
    }
    expect(() => openOsz(archive({ 'A.osu': osu, 'a.osu': osu })))
      .toThrow(/duplicate case-insensitive entry/);
  });

  it('rejects a highly compressible ZIP bomb before inflation', () => {
    const bomb = archive({ 'bomb.bin': new Uint8Array(750_000) });
    expect(bomb.byteLength).toBeLessThan(10000);
    expect(() => openOsz(bomb)).toThrow(/excessive compression ratio/);
  });

  it('rejects a forged inflated-size field above the single-entry cap', () => {
    const bytes = archive({ 'beatmap.osu': osu });
    const pos = centralOffset(bytes);
    new DataView(bytes.buffer).setUint32(pos + 24, OSZ_LIMITS.entryBytes + 1, true);
    expect(() => openOsz(bytes)).toThrow(/entry exceeds individual/);
  });

  it('rejects encrypted or inconsistent local and central entry headers', () => {
    const encrypted = archive({ 'beatmap.osu': osu });
    const pos = centralOffset(encrypted);
    const view = new DataView(encrypted.buffer);
    view.setUint16(pos + 8, view.getUint16(pos + 8, true) | 1, true);
    expect(() => openOsz(encrypted)).toThrow(/encrypted/);

    const renamed = archive({ 'a.osu': osu });
    renamed[centralOffset(renamed) + 46] = 'b'.charCodeAt(0);
    expect(() => openOsz(renamed)).toThrow(/local and central names differ/);
  });

  it('rejects a corrupt or truncated end-of-central-directory record', () => {
    expect(() => inspect(new Uint8Array([1, 2, 3]))).toThrow(/missing ZIP end record/);
    const bytes = archive({ 'beatmap.osu': osu });
    expect(() => inspect(bytes.subarray(0, bytes.length - 2))).toThrow(/missing ZIP end record/);
  });

  it('rejects an archive whose declared CRC32 does not match extracted bytes', () => {
    const bytes = archive({ 'map.osu': osu });
    const pos = centralOffset(bytes);
    const view = new DataView(bytes.buffer);
    view.setUint32(pos + 16, view.getUint32(pos + 16, true) ^ 0xffffffff, true);
    expect(() => openOsz(bytes)).toThrow(/CRC32 mismatch/);
  });

  it('detects a changed stored file even when its ZIP lengths still match', () => {
    const bytes = zipSync({ 'map.osu': [osu, { level: 0 }] });
    const view = new DataView(bytes.buffer);
    const localLength = view.getUint16(26, true);
    const localExtra = view.getUint16(28, true);
    const payload = 30 + localLength + localExtra;
    bytes[payload + 1] ^= 0x10;
    expect(() => openOsz(bytes)).toThrow(/CRC32 mismatch/);
  });

  it('rejects unsupported compression and inconsistent stored sizes', () => {
    const bytes = archive({ 'a.osu': osu });
    const pos = centralOffset(bytes);
    const view = new DataView(bytes.buffer);
    view.setUint16(pos + 10, 99, true);
    expect(() => inspect(bytes)).toThrow(/unsupported compression/);

    const stored = zipSync({ 'raw.bin': [new Uint8Array([1, 2, 3]), { level: 0 }] });
    const at = centralOffset(stored);
    new DataView(stored.buffer).setUint32(at + 20, 2, true);
    expect(() => inspect(stored)).toThrow(/stored entry declares inconsistent size/);
  });
});
