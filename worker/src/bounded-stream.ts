/** Bounded collection of untrusted upstream response bodies.
 * Content-Length is advisory only: terminate and release the reader once
 * the actual streamed byte count exceeds the operational ceiling.
 */
export async function readBoundedResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid download byte limit');
  const declaredHeader = response.headers.get('content-length');
  // Content-Length is untrusted: reject malformed/negative/non-integer values
  // rather than accepting Infinity, exponent notation or inconsistent hints.
  if (declaredHeader !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declaredHeader)) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Invalid download Content-Length');
    }
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Download too large (declared length)');
    }
  }
  if (!response.body) throw new Error('Download has no readable body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Download too large (streamed length)');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
