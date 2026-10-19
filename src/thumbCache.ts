// Persistent preview cache (IndexedDB in the plugin iframe): component
// thumbnails, invalidated by the signature the plugin computes, and slide
// renders, keyed by their content so undo or reopening a deck finds them.
// Every call degrades to "no cache" when storage is unavailable (private
// mode, sandboxed iframe without same-origin, quota…).

import type { SlideRender } from './render/types';

export interface CachedThumbnail {
  thumbnail: string;
  signature: string;
}

const DB_NAME = 'slide-builder';
const DB_VERSION = 2;
const THUMBNAILS = 'thumbnails';
const RENDERS = 'renders';
// Renders are content-addressed and never updated, only superseded: past
// this many the store is simply emptied.
const MAX_RENDERS = 400;

// Storage can also hang without ever answering (third-party iframes with
// partitioned / blocked storage): every wait is bounded so the previews
// pipeline never stalls on the cache.
const OPEN_TIMEOUT_MS = 1500;
const READ_TIMEOUT_MS = 1500;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    window.setTimeout(() => resolve(null), OPEN_TIMEOUT_MS);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(THUMBNAILS)) db.createObjectStore(THUMBNAILS);
        if (!db.objectStoreNames.contains(RENDERS)) db.createObjectStore(RENDERS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function readMany<T>(store: string, ids: string[], valid: (v: unknown) => v is T): Promise<Record<string, T>> {
  const db = await openDb();
  const out: Record<string, T> = {};
  if (!db || ids.length === 0) return out;
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(out), READ_TIMEOUT_MS);
    try {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      for (const id of ids) {
        const req = os.get(id);
        req.onsuccess = () => {
          if (valid(req.result)) out[id] = req.result;
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

async function writeOne(store: string, id: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(store, 'readwrite').objectStore(store).put(value, id);
  } catch {
    // Quota or closed database: the preview just isn't cached.
  }
}

const isThumbnail = (v: unknown): v is CachedThumbnail =>
  !!v && typeof (v as CachedThumbnail).thumbnail === 'string';

const isRender = (v: unknown): v is SlideRender =>
  !!v && typeof (v as SlideRender).svg === 'string' && Array.isArray((v as SlideRender).nodes);

export function readThumbnails(ids: string[]): Promise<Record<string, CachedThumbnail>> {
  return readMany(THUMBNAILS, ids, isThumbnail);
}

export function writeThumbnail(id: string, value: CachedThumbnail): Promise<void> {
  return writeOne(THUMBNAILS, id, value);
}

export async function readRender(key: string): Promise<SlideRender | null> {
  const found = await readMany(RENDERS, [key], isRender);
  return found[key] ?? null;
}

export async function writeRender(render: SlideRender): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const os = db.transaction(RENDERS, 'readwrite').objectStore(RENDERS);
    const count = os.count();
    count.onsuccess = () => {
      if (count.result >= MAX_RENDERS) os.clear();
      os.put(render, render.key);
    };
  } catch {
    // Not cached; it will be rendered again when needed.
  }
}
