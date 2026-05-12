const DB_NAME = "watchvault";
const DB_VERSION = 2;
const STORE_IMAGES = "watchImages";
const STORE_COLLECTION = "watchCollection";
/** Single record key for the JSON watch array (primary collection store). */
export const WATCH_COLLECTION_IDB_KEY = "watchvault-watches-json";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const old = ev.oldVersion;
      if (old < 1 && !db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES);
      }
      if (old < 2 && !db.objectStoreNames.contains(STORE_COLLECTION)) {
        db.createObjectStore(STORE_COLLECTION);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveWatchImage(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB write failed"));
    };
    tx.objectStore(STORE_IMAGES).put(blob, id);
  });
}

export async function getWatchImageBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const req = tx.objectStore(STORE_IMAGES).get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result as Blob | undefined);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("IndexedDB read failed"));
    };
  });
}

export async function deleteWatchImage(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB delete failed"));
    };
    tx.objectStore(STORE_IMAGES).delete(id);
  });
}

export async function saveWatchCollectionJson(json: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COLLECTION, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB collection write failed"));
    };
    tx.objectStore(STORE_COLLECTION).put(json, WATCH_COLLECTION_IDB_KEY);
  });
}

/** Returns raw JSON string if present, otherwise `undefined`. */
export async function loadWatchCollectionJson(): Promise<string | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COLLECTION, "readonly");
    const req = tx.objectStore(STORE_COLLECTION).get(WATCH_COLLECTION_IDB_KEY);
    req.onsuccess = () => {
      db.close();
      const v = req.result;
      resolve(typeof v === "string" && v.trim() ? v : undefined);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("IndexedDB collection read failed"));
    };
  });
}

/** Best-effort probe for private mode / blocked storage. */
export async function probeWatchVaultIndexedDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await openDb();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
