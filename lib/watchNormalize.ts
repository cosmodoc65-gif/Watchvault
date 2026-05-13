import { LEGACY_WATCH_STORAGE_KEYS, WATCHES_STORAGE_KEY } from "@/lib/watchStorageKeys";

export type WatchCondition = "new" | "excellent" | "very_good" | "good" | "fair" | "needs_attention";

export type WatchBoxPapers = "full_set" | "box_only" | "papers_only" | "watch_only" | "unknown";

export const CONDITION_LABELS: Record<WatchCondition, string> = {
  new: "New / unworn",
  excellent: "Excellent",
  very_good: "Very good",
  good: "Good",
  fair: "Fair",
  needs_attention: "Needs attention",
};

export const BOXPAPERS_LABELS: Record<WatchBoxPapers, string> = {
  full_set: "Full set",
  box_only: "Box only",
  papers_only: "Papers only",
  watch_only: "Watch only",
  unknown: "Unknown",
};

export type CollectionCurrency = "GBP" | "EUR" | "USD" | "CHF" | "JPY";

export type Watch = {
  id: string;
  brand: string;
  model: string;
  reference?: string;
  year?: string;
  serialNumber?: string;
  purchasePrice?: number;
  estimatedValue?: number;
  condition?: WatchCondition;
  boxPapers?: WatchBoxPapers;
  serviceHistory?: string;
  notes?: string;
  /** Legacy: inline data URL or remote URL */
  photoUrl?: string;
  /** Preferred: blob stored in IndexedDB under this key (usually watch id) */
  photoStorageKey?: string;
  isDemo?: boolean;
  createdAt: number;
};

export const ALL_WATCH_CONDITIONS: WatchCondition[] = [
  "new",
  "excellent",
  "very_good",
  "good",
  "fair",
  "needs_attention",
];
export const ALL_WATCH_BOXPAPERS: WatchBoxPapers[] = [
  "full_set",
  "box_only",
  "papers_only",
  "watch_only",
  "unknown",
];

function isWatchCondition(v: unknown): v is WatchCondition {
  return typeof v === "string" && ALL_WATCH_CONDITIONS.includes(v as WatchCondition);
}

function isWatchBoxPapers(v: unknown): v is WatchBoxPapers {
  return typeof v === "string" && ALL_WATCH_BOXPAPERS.includes(v as WatchBoxPapers);
}

export { LEGACY_WATCH_STORAGE_KEYS, WATCHES_STORAGE_KEY } from "@/lib/watchStorageKeys";

function parseNumericField(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Coerce older localStorage shapes so `normalizeWatch` can succeed.
 * Does not remove unknown fields (normalizeWatch ignores them).
 */
export function coerceLegacyWatchRecord(record: Record<string, unknown>, fallbackCreatedAt: number): Record<string, unknown> {
  const w = { ...record };

  if (typeof w.createdAt === "number" && Number.isFinite(w.createdAt)) {
    /* keep */
  } else if (typeof w.createdAt === "string" && w.createdAt.trim()) {
    const t = Date.parse(w.createdAt);
    w.createdAt = Number.isFinite(t) ? t : fallbackCreatedAt;
  } else {
    w.createdAt = fallbackCreatedAt;
  }

  if (typeof w.year === "number" && Number.isFinite(w.year)) w.year = String(Math.trunc(w.year));

  const est = parseNumericField(w.estimatedValue);
  if (est !== undefined) w.estimatedValue = est;

  const pur = parseNumericField(w.purchasePrice);
  if (pur !== undefined) w.purchasePrice = pur;

  if (typeof w.brand !== "string" && w.brand != null) w.brand = String(w.brand);
  if (typeof w.model !== "string" && w.model != null) w.model = String(w.model);
  if (typeof w.id !== "string" && w.id != null) w.id = String(w.id);

  return w;
}

export function normalizeWatch(raw: unknown): Watch | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || typeof w.brand !== "string" || typeof w.model !== "string") return null;
  if (typeof w.createdAt !== "number" || !Number.isFinite(w.createdAt)) return null;

  return {
    id: w.id,
    brand: w.brand,
    model: w.model,
    reference: typeof w.reference === "string" ? w.reference : undefined,
    year: typeof w.year === "string" ? w.year : undefined,
    serialNumber: typeof w.serialNumber === "string" ? w.serialNumber : undefined,
    purchasePrice: typeof w.purchasePrice === "number" && Number.isFinite(w.purchasePrice) ? w.purchasePrice : undefined,
    estimatedValue:
      typeof w.estimatedValue === "number" && Number.isFinite(w.estimatedValue) ? w.estimatedValue : undefined,
    condition: isWatchCondition(w.condition) ? w.condition : undefined,
    boxPapers: isWatchBoxPapers(w.boxPapers) ? w.boxPapers : undefined,
    serviceHistory: typeof w.serviceHistory === "string" ? w.serviceHistory : undefined,
    notes: typeof w.notes === "string" ? w.notes : undefined,
    photoUrl: typeof w.photoUrl === "string" ? w.photoUrl : undefined,
    photoStorageKey: typeof w.photoStorageKey === "string" ? w.photoStorageKey : undefined,
    isDemo: typeof w.isDemo === "boolean" ? w.isDemo : undefined,
    createdAt: w.createdAt,
  };
}

export function normalizeWatchList(raw: unknown): Watch[] {
  if (!Array.isArray(raw)) return [];
  const t0 = Date.now();
  const seen = new Set<string>();
  const out: Watch[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    let w = normalizeWatch(rec);
    if (!w) {
      const coerced = coerceLegacyWatchRecord(rec, t0 - i);
      w = normalizeWatch(coerced);
    }
    if (!w) continue;
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
  }
  return out;
}

function readNonEmptyLocalStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  const s = window.localStorage.getItem(key);
  return s && s.trim() ? s : null;
}

function logWristfolioStorageDev(info: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info("[Wristfolio storage]", info);
  }
}

export type WatchStorageLoadIssue =
  | { kind: "invalid_json"; key: string }
  | { kind: "unreadable_entries"; key: string; skippedCount: number };

export type LoadWatchesFromLocalStorageResult = {
  watches: Watch[];
  /** Storage key that supplied the loaded list, or null if nothing usable was found. */
  sourceKey: string | null;
  migrationPerformed: boolean;
  /**
   * When true, do not persist an empty watch list — avoids overwriting recoverable or invalid raw data.
   * Clears once the in-memory collection has at least one watch.
   */
  blockEmptyPersist: boolean;
  issue: WatchStorageLoadIssue | null;
};

const emptyLoadResult: LoadWatchesFromLocalStorageResult = {
  watches: [],
  sourceKey: null,
  migrationPerformed: false,
  blockEmptyPersist: false,
  issue: null,
};

export function watchStorageIssueUserMessage(issue: WatchStorageLoadIssue): string {
  if (issue.kind === "invalid_json") {
    return `Your saved collection could not be read. The raw data is still in this browser under “${issue.key}” — it was not deleted. Try importing a JSON backup, or ask someone technical to repair the stored text.`;
  }
  return `${issue.skippedCount} saved ${issue.skippedCount === 1 ? "entry" : "entries"} could not be read. The original data is still stored locally — try a JSON backup import, or remove the broken entries manually via devtools if you know how.`;
}

/**
 * Read watch list from localStorage only (no writes). Scans canonical + legacy keys.
 */
export function readWatchCollectionFromLocalStorage(): LoadWatchesFromLocalStorageResult {
  if (typeof window === "undefined") {
    return { ...emptyLoadResult };
  }

  const orderedKeys = [WATCHES_STORAGE_KEY, ...LEGACY_WATCH_STORAGE_KEYS] as const;
  let primaryParseFailedInScan = false;

  for (const key of orderedKeys) {
    const rawStr = readNonEmptyLocalStorageValue(key);
    if (!rawStr) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawStr) as unknown;
    } catch {
      if (key === WATCHES_STORAGE_KEY) primaryParseFailedInScan = true;
      continue;
    }
    const watches = normalizeWatchList(parsed);
    if (watches.length > 0) {
      logWristfolioStorageDev({
        storageKeyUsed: key,
        watchesLoaded: watches.length,
        migrationPerformed: false,
        source: "localStorage-scan",
      });
      return {
        watches,
        sourceKey: key,
        migrationPerformed: false,
        blockEmptyPersist: false,
        issue: null,
      };
    }
  }

  const primaryStr = readNonEmptyLocalStorageValue(WATCHES_STORAGE_KEY);
  let primaryParsed: unknown | undefined = undefined;
  let primaryJsonInvalid = primaryParseFailedInScan;

  if (primaryStr && !primaryJsonInvalid) {
    try {
      primaryParsed = JSON.parse(primaryStr) as unknown;
    } catch {
      primaryJsonInvalid = true;
    }
  }

  if (primaryJsonInvalid) {
    logWristfolioStorageDev({
      storageKeyUsed: null,
      watchesLoaded: 0,
      migrationPerformed: false,
      issue: "invalid_json_primary",
      source: "localStorage-scan",
    });
    return {
      watches: [],
      sourceKey: null,
      migrationPerformed: false,
      blockEmptyPersist: true,
      issue: { kind: "invalid_json", key: WATCHES_STORAGE_KEY },
    };
  }

  if (primaryStr) {
    const fromPrimary = normalizeWatchList(primaryParsed);
    if (Array.isArray(primaryParsed) && primaryParsed.length > 0 && fromPrimary.length === 0) {
      logWristfolioStorageDev({
        storageKeyUsed: WATCHES_STORAGE_KEY,
        watchesLoaded: 0,
        migrationPerformed: false,
        issue: "unreadable_entries",
        skippedCount: primaryParsed.length,
        source: "localStorage-scan",
      });
      return {
        watches: [],
        sourceKey: WATCHES_STORAGE_KEY,
        migrationPerformed: false,
        blockEmptyPersist: true,
        issue: {
          kind: "unreadable_entries",
          key: WATCHES_STORAGE_KEY,
          skippedCount: primaryParsed.length,
        },
      };
    }
    logWristfolioStorageDev({
      storageKeyUsed: WATCHES_STORAGE_KEY,
      watchesLoaded: fromPrimary.length,
      migrationPerformed: false,
      source: "localStorage-scan",
    });
    return {
      watches: fromPrimary,
      sourceKey: WATCHES_STORAGE_KEY,
      migrationPerformed: false,
      blockEmptyPersist: false,
      issue: null,
    };
  }

  logWristfolioStorageDev({
    storageKeyUsed: null,
    watchesLoaded: 0,
    migrationPerformed: false,
    note: "no_saved_collection_localStorage",
    source: "localStorage-scan",
  });
  return { ...emptyLoadResult };
}

/** Load from localStorage and copy legacy lists into the canonical localStorage key (does not touch IndexedDB). */
export function loadWatchesFromLocalStorage(): LoadWatchesFromLocalStorageResult {
  const r = readWatchCollectionFromLocalStorage();
  if (r.watches.length > 0 && r.sourceKey && r.sourceKey !== WATCHES_STORAGE_KEY && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(WATCHES_STORAGE_KEY, JSON.stringify(r.watches));
    } catch {
      /* migration copy failed */
    }
    return { ...r, migrationPerformed: true };
  }
  return r;
}

/** On-disk JSON shape; `watchvaultBackup` must stay for imports of older exports. */
export type BackupPayload = {
  watchvaultBackup: true;
  version: 1;
  exportedAt: string;
  collectionCurrency: CollectionCurrency;
  watches: Watch[];
};

/** Parsed backup plus embedded JPEG/base64 payloads keyed by watch id (from file). */
export type ParsedBackup = {
  /** Legacy marker field; required in file format. */
  watchvaultBackup: true;
  version: 1;
  exportedAt: string;
  collectionCurrency: CollectionCurrency;
  watches: Watch[];
  embeddedPhotos: { watchId: string; base64: string }[];
};

export function parseBackupJson(text: string): ParsedBackup | null {
  try {
    const data = JSON.parse(text) as Partial<BackupPayload> & { watches?: unknown[] };
    if (!data || data.watchvaultBackup !== true || data.version !== 1) return null;
    if (!Array.isArray(data.watches)) return null;
    const watches: Watch[] = [];
    const embeddedPhotos: { watchId: string; base64: string }[] = [];
    for (const item of data.watches) {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const b64 = typeof r.photoExportBase64 === "string" ? r.photoExportBase64 : undefined;
      const rest = { ...r };
      delete rest.photoExportBase64;
      let nw = normalizeWatch(rest);
      if (!nw) {
        nw = normalizeWatch(coerceLegacyWatchRecord(rest, Date.now()));
      }
      if (!nw) return null;
      watches.push(nw);
      if (b64) embeddedPhotos.push({ watchId: nw.id, base64: b64 });
    }
    const cur = data.collectionCurrency;
    const currency =
      cur === "GBP" || cur === "EUR" || cur === "USD" || cur === "CHF" || cur === "JPY" ? cur : "GBP";
    return {
      watchvaultBackup: true,
      version: 1,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
      collectionCurrency: currency,
      watches,
      embeddedPhotos,
    };
  } catch {
    return null;
  }
}
