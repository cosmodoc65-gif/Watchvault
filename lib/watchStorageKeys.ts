/**
 * Single source of truth for WatchVault browser storage keys.
 * Import these constants instead of hardcoding string literals.
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

export const WATCHVAULT_BACKUP_REMINDER_DAYS_KEY = "watchvault-backup-reminder-days";
export const WATCHVAULT_BACKUP_LAST_EXPORTED_AT_KEY = "watchvault-backup-last-exported-at";
export const WATCHVAULT_COLLECTION_CURRENCY_KEY = "watchvault-currency";
