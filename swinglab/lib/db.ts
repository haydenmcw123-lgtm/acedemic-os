import type { SwingSession } from "./types";

const DB_NAME = "swinglab";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const CLIPS = "clips";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const store = db.createObjectStore(SESSIONS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(CLIPS)) {
        db.createObjectStore(CLIPS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export function putSession(session: SwingSession): Promise<unknown> {
  return tx(SESSIONS, "readwrite", (s) => s.put(session));
}

export function getSession(id: string): Promise<SwingSession | undefined> {
  return tx<SwingSession | undefined>(SESSIONS, "readonly", (s) => s.get(id));
}

export function listSessions(): Promise<SwingSession[]> {
  return tx<SwingSession[]>(SESSIONS, "readonly", (s) => s.getAll()).then(
    (all) => all.sort((a, b) => b.createdAt - a.createdAt),
  );
}

/**
 * Keeping the clip means a reload can pick the analysis back up. It is also
 * the biggest thing we will ever write, so callers must tolerate a quota
 * failure rather than losing the session over it.
 */
export async function putClip(id: string, file: File): Promise<boolean> {
  try {
    await tx(CLIPS, "readwrite", (s) =>
      s.put({ id, blob: file, name: file.name, type: file.type }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function getClip(id: string): Promise<Blob | undefined> {
  try {
    const rec = await tx<{ blob: Blob } | undefined>(CLIPS, "readonly", (s) =>
      s.get(id),
    );
    return rec?.blob;
  } catch {
    return undefined;
  }
}

export async function deleteSession(id: string): Promise<void> {
  await tx(SESSIONS, "readwrite", (s) => s.delete(id));
  try {
    await tx(CLIPS, "readwrite", (s) => s.delete(id));
  } catch {
    /* the clip may never have fit; the session record is what matters */
  }
}
