import type { TableState } from '../engine/types';

export interface Saved {
  state: TableState;
  history: TableState[];
  savedAt: number;
}

export interface Store {
  load(): Promise<Saved | null>;
  save(saved: Saved): Promise<void>;
}

export class MemoryStore implements Store {
  value: Saved | null = null;
  async load(): Promise<Saved | null> {
    return this.value;
  }
  async save(saved: Saved): Promise<void> {
    this.value = saved;
  }
}

const DB_NAME = 'voice-poker-table';
const KV = 'kv';
const KEY = 'session';
const MIRROR_KEY = 'voice-poker-table/latest';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KV);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase): Promise<Saved | null> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(KV, 'readonly').objectStore(KV).get(KEY);
    req.onsuccess = () => resolve((req.result as Saved | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, value: Saved): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * IndexedDB holds state plus undo history. Each save also writes the latest state
 * to localStorage synchronously, so a refresh mid-write can't lose the last move.
 * On load the newer of the two wins.
 */
export class BrowserStore implements Store {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  private readMirror(): Saved | null {
    try {
      const raw = localStorage.getItem(MIRROR_KEY);
      return raw ? (JSON.parse(raw) as Saved) : null;
    } catch {
      return null;
    }
  }

  async load(): Promise<Saved | null> {
    let fromDb: Saved | null = null;
    try {
      fromDb = await idbGet(await this.db());
    } catch {
      /* IndexedDB unavailable (private mode, blocked): fall back to the mirror */
    }
    const mirror = this.readMirror();
    if (mirror && (!fromDb || mirror.savedAt > fromDb.savedAt)) {
      return { state: mirror.state, history: fromDb?.history ?? [], savedAt: mirror.savedAt };
    }
    return fromDb;
  }

  async save(saved: Saved): Promise<void> {
    try {
      localStorage.setItem(MIRROR_KEY, JSON.stringify({ state: saved.state, history: [], savedAt: saved.savedAt }));
    } catch {
      /* quota or blocked: IndexedDB below is still the primary copy */
    }
    try {
      await idbPut(await this.db(), saved);
    } catch {
      /* mirror above still holds the latest state */
    }
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
