import {
  normalizeWatchList,
  readWatchCollectionFromLocalStorage,
  type LoadWatchesFromLocalStorageResult,
  type Watch,
} from "@/lib/watchNormalize";
import {
  WATCHES_STORAGE_KEY,
  WATCHVAULT_BACKUP_LAST_EXPORTED_AT_KEY,
  WATCHVAULT_BACKUP_REMINDER_DAYS_KEY,
  WATCHVAULT_COLLECTION_CURRENCY_KEY,
} from "@/lib/watchStorageKeys";
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
  /**
   * Startup safety: when true, the UI must not call `persistWatchCollection` with an empty array until the user
   * adds a watch or imports a backup. Prevents wiping IndexedDB / canonical localStorage when the merge read was
   * ambiguous (e.g. IndexedDB temporarily unavailable, parse/recovery paths, or load errors).
   */
  startupBlockEmptyPersist: boolean;
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
  startupBlockEmptyPersist: true,
});

const SETTINGS_LOCALSTORAGE_KEYS_LOWER = new Set(
  [
    WATCHVAULT_COLLECTION_CURRENCY_KEY,
    WATCHVAULT_BACKUP_REMINDER_DAYS_KEY,
    WATCHVAULT_BACKUP_LAST_EXPORTED_AT_KEY,
  ].map((k) => k.toLowerCase()),
);

/**
 * After merging every source, if we still have zero watches, only then may startup persist `[]` — and only when we are
 * confident nothing was missed. IndexedDB-unavailable + zero merge is treated as unsafe: the collection might live in
 * IDB only, or the probe failed transiently (Safari / private mode / storage pressure on deployed hosts).
 */
function deriveStartupBlockEmptyPersistForZeroMerge(opts: {
  noWatchDataFound: boolean;
  indexedDbUnavailable: boolean;
  localStorageBlocksEmpty: boolean;
  localStorageHadIssue: boolean;
  likelyUnreadableWatchPayloadElsewhere: boolean;
}): boolean {
  if (opts.localStorageHadIssue || opts.localStorageBlocksEmpty) return true;
  if (opts.indexedDbUnavailable) return true;
  if (!opts.noWatchDataFound) return true;
  if (opts.likelyUnreadableWatchPayloadElsewhere) return true;
  return false;
}

/** Keys that are never treated as watch list JSON. */
function isExcludedSettingsLocalStorageKey(key: string): boolean {
  return SETTINGS_LOCALSTORAGE_KEYS_LOWER.has(key.toLowerCase());
}

/**
 * Heuristic: any localStorage key that might hold a JSON watch array (not only known keys).
 */
export function isLikelyWatchListLocalStorageKey(key: string): boolean {
  const l = key.toLowerCase();
  if (isExcludedSettingsLocalStorageKey(key)) return false;
  if (l.includes("watchvault")) return true;
  if (l.includes("watch") && l.includes("vault")) return true;
  if (l.includes("watch") && l.includes("collection")) return true;
  if (l.includes("vault") && l.includes("collection")) return true;
  return false;
}

function extractArrayForWatchNormalize(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const w = (parsed as Record<string, unknown>).watches;
    if (Array.isArray(w)) return w;
  }
  return null;
}

/** Merge lists in order; first occurrence of an id wins (highest-priority list should be passed first). */
export function mergeWatchListsDedupeByIdPreferFirst(lists: Watch[][]): Watch[] {
  const byId = new Map<string, Watch>();
  for (const list of lists) {
    for (const w of list) {
      if (!w?.id) continue;
      if (!byId.has(w.id)) byId.set(w.id, w);
    }
  }
  return [...byId.values()];
}

/**
 * Read-only scan of localStorage for any recoverable watch arrays (no writes).
 * Used by load, diagnostics, and dev recovery helper.
 */
export function recoverWatchListsFromLocalStorageReadonly(): { key: string; watches: Watch[] }[] {
  if (typeof window === "undefined") return [];
  const out: { key: string; watches: Watch[] }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !isLikelyWatchListLocalStorageKey(key)) continue;
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        continue;
      }
      if (!raw?.trim()) continue;
      const t = raw.trim();
      if (!t.startsWith("[") && !t.startsWith("{")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        continue;
      }
      const arr = extractArrayForWatchNormalize(parsed);
      if (!arr) continue;
      const watches = normalizeWatchList(arr);
      if (watches.length > 0) out.push({ key, watches });
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * True when a heuristic watch-list key holds a non-empty JSON array (or `{ watches: [...] }`) that does not normalize
 * to any valid `Watch`. In that situation we must not persist `[]` on startup — the raw payload may still be recoverable
 * via backup repair or a future schema fix.
 */
function localStorageLikelyHasUnreadableWatchPayload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !isLikelyWatchListLocalStorageKey(key)) continue;
      let raw: string | null;
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        continue;
      }
      if (!raw?.trim()) continue;
      const t = raw.trim();
      if (!t.startsWith("[") && !t.startsWith("{")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        continue;
      }
      const arr = extractArrayForWatchNormalize(parsed);
      if (!Array.isArray(arr) || arr.length === 0) continue;
      if (normalizeWatchList(arr).length === 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function auditLocalStorageRelevantKeys(): Record<string, { charCount: number } | { error: string }> {
  const out: Record<string, { charCount: number } | { error: string }> = {};
  if (typeof window === "undefined") return out;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const kl = key.toLowerCase();
      if (
        !(
          kl.includes("watchvault") ||
          kl.includes("watch") ||
          kl.includes("collection") ||
          kl.includes("vault")
        )
      ) {
        continue;
      }
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
    const arr = extractArrayForWatchNormalize(parsed);
    if (!arr) return [];
    return normalizeWatchList(arr);
  } catch {
    return [];
  }
}

function devLocationLabel(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * Development-only: scan IndexedDB + all candidate localStorage keys and merge (read-only).
 * Does not write storage.
 */
export async function inspectWatchVaultStorageReadonly(): Promise<{
  host: string;
  indexedDbOpenOk: boolean;
  indexedDbProbeError?: string;
  idbWatchCount: number;
  localStorageSources: { key: string; watchCount: number }[];
  mergedWatchCount: number;
  merged: Watch[];
}> {
  const host = devLocationLabel();
  const probe = await probeWatchVaultIndexedDb();
  const idbWatches = probe.ok ? await parseIdbWatchList() : [];
  const wide = recoverWatchListsFromLocalStorageReadonly();
  const merged = mergeWatchListsDedupeByIdPreferFirst([idbWatches, ...wide.map((w) => w.watches)]);
  return {
    host,
    indexedDbOpenOk: probe.ok,
    indexedDbProbeError: probe.error,
    idbWatchCount: idbWatches.length,
    localStorageSources: wide.map((e) => ({ key: e.key, watchCount: e.watches.length })),
    mergedWatchCount: merged.length,
    merged,
  };
}

/**
 * Load watches from IndexedDB (primary) and all known / discoverable localStorage keys, merge safely,
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
  const wideSlices = recoverWatchListsFromLocalStorageReadonly();
  const wideMerged = mergeWatchListsDedupeByIdPreferFirst(wideSlices.map((s) => s.watches));
  const mergedLocal = mergeWatchListsDedupeByIdPreferFirst([lsRead.watches, wideMerged]);
  const combined = mergeWatchListsDedupeByIdPreferFirst([idbWatches, mergedLocal]);
  const unreadableWatchLikeLocalStorage = localStorageLikelyHasUnreadableWatchPayload();

  const recoveredPastPrimaryIssue =
    combined.length > 0 && (lsRead.issue !== null || lsRead.blockEmptyPersist) && lsRead.watches.length === 0;

  if (process.env.NODE_ENV === "development") {
    console.info("[WatchVault storage audit]", {
      host: devLocationLabel(),
      localStorageKeysRelevant: auditLocalStorageRelevantKeys(),
      indexedDbOpenOk: idbProbe.ok,
      indexedDbProbeError: idbProbe.error,
      idbWatchCount: idbWatches.length,
      orderedLocalStorageWatchCount: lsRead.watches.length,
      wideLocalStorageSources: wideSlices.map((s) => ({ key: s.key, count: s.watches.length })),
      wideMergedWatchCount: wideMerged.length,
      mergedLocalWatchCount: mergedLocal.length,
      combinedWatchCount: combined.length,
      recoveredPastPrimaryIssue,
      hadPrimaryReadIssue: lsRead.issue !== null,
      hadPrimaryBlockEmpty: lsRead.blockEmptyPersist,
    });
  }

  if (combined.length === 0) {
    if (lsRead.issue || lsRead.blockEmptyPersist) {
      return {
        ...lsRead,
        loadedFrom: null,
        migratedJsonToIndexedDb: false,
        indexedDbUnavailable,
        noWatchDataFound: false,
        startupBlockEmptyPersist: true,
      };
    }
    const noWatchDataFound = !lsRead.issue && !lsRead.blockEmptyPersist;
    const startupBlockEmptyPersist = deriveStartupBlockEmptyPersistForZeroMerge({
      noWatchDataFound,
      indexedDbUnavailable,
      localStorageBlocksEmpty: lsRead.blockEmptyPersist,
      localStorageHadIssue: lsRead.issue !== null,
      likelyUnreadableWatchPayloadElsewhere: unreadableWatchLikeLocalStorage,
    });
    if (process.env.NODE_ENV === "development") {
      console.info("[WatchVault storage]", {
        host: devLocationLabel(),
        storageKeyUsed: null,
        watchesLoaded: 0,
        migrationPerformed: false,
        loadedFrom: null,
        note: "no_saved_collection_any_source",
        startupBlockEmptyPersist,
        indexedDbUnavailable,
        noWatchDataFound,
        unreadableWatchLikeLocalStorage,
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
      startupBlockEmptyPersist,
    };
  }

  let loadedFrom: "indexeddb" | "localStorage" | null;
  if (idbWatches.length === 0 && mergedLocal.length > 0) {
    loadedFrom = "localStorage";
  } else if (mergedLocal.length === 0 && idbWatches.length > 0) {
    loadedFrom = "indexeddb";
  } else if (idbWatches.length >= mergedLocal.length) {
    loadedFrom = "indexeddb";
  } else {
    loadedFrom = "localStorage";
  }

  const watches = combined;
  const sourceKey =
    loadedFrom === "indexeddb" ? `indexeddb:${WATCH_COLLECTION_IDB_KEY}` : lsRead.sourceKey ?? WATCHES_STORAGE_KEY;

  // Intentionally no IndexedDB / localStorage writes here. Writes run only after React has applied `watches` from this
  // result and `watchesHydrated` is true, via `persistWatchCollection` — avoids empty-state races and duplicate concurrent
  // load migrations (e.g. Strict Mode, slow IndexedDB on mobile, or Vercel cold-start + client navigation).

  if (process.env.NODE_ENV === "development") {
    console.info("[WatchVault storage]", {
      host: devLocationLabel(),
      storageKeyUsed: sourceKey,
      watchesLoaded: watches.length,
      migrationPerformed: false,
      migratedJsonToIndexedDb: false,
      loadedFrom,
      indexedDbUnavailable,
      recoveredPastPrimaryIssue,
      note: "read_only_load_mirrors_deferred_to_persist_effect",
    });
  }

  return {
    watches,
    sourceKey,
    migrationPerformed: false,
    blockEmptyPersist: false,
    issue: null,
    loadedFrom,
    migratedJsonToIndexedDb: false,
    indexedDbUnavailable,
    noWatchDataFound: false,
    startupBlockEmptyPersist: false,
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
 * Does not remove legacy keys. When `opts.blockEmptyWrite` is true and `watches` is empty, returns without writing so
 * startup / ambiguous hydration cannot replace stored data with `[]`.
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
      host: devLocationLabel(),
      primaryWritten,
      indexedDbTried,
      localStorageMirrorOk,
      watchCount: watches.length,
      errorMessage,
    });
  }

  return { primaryWritten, indexedDbTried, localStorageMirrorOk, errorMessage };
}
