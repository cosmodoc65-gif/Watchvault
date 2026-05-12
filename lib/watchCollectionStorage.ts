import {
  normalizeWatchList,
  readWatchCollectionFromLocalStorage,
  type LoadWatchesFromLocalStorageResult,
  type Watch,
} from "@/lib/watchNormalize";
import { WATCHES_STORAGE_KEY } from "@/lib/watchStorageKeys";
import {
  loadWatchCollectionJson,
  probeWatchVaultIndexedDb,
  saveWatchCollectionJson,
  WATCH_COLLECTION_IDB_KEY,
} from "@/lib/watchVaultIdb";

export type LoadWatchesFromStorageResult = LoadWatchesFromLocalStorageResult & {
  loadedFrom: "indexeddb" | "localStorage" | null;
  migratedJsonToIndexedDb: boolean;
  indexedDbUnavailable: boolean;
  /** True when there is genuinely no saved collection (not a parse error). */
  noWatchDataFound: boolean;
};

const emptyExtended = (): LoadWatchesFromStorageResult => ({
  watches: [],
  sourceKey: null,
  migrationPerformed: false,
  blockEmptyPersist: false,
  issue: null,
  loadedFrom: null,
  migratedJsonToIndexedDb: false,
  indexedDbUnavailable: false,
  noWatchDataFound: false,
});

function auditLocalStorageWatchVaultKeys(): Record<string, { charCount: number } | { error: string }> {
  const out: Record<string, { charCount: number } | { error: string }> = {};
  if (typeof window === "undefined") return out;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.toLowerCase().includes("watchvault")) continue;
      try {
        const v = window.localStorage.getItem(key);
        out[key] = { charCount: v?.length ?? 0 };
      } catch (e) {
        out[key] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  } catch (e) {
    out._audit = { error: e instanceof Error ? e.message : String(e) };
  }
  return out;
}

async function parseIdbWatchList(): Promise<Watch[]> {
  try {
    const raw = await loadWatchCollectionJson();
    if (!raw?.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
    return normalizeWatchList(parsed);
  } catch {
    return [];
  }
}

/**
 * Load watches from IndexedDB (primary) and all known localStorage keys, merge safely,
 * migrate toward IndexedDB + canonical localStorage without deleting legacy keys.
 */
export async function loadWatchesFromAllSources(): Promise<LoadWatchesFromStorageResult> {
  if (typeof window === "undefined") {
    return emptyExtended();
  }

  const idbProbe = await probeWatchVaultIndexedDb();
  const indexedDbUnavailable = !idbProbe.ok;

  const idbWatches = indexedDbUnavailable ? [] : await parseIdbWatchList();
  const lsRead = readWatchCollectionFromLocalStorage();

  if (process.env.NODE_ENV === "development") {
    console.info("[WatchVault storage audit]", {
      localStorageWatchVaultKeys: auditLocalStorageWatchVaultKeys(),
      indexedDbProbe: idbProbe,
      idbWatchCount: idbWatches.length,
      localStorageWatchCount: lsRead.watches.length,
    });
  }

  if (lsRead.issue || lsRead.blockEmptyPersist) {
    if (idbWatches.length > 0) {
      const json = JSON.stringify(idbWatches);
      if (!indexedDbUnavailable) {
        try {
          await saveWatchCollectionJson(json);
        } catch {
          /* keep */
        }
      }
      try {
        window.localStorage.setItem(WATCHES_STORAGE_KEY, json);
      } catch {
        /* mirror optional */
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[WatchVault storage]", {
          storageKeyUsed: `indexeddb:${WATCH_COLLECTION_IDB_KEY}`,
          watchesLoaded: idbWatches.length,
          migrationPerformed: false,
          loadedFrom: "indexeddb",
          note: "indexeddb_overrides_localStorage_read_issue",
        });
      }
      return {
        watches: idbWatches,
        sourceKey: `indexeddb:${WATCH_COLLECTION_IDB_KEY}`,
        migrationPerformed: false,
        blockEmptyPersist: false,
        issue: null,
        loadedFrom: "indexeddb",
        migratedJsonToIndexedDb: !indexedDbUnavailable,
        indexedDbUnavailable,
        noWatchDataFound: false,
      };
    }
    return {
      ...lsRead,
      loadedFrom: null,
      migratedJsonToIndexedDb: false,
      indexedDbUnavailable,
      noWatchDataFound: false,
    };
  }

  let watches: Watch[];
  let loadedFrom: "indexeddb" | "localStorage" | null;

  if (idbWatches.length > lsRead.watches.length) {
    watches = idbWatches;
    loadedFrom = "indexeddb";
  } else if (lsRead.watches.length > idbWatches.length) {
    watches = lsRead.watches;
    loadedFrom = "localStorage";
  } else if (idbWatches.length > 0) {
    watches = idbWatches;
    loadedFrom = "indexeddb";
  } else {
    watches = [];
    loadedFrom = null;
  }

  if (watches.length === 0) {
    const noWatchDataFound = !lsRead.issue && !lsRead.blockEmptyPersist;
    if (process.env.NODE_ENV === "development") {
      console.info("[WatchVault storage]", {
        storageKeyUsed: null,
        watchesLoaded: 0,
        migrationPerformed: false,
        loadedFrom: null,
        note: "no_saved_collection_any_source",
      });
    }
    return {
      watches: [],
      sourceKey: null,
      migrationPerformed: false,
      blockEmptyPersist: false,
      issue: null,
      loadedFrom: null,
      migratedJsonToIndexedDb: false,
      indexedDbUnavailable,
      noWatchDataFound,
    };
  }

  const json = JSON.stringify(watches);
  let migratedJsonToIndexedDb = false;

  if (!indexedDbUnavailable && watches.length > 0) {
    try {
      await saveWatchCollectionJson(json);
      migratedJsonToIndexedDb =
        loadedFrom === "localStorage" || idbWatches.length === 0 || lsRead.watches.length > idbWatches.length;
    } catch {
      /* IDB may be full or locked */
    }
  }

  let canonicalLsMigration = false;
  if (lsRead.sourceKey && lsRead.sourceKey !== WATCHES_STORAGE_KEY && lsRead.watches.length > 0) {
    try {
      window.localStorage.setItem(WATCHES_STORAGE_KEY, json);
      canonicalLsMigration = true;
    } catch {
      /* keep legacy keys intact */
    }
  } else {
    try {
      window.localStorage.setItem(WATCHES_STORAGE_KEY, json);
    } catch {
      /* mirror / refresh failed */
    }
  }

  const migrationPerformed = canonicalLsMigration || migratedJsonToIndexedDb;
  const sourceKey =
    loadedFrom === "indexeddb" ? `indexeddb:${WATCH_COLLECTION_IDB_KEY}` : lsRead.sourceKey ?? WATCHES_STORAGE_KEY;

  if (process.env.NODE_ENV === "development") {
    console.info("[WatchVault storage]", {
      storageKeyUsed: sourceKey,
      watchesLoaded: watches.length,
      migrationPerformed,
      migratedJsonToIndexedDb,
      loadedFrom,
      indexedDbUnavailable,
    });
  }

  return {
    watches,
    sourceKey,
    migrationPerformed,
    blockEmptyPersist: false,
    issue: null,
    loadedFrom,
    migratedJsonToIndexedDb,
    indexedDbUnavailable,
    noWatchDataFound: false,
  };
}

export type PersistWatchCollectionOutcome = {
  primaryWritten: "indexeddb" | "localStorage" | "none";
  indexedDbTried: boolean;
  localStorageMirrorOk: boolean;
  errorMessage?: string;
};

/**
 * Persist collection: IndexedDB first, then best-effort mirror to canonical localStorage.
 * Does not remove legacy keys. Respects block-empty guard for wiped recoverable storage.
 */
export async function persistWatchCollection(
  watches: Watch[],
  opts: { blockEmptyWrite: boolean },
): Promise<PersistWatchCollectionOutcome> {
  if (typeof window === "undefined") {
    return { primaryWritten: "none", indexedDbTried: false, localStorageMirrorOk: true };
  }
  if (opts.blockEmptyWrite && watches.length === 0) {
    return { primaryWritten: "none", indexedDbTried: false, localStorageMirrorOk: true };
  }

  const json = JSON.stringify(watches);
  let primaryWritten: "indexeddb" | "localStorage" | "none" = "none";
  let indexedDbTried = false;
  let localStorageMirrorOk = false;
  let errorMessage: string | undefined;

  const probe = await probeWatchVaultIndexedDb();
  if (probe.ok) {
    indexedDbTried = true;
    try {
      await saveWatchCollectionJson(json);
      primaryWritten = "indexeddb";
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "IndexedDB save failed";
    }
  }

  if (primaryWritten !== "indexeddb") {
    try {
      window.localStorage.setItem(WATCHES_STORAGE_KEY, json);
      primaryWritten = "localStorage";
      localStorageMirrorOk = true;
    } catch (e) {
      if (!errorMessage) errorMessage = e instanceof Error ? e.message : "Local storage save failed";
    }
  } else {
    try {
      window.localStorage.setItem(WATCHES_STORAGE_KEY, json);
      localStorageMirrorOk = true;
    } catch {
      localStorageMirrorOk = false;
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[WatchVault storage persist]", {
      primaryWritten,
      indexedDbTried,
      localStorageMirrorOk,
      watchCount: watches.length,
      errorMessage,
    });
  }

  return { primaryWritten, indexedDbTried, localStorageMirrorOk, errorMessage };
}
