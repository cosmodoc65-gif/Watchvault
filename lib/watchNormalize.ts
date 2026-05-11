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

export function normalizeWatch(raw: unknown): Watch | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || typeof w.brand !== "string" || typeof w.model !== "string") return null;
  if (typeof w.createdAt !== "number") return null;

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
  return raw.map(normalizeWatch).filter(Boolean) as Watch[];
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
      const nw = normalizeWatch(rest);
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
