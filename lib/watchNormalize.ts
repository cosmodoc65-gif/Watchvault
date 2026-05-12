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

/** Primary key for persisted watch list (unchanged across WatchVault versions). */
export const WATCHES_STORAGE_KEY = "watchvault-watches";

/** Older experiments / forks — only used if canonical key yields no watches after normalize. */
export const LEGACY_WATCH_STORAGE_KEYS = ["watchvault_watches", "watchvault-watches-v0"] as const;

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

/**
 * Read watch list from localStorage (primary + legacy keys).
 * First key whose value normalizes to a non-empty list wins.
 * Does not write or clear anything.
 */
export function readWatchListJsonFromLocalStorage(): { watches: Watch[]; sourceKey: string } | null {
  if (typeof window === "undefined") return null;

  const tryParse = (key: string): unknown | null => {
    const s = window.localStorage.getItem(key);
    if (!s || !s.trim()) return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };

  const orderedKeys = [WATCHES_STORAGE_KEY, ...LEGACY_WATCH_STORAGE_KEYS] as const;
  for (const key of orderedKeys) {
    const raw = tryParse(key);
    if (raw === null) continue;
    const watches = normalizeWatchList(raw);
    if (watches.length > 0) {
      return { watches, sourceKey: key };
    }
  }

  const primary = tryParse(WATCHES_STORAGE_KEY);
  if (primary !== null) {
    return { watches: normalizeWatchList(primary), sourceKey: WATCHES_STORAGE_KEY };
  }
  return null;
}

/** Load and migrate watches from localStorage (browser only). */
export function loadWatchesFromLocalStorage(): Watch[] {
  if (typeof window === "undefined") return [];
  const parsed = readWatchListJsonFromLocalStorage();
  if (!parsed) return [];
  const { watches, sourceKey } = parsed;
  if (watches.length > 0 && sourceKey !== WATCHES_STORAGE_KEY) {
    try {
      window.localStorage.setItem(WATCHES_STORAGE_KEY, JSON.stringify(watches));
    } catch {
      /* caller may surface storage full */
    }
  }
  return watches;
}

export type BackupPayload = {
  watchvaultBackup: true;
  version: 1;
  exportedAt: string;
  collectionCurrency: CollectionCurrency;
  watches: Watch[];
};

/** Parsed backup plus embedded JPEG/base64 payloads keyed by watch id (from file). */
export type ParsedBackup = {
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
