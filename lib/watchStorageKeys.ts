/**
 * Browser storage key strings for Wristfolio.
 *
 * Legacy compatibility: the `watchvault-*` / `watchvault_*` **string values** below are unchanged so existing
 * localStorage data from the original app codename continues to load. Do not rename these literals without a
 * migration — that would orphan saved collections.
 */

/** Canonical localStorage key for the saved watch collection (JSON array of watches). */
export const WATCHES_STORAGE_KEY = "watchvault-watches";

/** Older keys — read for migration only; never delete automatically. */
export const LEGACY_WATCH_STORAGE_KEYS = [
  "watchvault_watches",
  "watchvault-watches-v0",
  "watchvault-watches-backup",
  "watchvault-collection-ls",
] as const;

/** Exported names are Wristfolio; string values stay `watchvault-*` for existing browser data. */
export const WRISTFOLIO_BACKUP_REMINDER_DAYS_KEY = "watchvault-backup-reminder-days";
export const WRISTFOLIO_BACKUP_LAST_EXPORTED_AT_KEY = "watchvault-backup-last-exported-at";
export const WRISTFOLIO_COLLECTION_CURRENCY_KEY = "watchvault-currency";
