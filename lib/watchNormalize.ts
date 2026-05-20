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

export type WatchTimelineEntryType = "purchased" | "serviced" | "regulated" | "strap_changed" | "sold" | "repaired";

export type WatchTimelineEntry = {
  id: string;
  type: WatchTimelineEntryType;
  date?: string;
  note: string;
  cost?: number;
};

export type WatchPhoto = {
  id: string;
  /** Preferred: blob stored in IndexedDB under this key */
  storageKey?: string;
  /** Legacy/data URL support */
  url?: string;
  caption?: string;
  isPrimary?: boolean;
  createdAt?: number;
};

export type Watch = {
  id: string;
  brand: string;
  model: string;
  /** New canonical field. `reference` is retained below as a legacy alias. */
  referenceNumber?: string;
  reference?: string;
  year?: string;
  serialNumber?: string;
  /** Case diameter or size notes, e.g. "40 mm" */
  caseSize?: string;
  lugToLug?: string;
  waterResistance?: string;
  /** Movement type or calibre notes */
  movement?: string;
  purchasePrice?: number;
  /** New canonical field. `estimatedValue` is retained as a legacy alias. */
  currentValue?: number;
  estimatedValue?: number;
  /** Free-form (e.g. YYYY-MM or "Spring 2019") */
  purchaseDate?: string;
  purchaseSource?: string;
  /** Seller, AD, or provenance notes */
  seller?: string;
  complicationStyle?: string;
  condition?: WatchCondition;
  boxPapers?: WatchBoxPapers;
  serviceHistoryNotes?: string;
  serviceHistory?: string;
  provenanceNotes?: string;
  notes?: string;
  timeline?: WatchTimelineEntry[];
  wearCount?: number;
  lastWornDate?: string;
  photos?: WatchPhoto[];
  primaryPhotoId?: string;
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

function parseStringField(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function isTimelineEntryType(v: unknown): v is WatchTimelineEntryType {
  return (
    v === "purchased" ||
    v === "serviced" ||
    v === "regulated" ||
    v === "strap_changed" ||
    v === "sold" ||
    v === "repaired"
  );
}

function normalizeTimeline(raw: unknown): WatchTimelineEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WatchTimelineEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const note = parseStringField(r.note);
    const type = isTimelineEntryType(r.type) ? r.type : undefined;
    if (!note || !type) continue;
    out.push({
      id: parseStringField(r.id) ?? crypto.randomUUID(),
      type,
      date: parseStringField(r.date),
      note,
      cost: parseNumericField(r.cost),
    });
  }
  return out.length ? out : undefined;
}

function normalizePhotos(raw: unknown, legacy: { photoStorageKey?: string; photoUrl?: string }): WatchPhoto[] | undefined {
  const out: WatchPhoto[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const storageKey = parseStringField(r.storageKey);
      const url = parseStringField(r.url);
      if (!storageKey && !url) continue;
      out.push({
        id: parseStringField(r.id) ?? storageKey ?? crypto.randomUUID(),
        storageKey,
        url,
        caption: parseStringField(r.caption),
        isPrimary: typeof r.isPrimary === "boolean" ? r.isPrimary : undefined,
        createdAt: typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : undefined,
      });
    }
  }
  if (legacy.photoStorageKey || legacy.photoUrl) {
    const legacyId = legacy.photoStorageKey ?? "legacy-primary";
    if (!out.some((p) => p.storageKey === legacy.photoStorageKey || p.url === legacy.photoUrl)) {
      out.unshift({
        id: legacyId,
        storageKey: legacy.photoStorageKey,
        url: legacy.photoUrl,
        isPrimary: true,
      });
    }
  }
  if (out.length && !out.some((p) => p.isPrimary)) {
    out[0] = { ...out[0], isPrimary: true };
  }
  return out.length ? out : undefined;
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

  const cur = parseNumericField(w.currentValue ?? w.estimatedValue);
  if (cur !== undefined) {
    w.currentValue = cur;
    w.estimatedValue = cur;
  }

  if (typeof w.brand !== "string" && w.brand != null) w.brand = String(w.brand);
  if (typeof w.model !== "string" && w.model != null) w.model = String(w.model);
  if (typeof w.id !== "string" && w.id != null) w.id = String(w.id);

  if (typeof w.referenceNumber !== "string" && typeof w.reference === "string") w.referenceNumber = w.reference;
  if (typeof w.purchaseSource !== "string" && typeof w.seller === "string") w.purchaseSource = w.seller;
  if (typeof w.serviceHistoryNotes !== "string" && typeof w.serviceHistory === "string") {
    w.serviceHistoryNotes = w.serviceHistory;
  }

  return w;
}

export function normalizeWatch(raw: unknown): Watch | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || typeof w.brand !== "string" || typeof w.model !== "string") return null;
  if (typeof w.createdAt !== "number" || !Number.isFinite(w.createdAt)) return null;

  const photoUrl = typeof w.photoUrl === "string" ? w.photoUrl : undefined;
  const photoStorageKey = typeof w.photoStorageKey === "string" ? w.photoStorageKey : undefined;
  const referenceNumber = parseStringField(w.referenceNumber) ?? parseStringField(w.reference);
  const currentValue = parseNumericField(w.currentValue ?? w.estimatedValue);
  const purchaseSource = parseStringField(w.purchaseSource) ?? parseStringField(w.seller);
  const serviceHistoryNotes = parseStringField(w.serviceHistoryNotes) ?? (typeof w.serviceHistory === "string" ? w.serviceHistory : undefined);
  const photos = normalizePhotos(w.photos, { photoStorageKey, photoUrl });
  const primaryPhotoId =
    parseStringField(w.primaryPhotoId) ?? photos?.find((p) => p.isPrimary)?.id ?? photos?.[0]?.id ?? undefined;

  return {
    id: w.id,
    brand: w.brand,
    model: w.model,
    referenceNumber,
    reference: referenceNumber,
    year: typeof w.year === "string" ? w.year : undefined,
    serialNumber: typeof w.serialNumber === "string" ? w.serialNumber : undefined,
    caseSize: typeof w.caseSize === "string" && w.caseSize.trim() ? w.caseSize.trim() : undefined,
    lugToLug: parseStringField(w.lugToLug),
    waterResistance: parseStringField(w.waterResistance),
    movement: typeof w.movement === "string" && w.movement.trim() ? w.movement.trim() : undefined,
    purchasePrice: typeof w.purchasePrice === "number" && Number.isFinite(w.purchasePrice) ? w.purchasePrice : undefined,
    currentValue,
    estimatedValue: currentValue,
    purchaseDate: typeof w.purchaseDate === "string" && w.purchaseDate.trim() ? w.purchaseDate.trim() : undefined,
    purchaseSource,
    seller: purchaseSource,
    complicationStyle: parseStringField(w.complicationStyle),
    condition: isWatchCondition(w.condition) ? w.condition : undefined,
    boxPapers: isWatchBoxPapers(w.boxPapers) ? w.boxPapers : undefined,
    serviceHistoryNotes,
    serviceHistory: serviceHistoryNotes,
    provenanceNotes: parseStringField(w.provenanceNotes),
    notes: typeof w.notes === "string" ? w.notes : undefined,
    timeline: normalizeTimeline(w.timeline),
    wearCount: typeof w.wearCount === "number" && Number.isFinite(w.wearCount) ? Math.max(0, Math.trunc(w.wearCount)) : undefined,
    lastWornDate: parseStringField(w.lastWornDate),
    photos,
    primaryPhotoId,
    photoUrl,
    photoStorageKey,
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
    console.info("[HoroLair storage]", info);
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
  embeddedPhotos: { watchId: string; photoId?: string; base64: string }[];
};

export function parseBackupJson(text: string): ParsedBackup | null {
  try {
    const data = JSON.parse(text) as Partial<BackupPayload> & { watches?: unknown[] };
    if (!data || data.watchvaultBackup !== true || data.version !== 1) return null;
    if (!Array.isArray(data.watches)) return null;
    const watches: Watch[] = [];
    const embeddedPhotos: { watchId: string; photoId?: string; base64: string }[] = [];
    for (const item of data.watches) {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const b64 = typeof r.photoExportBase64 === "string" ? r.photoExportBase64 : undefined;
      const b64List = Array.isArray(r.photoExportsBase64) ? r.photoExportsBase64 : [];
      const rest = { ...r };
      delete rest.photoExportBase64;
      delete rest.photoExportsBase64;
      let nw = normalizeWatch(rest);
      if (!nw) {
        nw = normalizeWatch(coerceLegacyWatchRecord(rest, Date.now()));
      }
      if (!nw) return null;
      watches.push(nw);
      if (b64 && b64List.length === 0) embeddedPhotos.push({ watchId: nw.id, base64: b64 });
      for (const photo of b64List) {
        if (!photo || typeof photo !== "object") continue;
        const pr = photo as Record<string, unknown>;
        if (typeof pr.base64 !== "string") continue;
        embeddedPhotos.push({
          watchId: nw.id,
          photoId: typeof pr.photoId === "string" ? pr.photoId : undefined,
          base64: pr.base64,
        });
      }
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
