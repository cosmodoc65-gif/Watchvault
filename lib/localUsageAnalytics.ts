export const LOCAL_USAGE_COUNTERS_KEY = "horolair-local-usage-counters";
export const LOCAL_USAGE_COUNTERS_UPDATED_EVENT = "horolair-local-usage-counters-updated";

export const LOCAL_USAGE_COUNTER_KEYS = ["addWatchClicks", "watchesSaved", "imageUploads", "pdfExports", "wishlistAdds"] as const;
export type LocalUsageCounterKey = (typeof LOCAL_USAGE_COUNTER_KEYS)[number];
export type LocalUsageCounters = Record<LocalUsageCounterKey, number>;

export const EMPTY_LOCAL_USAGE_COUNTERS: LocalUsageCounters = {
  addWatchClicks: 0,
  watchesSaved: 0,
  imageUploads: 0,
  pdfExports: 0,
  wishlistAdds: 0,
};

export function normalizeLocalUsageCounters(value: unknown): LocalUsageCounters {
  const source = value && typeof value === "object" ? (value as Partial<Record<LocalUsageCounterKey, unknown>>) : {};
  return LOCAL_USAGE_COUNTER_KEYS.reduce<LocalUsageCounters>((acc, key) => {
    const n = Number(source[key]);
    acc[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return acc;
  }, { ...EMPTY_LOCAL_USAGE_COUNTERS });
}

export function readLocalUsageCounters(): LocalUsageCounters {
  if (typeof window === "undefined") return { ...EMPTY_LOCAL_USAGE_COUNTERS };
  try {
    return normalizeLocalUsageCounters(JSON.parse(window.localStorage.getItem(LOCAL_USAGE_COUNTERS_KEY) ?? "{}"));
  } catch {
    return { ...EMPTY_LOCAL_USAGE_COUNTERS };
  }
}

export function writeLocalUsageCounters(counters: LocalUsageCounters) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_USAGE_COUNTERS_KEY, JSON.stringify(counters));
    window.dispatchEvent(new CustomEvent(LOCAL_USAGE_COUNTERS_UPDATED_EVENT, { detail: counters }));
  } catch {
    /* local debug counters are best-effort only */
  }
}

export function incrementLocalUsageCounter(key: LocalUsageCounterKey): LocalUsageCounters {
  const next = readLocalUsageCounters();
  next[key] += 1;
  writeLocalUsageCounters(next);
  if (process.env.NODE_ENV === "development") {
    console.info("[HoroLair analytics]", { event: key, value: next[key], counters: next });
  }
  return next;
}
