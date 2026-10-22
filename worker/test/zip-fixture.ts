/** A tiny well-formed stored ZIP fixture built from bytes, not a mock signature. */
export function storedZip(payload = new Uint8Array([1, 2, 3])): Uint8Array {
  const filename = new TextEncoder().encode('map.osu');
  const localLength = 30 + filename.length + payload.length;
  const centralLength = 46 + filename.length;
  const out = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(out.buffer);
  const u16 = (i: number, n: number) => view.setUint16(i, n, true);
  const u32 = (i: number, n: number) => view.setUint32(i, n, true);
  let crc = 0xffffffff;
  for (const value of payload) {
    crc ^= value;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;

  u32(0, 0x04034b50);
  u16(4, 20);
  u16(8, 0); // stored
  u32(14, crc);
  u32(18, payload.length);
  u32(22, payload.length);
  u16(26, filename.length);
  out.set(filename, 30);
  out.set(payload, 30 + filename.length);

  const central = localLength;
  u32(central, 0x02014b50);
  u16(central + 4, 20);
  u16(central + 6, 20);
  u16(central + 10, 0);
  u32(central + 16, crc);
  u32(central + 20, payload.length);
  u32(central + 24, payload.length);
  u16(central + 28, filename.length);
  u32(central + 42, 0);
  out.set(filename, central + 46);

  const end = localLength + centralLength;
  u32(end, 0x06054b50);
  u16(end + 8, 1);
  u16(end + 10, 1);
  u32(end + 12, centralLength);
  u32(end + 16, localLength);
  return out;
}
