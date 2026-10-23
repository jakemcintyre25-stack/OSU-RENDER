import { describe, expect, it } from 'vitest';
import { createIndexedDbSkinStore, isStoredSkin, MAX_STORED_SKIN_BYTES } from '../src/load/skin-store';

const record = (bytes = 4) => ({ name: 'skin.osk', bytes: new ArrayBuffer(bytes), savedAt: Date.now() });

describe('M7 selected-skin persistence', () => {
  it('accepts bounded skin records and rejects malformed ones', () => {
    expect(isStoredSkin(record())).toBe(true);
    expect(isStoredSkin(null)).toBe(false);
    expect(isStoredSkin({})).toBe(false);
    expect(isStoredSkin({ ...record(), name: '' })).toBe(false);
    expect(isStoredSkin({ ...record(), name: 'x'.repeat(256) })).toBe(false);
    expect(isStoredSkin({ ...record(), bytes: new ArrayBuffer(0) })).toBe(false);
    expect(isStoredSkin({ ...record(), bytes: new ArrayBuffer(MAX_STORED_SKIN_BYTES + 1) })).toBe(false);
    expect(isStoredSkin({ ...record(), savedAt: NaN })).toBe(false);
    expect(isStoredSkin({ ...record(), bytes: new Uint8Array(4) })).toBe(false);
  });

  it('is a silent no-op when IndexedDB is unavailable', async () => {
    const store = createIndexedDbSkinStore(undefined);
    await expect(store.load()).resolves.toBeNull();
    await expect(store.save(record())).resolves.toBe(false);
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('refuses to save an invalid record without touching storage', async () => {
    let opened = 0;
    const factory = {
      open() { opened++; throw new Error('must not open'); },
    } as unknown as IDBFactory;
    const store = createIndexedDbSkinStore(factory);
    await expect(store.save({ ...record(), bytes: new ArrayBuffer(0) })).resolves.toBe(false);
    expect(opened).toBe(0);
  });
});
