// Persistent thumbnail cache (IndexedDB in the plugin iframe). Rendering a
// thumbnail costs seconds of server-side export, so they are kept across
// sessions and invalidated by the component signature the plugin computes.
// Every call degrades to "no cache" when storage is unavailable (private
// mode, sandboxed iframe without same-origin, quota…).

export interface CachedThumbnail {
  thumbnail: string;
  signature: string;
}

const DB_NAME = 'slide-builder';
const STORE = 'thumbnails';

// Storage can also hang without ever answering (third-party iframes with
// partitioned / blocked storage): every wait is bounded so the thumbnails
// pipeline never stalls on the cache.
const OPEN_TIMEOUT_MS = 1500;
const READ_TIMEOUT_MS = 1500;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    window.setTimeout(() => resolve(null), OPEN_TIMEOUT_MS);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function readThumbnails(ids: string[]): Promise<Record<string, CachedThumbnail>> {
  const db = await openDb();
  const out: Record<string, CachedThumbnail> = {};
  if (!db || ids.length === 0) return out;
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(out), READ_TIMEOUT_MS);
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      for (const id of ids) {
        const req = store.get(id);
        req.onsuccess = () => {
          const v = req.result as CachedThumbnail | undefined;
          if (v && typeof v.thumbnail === 'string') out[id] = v;
        };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(out);
      tx.onabort = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

export async function writeThumbnail(id: string, value: CachedThumbnail): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, id);
  } catch {
    // Quota or closed database: the thumbnail just isn't cached.
  }
}
