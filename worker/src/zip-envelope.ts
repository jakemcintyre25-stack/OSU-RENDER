/**
 * Bounded metadata inspection for untrusted mirror responses. This does NOT
 * decompress bytes or verify CRC32: the browser's .osz loader performs the
 * stronger post-extraction check. It prevents a corrupt mirror response from
 * being accepted and cached when another mirror might provide a valid archive.
 */
export function validateMirrorZip(bytes: Uint8Array): void {
  const invalid = (why: string): never => { throw new Error('Invalid ZIP: ' + why); };
  if (bytes.length < 22 || bytes.length > 150 * 1024 * 1024) invalid('file size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  if (u32(0) !== 0x04034b50) invalid('missing local file header');

  const from = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let pos = bytes.length - 22; pos >= from; pos--) {
    if (u32(pos) === 0x06054b50 && pos + 22 + u16(pos + 20) === bytes.length) {
      eocd = pos;
      break;
    }
  }
  if (eocd < 0) invalid('missing end of central directory');
  const count = u16(eocd + 10);
  const centralLength = u32(eocd + 12);
  const centralOffset = u32(eocd + 16);
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== count) {
    invalid('multi-disk ZIP unsupported');
  }
  if (count === 0 || count === 65535 || count > 4096 ||
      centralLength === 0xffffffff || centralOffset === 0xffffffff ||
      centralOffset + centralLength !== eocd) {
    invalid('invalid central directory bounds or ZIP64');
  }
  let offset = centralOffset;
  let totalInflated = 0;
  const names = new Set<string>();
  // Cloudflare Workers TextDecoder typings do not expose the browser's fatal option.
  // Reject the decoder replacement character instead of accepting ambiguous paths.
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > eocd || u32(offset) !== 0x02014b50) invalid('corrupt central directory');
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const compressed = u32(offset + 20);
    const inflated = u32(offset + 24);
    const nameLength = u16(offset + 28);
    const extra = u16(offset + 30);
    const comment = u16(offset + 32);
    const local = u32(offset + 42);
    const next = offset + 46 + nameLength + extra + comment;
    if (next > eocd || nameLength === 0 || nameLength > 4096) invalid('invalid central entry length');
    if (flags & 1 || (method !== 0 && method !== 8)) invalid('encrypted or unsupported compression');
    if (compressed === 0xffffffff || inflated === 0xffffffff || local === 0xffffffff) {
      invalid('ZIP64 entries unsupported');
    }
    if (inflated > 192 * 1024 * 1024 || (totalInflated += inflated) > 512 * 1024 * 1024) {
      invalid('inflated size limit');
    }
    if ((inflated > 0 && (compressed === 0 || inflated / compressed > 300)) ||
        (method === 0 && inflated !== compressed)) invalid('compression ratio or stored size');
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      return invalid('invalid UTF-8 filename');
    }
    if (name.includes('\uFFFD')) invalid('invalid UTF-8 filename');
    const normalized = name.replace(/\\/g, '/').toLowerCase();
    const parts = (normalized.endsWith('/') ? normalized.slice(0, -1) : normalized).split('/');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:/.test(normalized) ||
        parts.some(p => !p || p === '..' || p === '.') || names.has(normalized)) {
      invalid('unsafe or duplicate archive name');
    }
    names.add(normalized);
    if (local + 30 > centralOffset || u32(local) !== 0x04034b50) invalid('missing local header');
    const localNameLength = u16(local + 26);
    const localExtraLength = u16(local + 28);
    const payload = local + 30 + localNameLength + localExtraLength;
    if (u16(local + 6) !== flags || u16(local + 8) !== method ||
        localNameLength !== nameLength || payload + compressed > centralOffset) {
      invalid('local header and payload bounds');
    }
    for (let j = 0; j < nameLength; j++) {
      if (bytes[local + 30 + j] !== bytes[offset + 46 + j]) invalid('filename mismatch');
    }
    offset = next;
  }
  if (offset !== eocd) invalid('unexpected central directory trailing data');
}
