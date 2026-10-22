import { describe, expect, it } from 'vitest';
import { validateMirrorZip } from '../src/zip-envelope';
import { storedZip } from './zip-fixture';

const centralOffset = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(bytes.length - 22 + 16, true);

describe('mirror ZIP envelope robustness without decompression', () => {
  it('accepts a real stored ZIP and a ZIP with a declared trailing comment', () => {
    expect(() => validateMirrorZip(storedZip())).not.toThrow();
    const ordinary = storedZip();
    const commented = new Uint8Array(ordinary.length + 3);
    commented.set(ordinary);
    commented.set([0x62, 0x79, 0x65], ordinary.length);
    new DataView(commented.buffer).setUint16(ordinary.length - 22 + 20, 3, true);
    expect(() => validateMirrorZip(commented)).not.toThrow();
  });

  it('rejects an otherwise valid ZIP with no .osu beatmap difficulty', () => {
    expect(() => validateMirrorZip(storedZip(undefined, 'cover.jpg')))
      .toThrow(/missing .*osu|no .*osu/i);
  });

  it('rejects only the ZIP signature without a central directory', () => {
    expect(() => validateMirrorZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04])))
      .toThrow(/Invalid ZIP/);
  });

  it('rejects malformed central entry method and forged inflated size', () => {
    const badMethod = storedZip();
    new DataView(badMethod.buffer).setUint16(centralOffset(badMethod) + 10, 99, true);
    expect(() => validateMirrorZip(badMethod)).toThrow(/unsupported compression/);

    const inflated = storedZip();
    new DataView(inflated.buffer).setUint32(centralOffset(inflated) + 24, 1_000_000, true);
    expect(() => validateMirrorZip(inflated)).toThrow(/compression ratio/);
  });

  it('rejects traversal paths even if local and central filenames agree', () => {
    const path = storedZip();
    path[30] = 47; // a leading slash, no extra entry or filename mismatch
    path[centralOffset(path) + 46] = 47;
    expect(() => validateMirrorZip(path)).toThrow(/unsafe/);
  });

  it('rejects invalid UTF-8 filename bytes', () => {
    const path = storedZip();
    path[30] = 0xff;
    path[centralOffset(path) + 46] = 0xff;
    expect(() => validateMirrorZip(path)).toThrow(/invalid UTF-8/);
  });

  it('rejects entries pointing past the end of their local file data', () => {
    const invalid = storedZip();
    const central = centralOffset(invalid);
    new DataView(invalid.buffer).setUint32(central + 42, central - 2, true);
    expect(() => validateMirrorZip(invalid)).toThrow(/missing local header/);
  });
});
