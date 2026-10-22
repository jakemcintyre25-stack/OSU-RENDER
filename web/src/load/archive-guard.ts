/** Fail-closed ZIP central-directory inspection before any .osz decompression.
 * Resource ceilings are application policy, not osu! format restrictions.
 * ZIP64, multi-disk, encrypted and unsupported compression entries are rejected.
 */
export const OSZ_LIMITS = Object.freeze({
  compressedBytes: 256 * 1024 * 1024,
  inflatedBytes: 512 * 1024 * 1024,
  entryBytes: 192 * 1024 * 1024,
  entries: 4096,
  pathBytes: 4096,
  compressionRatio: 300,
});

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const decoder = new TextDecoder();

export interface ZipEntryInfo {
  path: string;
  compressedBytes: number;
  inflatedBytes: number;
}

function fail(message: string): never {
  throw new Error('Unsafe or invalid beatmap archive: ' + message);
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  // ZIP directory entries end in '/'; that one terminal separator is valid.
  const components = (normalized.endsWith('/') ? normalized.slice(0, -1) : normalized).split('/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) ||
      normalized.includes('\0') || components.some((p) => p === '..' || p === '' || p === '.')) {
    return fail('unsafe entry path');
  }
  return normalized.toLowerCase();
}

/** Reads only metadata; no compressed entries are inflated by this function. */
export function inspectOszArchive(bytes: Uint8Array): ZipEntryInfo[] {
  if (bytes.byteLength > OSZ_LIMITS.compressedBytes) fail('compressed archive exceeds limit');
  if (bytes.byteLength < 22) fail('missing ZIP end record');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // ZIP comments can be 65,535 bytes. A valid EOCD must end at the end of the file.
  let eocd = -1;
  const from = Math.max(0, bytes.byteLength - 22 - 65535);
  for (let i = bytes.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD &&
        i + 22 + view.getUint16(i + 20, true) === bytes.byteLength) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('missing ZIP end record');
  const u16 = (i: number) => view.getUint16(i, true);
  const u32 = (i: number) => view.getUint32(i, true);
  const entries = u16(eocd + 10);
  const centralLength = u32(eocd + 12);
  const centralOffset = u32(eocd + 16);
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 ||
      u16(eocd + 8) !== entries) fail('multi-disk ZIP is unsupported');
  if (entries === 0xffff || centralLength === 0xffffffff || centralOffset === 0xffffffff) {
    fail('ZIP64 archive is unsupported');
  }
  if (entries === 0 || entries > OSZ_LIMITS.entries) fail('entry count outside permitted limits');
  if (centralOffset + centralLength !== eocd) fail('invalid central directory bounds');

  const names = new Set<string>();
  const inspected: ZipEntryInfo[] = [];
  let pos = centralOffset;
  let totalInflated = 0;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > eocd || u32(pos) !== CENTRAL) fail('corrupt central directory');
    const flags = u16(pos + 8);
    const method = u16(pos + 10);
    const compressed = u32(pos + 20);
    const inflated = u32(pos + 24);
    const nameBytes = u16(pos + 28);
    const extra = u16(pos + 30);
    const comment = u16(pos + 32);
    const localOffset = u32(pos + 42);
    const next = pos + 46 + nameBytes + extra + comment;
    if (next > eocd || nameBytes === 0 || nameBytes > OSZ_LIMITS.pathBytes) fail('invalid entry metadata');
    if ((flags & 1) !== 0) fail('encrypted entries are unsupported');
    if (method !== 0 && method !== 8) fail('unsupported compression method');
    if (compressed === 0xffffffff || inflated === 0xffffffff || localOffset === 0xffffffff) {
      fail('ZIP64 entry is unsupported');
    }
    const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameBytes));
    const key = normalizePath(path);
    if (names.has(key)) fail('duplicate case-insensitive entry: ' + path);
    names.add(key);
    if (inflated > OSZ_LIMITS.entryBytes) fail('entry exceeds individual inflated-size limit');
    totalInflated += inflated;
    if (totalInflated > OSZ_LIMITS.inflatedBytes) fail('total inflated data exceeds limit');
    if (inflated > 0 && (compressed === 0 || inflated / compressed > OSZ_LIMITS.compressionRatio)) {
      fail('excessive compression ratio');
    }
    if (method === 0 && compressed !== inflated) fail('stored entry declares inconsistent size');
    if (localOffset + 30 > centralOffset || u32(localOffset) !== LOCAL) fail('invalid local entry header');
    const localFlags = u16(localOffset + 6);
    const localMethod = u16(localOffset + 8);
    const localNameBytes = u16(localOffset + 26);
    const localExtra = u16(localOffset + 28);
    const payloadStart = localOffset + 30 + localNameBytes + localExtra;
    if (localFlags !== flags || localMethod !== method ||
        localNameBytes !== nameBytes || payloadStart + compressed > centralOffset) {
      fail('entry header or data bounds mismatch');
    }
    for (let j = 0; j < nameBytes; j++) {
      if (bytes[localOffset + 30 + j] !== bytes[pos + 46 + j]) fail('local and central names differ');
    }
    inspected.push({ path, compressedBytes: compressed, inflatedBytes: inflated });
    pos = next;
  }
  if (pos !== eocd) fail('unexpected central directory trailing data');
  return inspected;
}
