/** Small IndexedDB store for the user's selected .osk archive.
 *
 * The file stays in this origin's local browser storage; it is never uploaded.
 * Every failure is non-fatal: a deleted/quota-limited database simply means the
 * skin applies to this session only.
 */

export interface StoredSkin {
  name: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

export interface SkinStore {
  load(): Promise<StoredSkin | null>;
  save(skin: StoredSkin): Promise<boolean>;
  clear(): Promise<void>;
}

export const MAX_STORED_SKIN_BYTES = 128 * 1024 * 1024;
const DB_NAME = 'osu-render';
const STORE = 'skin';
const KEY = 'current';

export function isStoredSkin(value: unknown): value is StoredSkin {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredSkin>;
  return typeof candidate.name === 'string' && candidate.name.length > 0 && candidate.name.length <= 255 &&
    Number.isFinite(candidate.savedAt) &&
    candidate.bytes instanceof ArrayBuffer &&
    candidate.bytes.byteLength > 0 && candidate.bytes.byteLength <= MAX_STORED_SKIN_BYTES;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function createIndexedDbSkinStore(factory: IDBFactory | undefined = globalThis.indexedDB): SkinStore {
  if (!factory) {
    return { async load() { return null; }, async save() { return false; }, async clear() {} };
  }
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open skin storage'));
      request.onblocked = () => reject(new Error('Skin storage is blocked'));
    });
    return database;
  };
  return {
    async load() {
      try {
        const db = await open();
        return await new Promise<StoredSkin | null>((resolve) => {
          const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
          request.onsuccess = () => resolve(isStoredSkin(request.result) ? request.result : null);
          request.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    },
    async save(skin) {
      if (!isStoredSkin(skin)) return false;
      try {
        const db = await open();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(skin, KEY);
        await transactionDone(tx);
        return true;
      } catch {
        return false;
      }
    },
    async clear() {
      try {
        const db = await open();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        await transactionDone(tx);
      } catch {
        /* storage unavailable */
      }
    },
  };
}
