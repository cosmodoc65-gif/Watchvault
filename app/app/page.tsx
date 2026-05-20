"use client";

import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { base64ToBlob } from "@/lib/backupEncoding";
import { compressImageFile } from "@/lib/imageCompress";
import { buildBackupJsonString, buildCollectionCsv } from "@/lib/backupFormats";
import { downloadWristfolioCollectionPdf } from "@/lib/collectionPdf";
import { inspectWristfolioStorageReadonly, loadWatchesFromAllSources, persistWatchCollection } from "@/lib/watchCollectionStorage";
import {
  ALL_WATCH_BOXPAPERS,
  ALL_WATCH_CONDITIONS,
  BOXPAPERS_LABELS,
  CONDITION_LABELS,
  type CollectionCurrency,
  type ParsedBackup,
  type Watch,
  type WatchBoxPapers,
  type WatchCondition,
  type WatchPhoto,
  type WatchStorageLoadIssue,
  type WatchTimelineEntry,
  type WatchTimelineEntryType,
  parseBackupJson,
  watchStorageIssueUserMessage,
} from "@/lib/watchNormalize";
import {
  WRISTFOLIO_BACKUP_LAST_EXPORTED_AT_KEY,
  WRISTFOLIO_BACKUP_REMINDER_DAYS_KEY,
  WRISTFOLIO_COLLECTION_CURRENCY_KEY,
} from "@/lib/watchStorageKeys";
import { deleteWatchImage, getWatchImageBlob, saveWatchImage } from "@/lib/wristfolioIdb";
import { incrementLocalUsageCounter, type LocalUsageCounterKey } from "@/lib/localUsageAnalytics";

const FEEDBACK_MAILTO =
  "mailto:DrASchuter@proton.me?subject=" +
  encodeURIComponent("HoroLair beta feedback") +
  "&body=" +
  encodeURIComponent("Hi, I tested HoroLair and my feedback is…");

function triggerTextDownload(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getDemoWatches(): Watch[] {
  const t = Date.now();
  return [
    {
      id: crypto.randomUUID(),
      brand: "Patek Philippe",
      model: "Calatrava",
      referenceNumber: "5226G-001",
      reference: "5226G-001",
      year: "2023",
      serialNumber: "DEMO-PP-001",
      purchasePrice: 38000,
      currentValue: 42000,
      estimatedValue: 42000,
      purchaseDate: "2023-06",
      purchaseSource: "Authorised dealer",
      movement: "Automatic calibre 26-330",
      caseSize: "40 mm",
      lugToLug: "47 mm",
      waterResistance: "30 m",
      complicationStyle: "Dress",
      condition: "excellent",
      boxPapers: "full_set",
      serviceHistoryNotes: "Demo sample — timing checked 2024.",
      serviceHistory: "Demo sample — timing checked 2024.",
      provenanceNotes: "Demo provenance note.",
      notes: "Sample entry for the private beta. Clear demo watches anytime.",
      timeline: [
        { id: crypto.randomUUID(), type: "purchased", date: "2023-06", note: "Added as a full set demo purchase." },
        { id: crypto.randomUUID(), type: "regulated", date: "2024-03", note: "Timing checked for the archive." },
      ],
      wearCount: 12,
      lastWornDate: todayIsoDate(),
      createdAt: t - 5000,
      isDemo: true,
    },
    {
      id: crypto.randomUUID(),
      brand: "Rolex",
      model: "Submariner Date",
      referenceNumber: "126610LN",
      reference: "126610LN",
      year: "2022",
      currentValue: 11500,
      estimatedValue: 11500,
      movement: "Automatic calibre 3235",
      caseSize: "41 mm",
      waterResistance: "300 m",
      complicationStyle: "Diver",
      condition: "very_good",
      boxPapers: "full_set",
      serviceHistoryNotes: "Demo — no real service history.",
      serviceHistory: "Demo — no real service history.",
      notes: "Demo sample.",
      wearCount: 24,
      lastWornDate: "2026-05-18",
      createdAt: t - 4000,
      isDemo: true,
    },
    {
      id: crypto.randomUUID(),
      brand: "Omega",
      model: "Speedmaster Professional",
      referenceNumber: "310.30.42.50.01.001",
      reference: "310.30.42.50.01.001",
      year: "2021",
      purchasePrice: 5200,
      currentValue: 5800,
      estimatedValue: 5800,
      movement: "Manual-wind calibre 3861",
      caseSize: "42 mm",
      complicationStyle: "Chronograph",
      condition: "good",
      boxPapers: "box_only",
      notes: "Demo sample — moonwatch vibes.",
      wearCount: 8,
      lastWornDate: "2026-05-10",
      createdAt: t - 3000,
      isDemo: true,
    },
  ];
}

function remapIncomingForMerge(existing: Watch[], incoming: Watch[]): { watches: Watch[]; idMap: Map<string, string> } {
  const used = new Set(existing.map((w) => w.id));
  const idMap = new Map<string, string>();
  const watches = incoming.map((w) => {
    let id = w.id;
    if (used.has(id)) {
      const newId = crypto.randomUUID();
      idMap.set(w.id, newId);
      id = newId;
    }
    used.add(id);
    return { ...w, id, isDemo: false, createdAt: w.createdAt };
  });
  return { watches, idMap };
}

const vaultSerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const CURRENCIES: { code: CollectionCurrency; label: string }[] = [
  { code: "GBP", label: "GBP (£)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "USD", label: "USD ($)" },
  { code: "CHF", label: "CHF (CHF)" },
  { code: "JPY", label: "JPY (¥)" },
];

const DEFAULT_CURRENCY: CollectionCurrency = "GBP";

const LOCALE_BY_CURRENCY: Record<CollectionCurrency, string> = {
  GBP: "en-GB",
  EUR: "de-DE",
  USD: "en-US",
  CHF: "de-CH",
  JPY: "ja-JP",
};

function isCollectionCurrency(v: string | null): v is CollectionCurrency {
  return v === "GBP" || v === "EUR" || v === "USD" || v === "CHF" || v === "JPY";
}

function formatCollectionCurrency(value: number, currency: CollectionCurrency): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function previewValueDisplay(raw: string, currency: CollectionCurrency): string {
  const n = Number(raw.replace(/[^\d]/g, ""));
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) return "—";
  return formatCollectionCurrency(n, currency);
}

function classNames(...values: Array<string | false | undefined | null>) {
  return values.filter(Boolean).join(" ");
}

/**
 * Champagne / warm brushed gold — hue shifted toward ~42–44 (less orange than legacy 34–36), borders kept light enough
 * for laptop legibility on near-black. Restrained highlights, no glossy specular band.
 */
const gold = {
  frame:
    "border-2 border-[hsla(43,44%,64%,0.96)] bg-white/[0.04] shadow-[inset_0_1px_0_0_hsla(44,40%,76%,0.26),0_0_0_1px_rgba(0,0,0,0.52),0_12px_44px_-14px_hsla(42,36%,10%,0.46)]",
  frameLg:
    "border-2 border-[hsla(42,42%,60%,0.94)] bg-white/[0.04] shadow-[inset_0_1px_0_0_hsla(43,36%,70%,0.22),0_0_0_1px_rgba(0,0,0,0.56),0_14px_52px_-16px_hsla(41,34%,9%,0.48)]",
  cardHover:
    "transition duration-300 ease-out hover:border-[hsla(44,46%,68%,0.98)] hover:bg-white/[0.05] hover:shadow-[inset_0_1px_0_0_hsla(45,42%,76%,0.24),0_0_0_1px_hsla(42,34%,32%,0.44),0_22px_58px_-18px_hsla(40,36%,8%,0.5)] hover:-translate-y-0.5",
  focus:
    "focus:border-[hsla(44,46%,66%,0.98)] focus:ring-2 focus:ring-[hsla(43,42%,46%,0.5)] focus:ring-offset-2 focus:ring-offset-[#070708]",
  input:
    "rounded-2xl border-2 border-[hsla(42,40%,54%,0.92)] bg-black/45 px-4 py-3 text-sm text-white/92 outline-none placeholder:text-white/42",
  tag: "rounded-lg border-2 border-[hsla(42,38%,56%,0.9)] bg-black/38 px-2.5 py-1.5 text-[13px] font-medium leading-snug text-white/90 shadow-[inset_0_1px_0_0_hsla(44,34%,64%,0.16)]",
  tagSoft:
    "rounded-full border border-[hsla(42,32%,52%,0.5)] bg-black/34 px-2.5 py-1 text-[11px] font-medium leading-snug tracking-wide text-white/72 shadow-[inset_0_1px_0_0_hsla(44,28%,64%,0.1)]",
  statCell:
    "rounded-xl border-2 border-[hsla(42,38%,54%,0.9)] bg-black/42 px-3 py-2 shadow-[inset_0_1px_0_0_hsla(43,34%,62%,0.16),0_6px_22px_-14px_hsla(42,34%,8%,0.44)]",
  btnPrimary:
    "rounded-2xl border-2 border-[hsla(44,48%,64%,0.98)] bg-gradient-to-b from-[hsla(42,34%,22%,0.97)] via-[hsla(40,29%,14%,0.95)] to-[hsla(38,26%,9%,0.94)] px-5 py-3 text-sm font-semibold tracking-wide text-[hsla(46,50%,97%,0.99)] shadow-[inset_0_1px_0_0_hsla(44,40%,72%,0.36)] transition hover:border-[hsla(45,50%,70%,0.99)] hover:shadow-[inset_0_1px_0_0_hsla(46,42%,78%,0.22),0_0_36px_-12px_hsla(42,44%,22%,0.46)]",
  btnSecondary:
    "rounded-2xl border-2 border-[hsla(42,40%,56%,0.92)] bg-black/48 px-5 py-3 text-sm font-semibold tracking-wide text-white/93 shadow-[inset_0_1px_0_0_hsla(43,32%,62%,0.17)] transition hover:border-[hsla(44,44%,64%,0.97)] hover:bg-black/56 hover:text-white",
  btnSmPrimary:
    "rounded-xl border-2 border-[hsla(44,46%,62%,0.97)] bg-gradient-to-b from-[hsla(42,32%,19%,0.96)] to-[hsla(38,25%,10%,0.94)] px-3 py-2 text-xs font-semibold tracking-wide text-[hsla(46,48%,96%,0.99)] shadow-[inset_0_1px_0_0_hsla(44,36%,68%,0.32)] transition hover:border-[hsla(45,50%,68%,0.99)] hover:shadow-[0_0_28px_-10px_hsla(42,42%,20%,0.42)]",
  btnSmSecondary:
    "rounded-xl border-2 border-[hsla(42,38%,54%,0.9)] bg-black/52 px-3 py-2 text-xs font-medium tracking-wide text-white/92 transition hover:border-[hsla(44,44%,62%,0.96)] hover:bg-black/60",
  pill:
    "rounded-full border-2 border-[hsla(42,42%,58%,0.92)] bg-black/40 px-3 py-1.5 text-[12px] font-semibold tracking-widest text-white/88 shadow-[inset_0_1px_0_0_hsla(44,34%,66%,0.17)]",
};

const ADD_WATCH_STEP_COUNT = 4;

type MainNavView = "dashboard" | "add-watch" | "collection";
type CollectionDisplayMode = "grid" | "compact";
type CollectionFilter = "all" | "service" | "missing-values" | "most-worn";

const TIMELINE_ENTRY_LABELS: Record<WatchTimelineEntryType, string> = {
  purchased: "Purchased",
  serviced: "Serviced",
  regulated: "Regulated",
  strap_changed: "Strap changed",
  sold: "Sold",
  repaired: "Repaired",
};

const TIMELINE_ENTRY_TYPES: WatchTimelineEntryType[] = [
  "purchased",
  "serviced",
  "regulated",
  "strap_changed",
  "sold",
  "repaired",
];

function getWatchReference(watch: Watch): string | undefined {
  return watch.referenceNumber ?? watch.reference;
}

function getWatchCurrentValue(watch: Watch): number | undefined {
  return watch.currentValue ?? watch.estimatedValue;
}

function getWatchPurchaseSource(watch: Watch): string | undefined {
  return watch.purchaseSource ?? watch.seller;
}

function getWatchServiceNotes(watch: Watch): string | undefined {
  return watch.serviceHistoryNotes ?? watch.serviceHistory;
}

function getPrimaryPhoto(watch: Watch): WatchPhoto | undefined {
  return watch.photos?.find((p) => p.id === watch.primaryPhotoId) ?? watch.photos?.find((p) => p.isPrimary) ?? watch.photos?.[0];
}

function daysSinceDate(date?: string): number | undefined {
  if (!date) return undefined;
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function formatDaysSinceLastWorn(date?: string): string {
  const days = daysSinceDate(date);
  if (days === undefined) return "Not tracked";
  if (days === 0) return "Worn today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Horology-inspired mark: case + dial ring + twelve index + single hand — minimal, not illustrative. */
function VaultMark({ className }: { className?: string }) {
  const gid = `wfMarkGold-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="7" y1="6" x2="35" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(46, 46%, 92%)" />
          <stop offset="0.45" stopColor="hsl(43, 36%, 72%)" />
          <stop offset="1" stopColor="hsl(40, 34%, 52%)" />
        </linearGradient>
      </defs>
      <rect x="6.25" y="6.25" width="27.5" height="27.5" rx="6.25" stroke={`url(#${gid})`} strokeWidth="1.2" />
      <circle cx="20" cy="20.25" r="9" stroke={`url(#${gid})`} strokeWidth="0.75" opacity="0.42" />
      <path d="M20 11.75v2.35" stroke={`url(#${gid})`} strokeWidth="1.05" strokeLinecap="round" opacity="0.92" />
      <path d="M20 20.25l-5.1-4.35" stroke={`url(#${gid})`} strokeWidth="1.1" strokeLinecap="round" opacity="0.95" />
      <circle cx="20" cy="20.25" r="1.2" fill={`url(#${gid})`} opacity="0.98" />
    </svg>
  );
}

function CurrencyDropdown({
  value,
  onChange,
}: {
  value: CollectionCurrency;
  onChange: (c: CollectionCurrency) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(() => CURRENCIES.findIndex((c) => c.code === value));
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const i = CURRENCIES.findIndex((c) => c.code === value);
    if (i >= 0) setHighlight(i);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      listRef.current?.focus();
      const opts = listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]');
      const el = opts?.[highlight];
      el?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, highlight]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = useCallback(
    (code: CollectionCurrency) => {
      onChange(code);
      setOpen(false);
      btnRef.current?.focus();
    },
    [onChange],
  );

  const onKeyDownBtn = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => {
        const next = e.key === "ArrowDown" ? h + 1 : h - 1;
        return Math.max(0, Math.min(CURRENCIES.length - 1, next));
      });
    }
  };

  const onKeyDownList = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(CURRENCIES.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const c = CURRENCIES[highlight];
      if (c) pick(c.code);
    }
  };

  const current = CURRENCIES.find((c) => c.code === value)?.label ?? value;

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        id="currency-dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="currency-dropdown-list"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDownBtn}
        className={classNames(
          "flex w-full min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-xl border-2 border-[hsla(42,36%,48%,0.9)] bg-black/45 px-3 py-2.5 text-left text-sm text-white/92 outline-none transition",
          "hover:border-[hsla(44,40%,58%,0.96)] focus-visible:border-[hsla(44,40%,58%,0.96)] focus-visible:ring-2 focus-visible:ring-[hsla(43,38%,40%,0.48)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070708]",
        )}
      >
        <span className="truncate">{current}</span>
        <span className="shrink-0 text-[11px] text-[hsla(44,32%,62%,0.9)]" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <ul
          id="currency-dropdown-list"
          role="listbox"
          aria-labelledby="currency-dropdown-button"
          tabIndex={-1}
          onKeyDown={onKeyDownList}
          ref={listRef}
          className={classNames(
            "absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-xl border-2 border-[hsla(44,40%,58%,0.95)] bg-[#0a0a0c] py-1 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.85)] outline-none",
          )}
        >
          {CURRENCIES.map((c, i) => (
            <li key={c.code} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={c.code === value}
                className={classNames(
                  "flex w-full min-h-[44px] items-center px-3 py-2.5 text-left text-sm transition",
                  i === highlight ? "bg-white/[0.08] text-white" : "text-white/88",
                  c.code === value ? "font-semibold text-[hsla(46,48%,94%,0.98)]" : "font-normal",
                  "hover:bg-white/[0.06] hover:text-white",
                )}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(c.code)}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Placeholder({ compact = false, label = "No photo" }: { compact?: boolean; label?: string }) {
  return (
    <div
      className={classNames(
        "flex h-full w-full items-center justify-center rounded-xl bg-[radial-gradient(circle_at_50%_38%,rgba(232,202,137,0.12),transparent_42%),linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.28))]",
        gold.frame,
      )}
    >
      <div className="text-center">
        <div
          className={classNames(
            "mx-auto rounded-full bg-black/30",
            compact ? "h-6 w-6" : "mb-2 h-10 w-10",
            "border-2 border-[hsla(42,34%,50%,0.85)] shadow-[inset_0_1px_0_0_hsla(44,28%,58%,0.14)]",
          )}
        />
        {compact ? null : <p className="text-[13px] font-medium tracking-wide text-white/62">{label}</p>}
      </div>
    </div>
  );
}

type EditorialImageVariant = "thumbnail" | "card" | "detail" | "preview";

function EditorialWatchImage({
  src,
  alt,
  variant,
  className,
  interactive = false,
}: {
  src?: string;
  alt: string;
  variant: EditorialImageVariant;
  className?: string;
  interactive?: boolean;
}) {
  const compact = variant === "thumbnail";

  return (
    <div
      className={classNames(
        "relative overflow-hidden bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.08),transparent_42%),linear-gradient(180deg,rgba(9,9,10,0.94),rgba(2,2,3,0.98))]",
        variant === "thumbnail" ? "h-14 w-14 shrink-0 rounded-xl border border-[hsla(42,34%,54%,0.5)]" : "",
        variant === "card" ? "aspect-[4/3] w-full" : "",
        variant === "detail" ? "h-full w-full" : "",
        variant === "preview" ? "h-full w-full rounded-xl" : "",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={classNames(
            "h-full w-full object-cover opacity-[0.92] grayscale saturate-[0.42] brightness-[0.78] contrast-[1.16]",
            interactive ? "transition duration-500 ease-out group-hover:scale-[1.025] group-hover:opacity-100" : "",
          )}
        />
      ) : (
        <Placeholder compact={compact} />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_34%,rgba(0,0,0,0.34)_82%),linear-gradient(180deg,rgba(0,0,0,0.06),rgba(0,0,0,0.46)_100%)]" />
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-[hsla(44,42%,76%,0.36)] to-transparent" />
    </div>
  );
}

function MetadataTag({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <div className="rounded-2xl border border-[hsla(42,30%,54%,0.32)] bg-black/32 px-3 py-2 shadow-[inset_0_1px_0_0_hsla(44,28%,68%,0.09)] backdrop-blur-sm">
      <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,34%,70%,0.62)]">{label}</p>
      <p className="mt-1 max-w-[11rem] truncate text-[12px] font-medium leading-tight text-white/84">{value}</p>
    </div>
  );
}

function EmptyVaultIllustration({ className }: { className?: string }) {
  return (
    <div
      className={classNames(
        "relative mx-auto flex aspect-square w-28 items-center justify-center rounded-full border border-[hsla(42,38%,56%,0.48)] bg-[radial-gradient(circle_at_50%_40%,hsla(44,42%,64%,0.14),transparent_48%),linear-gradient(145deg,rgba(255,255,255,0.04),rgba(0,0,0,0.38))] shadow-[inset_0_1px_0_0_hsla(44,34%,70%,0.12),0_24px_60px_-38px_hsla(42,44%,24%,0.74)]",
        className,
      )}
      aria-hidden
    >
      <div className="absolute inset-4 rounded-full border border-[hsla(44,38%,64%,0.38)]" />
      <div className="absolute top-5 h-4 w-px rounded-full bg-[hsla(44,46%,72%,0.64)]" />
      <div className="h-px w-10 origin-right -rotate-[28deg] rounded-full bg-[hsla(44,42%,72%,0.58)]" />
      <div className="absolute bottom-6 h-px w-12 rounded-full bg-gradient-to-r from-transparent via-[hsla(44,38%,66%,0.48)] to-transparent" />
    </div>
  );
}

function CollectorEmptyState({
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  body: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className={classNames("relative overflow-hidden rounded-3xl p-8 text-center sm:p-10", gold.frameLg)}>
      <div className="absolute inset-0 bg-[radial-gradient(520px_260px_at_50%_0%,hsla(44,42%,58%,0.12),transparent_62%)]" />
      <div className="relative mx-auto max-w-md">
        <EmptyVaultIllustration />
        <p className={classNames("mt-7 inline-flex rounded-full px-3 py-1 text-[11px] tracking-widest", gold.pill)}>
          EMPTY VAULT
        </p>
        <h3 className="mt-5 text-balance text-xl font-semibold tracking-tight text-white/94">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/58">{body}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button type="button" onClick={onPrimary} className={classNames("min-h-[48px] w-full sm:w-auto sm:min-w-[200px]", gold.btnPrimary)}>
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              onClick={onSecondary}
              className={classNames("min-h-[48px] w-full sm:w-auto sm:min-w-[200px]", gold.btnSecondary)}
            >
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VaultAtmospherePanel({
  watch,
  imageSrc,
  collectionLabel,
  onAddWatch,
}: {
  watch?: Watch;
  imageSrc?: string;
  collectionLabel: string;
  onAddWatch: () => void;
}) {
  const title = watch ? `${watch.brand} ${watch.model}` : "Your private vault";
  const subtitle = watch
    ? [getWatchReference(watch) ? `Ref. ${getWatchReference(watch)}` : null, watch.year || null].filter(Boolean).join(" · ") || "Recently added"
    : "Add a watch photo to create an atmospheric collection cover.";
  const meta = watch
    ? [
        { label: "Brand", value: watch.brand },
        { label: "Reference", value: getWatchReference(watch) },
        { label: "Year", value: watch.year },
        { label: "Movement", value: watch.movement },
      ]
    : [];

  return (
    <div
      className={classNames(
        "relative min-h-[20rem] overflow-hidden rounded-[2rem] p-5 transition duration-300 sm:min-h-[23rem] sm:p-7",
        gold.frameLg,
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={watch ? `${watch.brand} ${watch.model}` : "Collection cover"}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover opacity-[0.78] grayscale saturate-[0.32] brightness-[0.56] contrast-[1.18]"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(420px_280px_at_68%_18%,hsla(44,40%,58%,0.16),transparent_62%),radial-gradient(340px_220px_at_18%_78%,hsla(42,32%,34%,0.18),transparent_66%),linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.42))]" />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_28%,transparent_0,rgba(0,0,0,0.14)_32%,rgba(0,0,0,0.76)_100%),linear-gradient(90deg,rgba(0,0,0,0.84),rgba(0,0,0,0.42)_48%,rgba(0,0,0,0.82)_100%),linear-gradient(180deg,rgba(0,0,0,0.12),rgba(0,0,0,0.9)_100%)]" />
      <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[hsla(44,46%,74%,0.5)] to-transparent" />
      <div className="absolute -bottom-28 right-8 h-56 w-56 rounded-full bg-[hsla(42,38%,42%,0.12)] blur-3xl" />
      <div className="relative grid h-full min-h-[17.5rem] gap-7 md:grid-cols-[1fr_0.72fr] md:items-end">
        <div className="flex h-full flex-col justify-end">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsla(44,44%,76%,0.86)]">
            Vault atmosphere
          </p>
          <h2
            className={classNames(
              vaultSerif.className,
              "mt-4 max-w-2xl text-balance text-3xl font-semibold leading-[0.96] tracking-[0.01em] text-white/96 sm:text-4xl lg:text-[2.85rem]",
            )}
          >
            {title}
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/64 sm:text-[0.98rem]">{subtitle}</p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <span className={classNames("rounded-full px-3 py-1.5 text-[11px] uppercase tracking-widest", gold.pill)}>
              {collectionLabel}
            </span>
            <button type="button" onClick={onAddWatch} className={classNames("min-h-[40px]", gold.btnSmSecondary)}>
              Add watch photo
            </button>
          </div>
        </div>
        {meta.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5 md:self-end">
            {meta.map((item) => (
              <MetadataTag key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        ) : (
          <div className="hidden justify-self-end md:block">
            <EmptyVaultIllustration className="w-32 opacity-80" />
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardMetricCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper: string;
  tone?: "default" | "attention";
}) {
  return (
    <div
      className={classNames(
        "relative overflow-hidden rounded-2xl p-4 sm:p-5",
        gold.frameLg,
        tone === "attention" ? "bg-amber-200/[0.045]" : "bg-white/[0.025]",
      )}
    >
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[hsla(44,46%,72%,0.42)] to-transparent" />
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">{label}</p>
      <p className="mt-3 text-[1.65rem] font-semibold leading-none tracking-tight text-white/93 sm:text-[2rem]">{value}</p>
      <p className="mt-3 min-h-[2.5rem] text-[12px] leading-relaxed text-white/50">{helper}</p>
    </div>
  );
}

function DashboardRecentWatchRow({
  watch,
  displaySrc,
  currency,
  onOpenDetail,
}: {
  watch: Watch;
  displaySrc?: string;
  currency: CollectionCurrency;
  onOpenDetail: (watch: Watch) => void;
}) {
  const src = displaySrc ?? watch.photoUrl;
  const valueLabel =
    typeof getWatchCurrentValue(watch) === "number" ? formatCollectionCurrency(getWatchCurrentValue(watch)!, currency) : "Value not added";

  return (
    <button
      type="button"
      onClick={() => onOpenDetail(watch)}
      className="group flex w-full items-center gap-3 rounded-2xl border border-[hsla(42,34%,48%,0.48)] bg-black/28 p-2.5 text-left transition hover:border-[hsla(44,42%,62%,0.72)] hover:bg-white/[0.04]"
    >
      <EditorialWatchImage src={src} alt={`${watch.brand} ${watch.model}`} variant="thumbnail" interactive />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white/92">
          {watch.brand} {watch.model}
        </p>
        <p className="mt-1 truncate text-[12px] text-white/52">
          {[getWatchReference(watch) ? `Ref. ${getWatchReference(watch)}` : null, watch.year || null].filter(Boolean).join(" · ") || "No reference added"}
        </p>
      </div>
      <p className="hidden shrink-0 text-right text-[12px] font-medium text-[hsla(44,42%,78%,0.86)] sm:block">{valueLabel}</p>
    </button>
  );
}

function DashboardRecentWatches({
  watches,
  isLoading,
  resolvedPhotoUrls,
  currency,
  onOpenDetail,
  onAddWatch,
}: {
  watches: Watch[];
  isLoading: boolean;
  resolvedPhotoUrls: Record<string, string>;
  currency: CollectionCurrency;
  onOpenDetail: (watch: Watch) => void;
  onAddWatch: () => void;
}) {
  return (
    <div className={classNames("rounded-3xl p-4 sm:p-5", gold.frameLg)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,44%,74%,0.86)]">
            Recently added
          </p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-white/94">Latest watches</h2>
        </div>
        <button type="button" onClick={onAddWatch} className={classNames("min-h-[40px]", gold.btnSmSecondary)}>
          Add Watch
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-2xl border border-[hsla(42,34%,48%,0.48)] bg-black/24 p-5 text-center text-sm text-white/60">
          Loading recent watches...
        </div>
      ) : watches.length > 0 ? (
        <div className="mt-4 grid gap-2.5">
          {watches.map((watch) => (
            <DashboardRecentWatchRow
              key={watch.id}
              watch={watch}
              displaySrc={resolvedPhotoUrls[watch.id]}
              currency={currency}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-[hsla(42,34%,48%,0.56)] bg-black/24 p-5 text-center">
          <EmptyVaultIllustration className="w-20 opacity-85" />
          <p className="mt-5 text-sm font-medium text-white/76">Your vault is empty.</p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/48">
            Start documenting the watches that matter to you.
          </p>
          <button type="button" onClick={onAddWatch} className={classNames("mt-5 min-h-[44px]", gold.btnPrimary)}>
            Add first watch
          </button>
        </div>
      )}
    </div>
  );
}

function WatchCard({
  watch,
  displaySrc,
  onDelete,
  onEdit,
  onOpenDetail,
  currency,
}: {
  watch: Watch;
  displaySrc?: string;
  onDelete: (id: string) => void;
  onEdit: (watch: Watch) => void;
  onOpenDetail: (watch: Watch) => void;
  currency: CollectionCurrency;
}) {
  const src = displaySrc ?? watch.photoUrl;

  return (
    <div
      className={classNames(
        "group relative flex flex-col overflow-hidden rounded-[1.55rem] border border-[hsla(42,32%,54%,0.48)] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018)_46%,rgba(0,0,0,0.28))] shadow-[inset_0_1px_0_0_hsla(44,32%,70%,0.12),0_18px_46px_-34px_rgba(0,0,0,0.92)] backdrop-blur transition duration-300 ease-out hover:-translate-y-0.5 hover:border-[hsla(44,38%,64%,0.62)] hover:bg-white/[0.04] hover:shadow-[inset_0_1px_0_0_hsla(44,36%,74%,0.17),0_24px_64px_-36px_hsla(42,36%,18%,0.72)]",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetail(watch)}
        className="relative block w-full overflow-hidden bg-black/25 text-left"
        aria-label={`View details for ${watch.brand} ${watch.model}`}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <EditorialWatchImage src={src} alt={`${watch.brand} ${watch.model}`} variant="card" interactive />
          {watch.isDemo ? (
            <span
              className={classNames(
                "pointer-events-none absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest",
                gold.pill,
              )}
            >
              Demo
            </span>
          ) : null}
        </div>
      </button>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-[hsla(44,38%,76%,0.78)]">
              {watch.brand}
            </p>
            <p className="mt-1 truncate text-[1.08rem] font-semibold tracking-tight text-white/92">{watch.model}</p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-[hsla(44,34%,54%,0.58)] bg-[hsla(40,24%,8%,0.72)] px-2 py-1 text-[10px] font-medium tracking-widest text-[hsla(46,42%,88%,0.9)] shadow-[inset_0_1px_0_0_hsla(44,32%,58%,0.14)] sm:inline">
            CATALOGUED
          </span>
        </div>

        {(getWatchReference(watch) ||
          watch.year ||
          typeof getWatchCurrentValue(watch) === "number" ||
          watch.condition ||
          watch.boxPapers) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {getWatchReference(watch) ? <span className={gold.tagSoft}>Ref. {getWatchReference(watch)}</span> : null}
            {watch.year ? <span className={gold.tagSoft}>Year {watch.year}</span> : null}
            {watch.movement ? <span className={gold.tagSoft}>{watch.movement}</span> : null}
            {typeof getWatchCurrentValue(watch) === "number" ? (
              <span className={gold.tagSoft}>Est. {formatCollectionCurrency(getWatchCurrentValue(watch)!, currency)}</span>
            ) : null}
            {watch.condition ? <span className={gold.tagSoft}>{CONDITION_LABELS[watch.condition]}</span> : null}
            {watch.boxPapers ? <span className={gold.tagSoft}>{BOXPAPERS_LABELS[watch.boxPapers]}</span> : null}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <button
            type="button"
            onClick={() => onOpenDetail(watch)}
            className={classNames("min-h-[44px] flex-1 basis-[8rem] text-sm", gold.btnSmPrimary)}
          >
            View details
          </button>
          <button
            type="button"
            onClick={() => onEdit(watch)}
            className={classNames("min-h-[44px] min-w-[4.5rem] flex-1 text-sm", gold.btnSmSecondary)}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(watch.id)}
            className={classNames("min-h-[44px] min-w-[4.5rem] flex-1 text-sm", gold.btnSmSecondary)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function CompactWatchRow({
  watch,
  displaySrc,
  onDelete,
  onEdit,
  onOpenDetail,
  currency,
}: {
  watch: Watch;
  displaySrc?: string;
  onDelete: (id: string) => void;
  onEdit: (watch: Watch) => void;
  onOpenDetail: (watch: Watch) => void;
  currency: CollectionCurrency;
}) {
  const src = displaySrc ?? watch.photoUrl;
  const meta = [
    getWatchReference(watch) ? `Ref. ${getWatchReference(watch)}` : null,
    watch.year || null,
    watch.movement || null,
    watch.condition ? CONDITION_LABELS[watch.condition] : null,
    watch.boxPapers ? BOXPAPERS_LABELS[watch.boxPapers] : null,
  ].filter(Boolean);

  return (
    <article className="group rounded-2xl border border-[hsla(42,30%,52%,0.42)] bg-black/28 p-3 shadow-[inset_0_1px_0_0_hsla(44,28%,68%,0.09)] transition duration-300 hover:border-[hsla(44,38%,64%,0.62)] hover:bg-white/[0.035]">
      <div className="flex gap-3 sm:items-center">
        <button
          type="button"
          onClick={() => onOpenDetail(watch)}
          className="shrink-0"
          aria-label={`View details for ${watch.brand} ${watch.model}`}
        >
          <EditorialWatchImage src={src} alt={`${watch.brand} ${watch.model}`} variant="thumbnail" interactive />
        </button>
        <button type="button" onClick={() => onOpenDetail(watch)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="truncate text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-[hsla(44,38%,76%,0.78)]">
              {watch.brand}
            </p>
            {watch.isDemo ? <span className={gold.tagSoft}>Demo</span> : null}
          </div>
          <p className="mt-1 truncate text-base font-semibold tracking-tight text-white/92">{watch.model}</p>
          <p className="mt-1 truncate text-[12px] leading-relaxed text-white/50">
            {meta.length > 0 ? meta.join(" · ") : "Uncatalogued details"}
          </p>
        </button>
        <div className="hidden min-w-[7rem] text-right sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">Estimated</p>
          <p className="mt-1 text-sm font-medium text-[hsla(44,42%,78%,0.86)]">
            {typeof getWatchCurrentValue(watch) === "number" ? formatCollectionCurrency(getWatchCurrentValue(watch)!, currency) : "—"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
        <button type="button" onClick={() => onOpenDetail(watch)} className={classNames("min-h-[40px]", gold.btnSmPrimary)}>
          View
        </button>
        <button type="button" onClick={() => onEdit(watch)} className={classNames("min-h-[40px]", gold.btnSmSecondary)}>
          Edit
        </button>
        <button type="button" onClick={() => onDelete(watch.id)} className={classNames("min-h-[40px]", gold.btnSmSecondary)}>
          Delete
        </button>
      </div>
    </article>
  );
}

function WatchDetailPanel({
  watch,
  displaySrc,
  gallerySrcs,
  currency,
  onClose,
  onEdit,
  onMarkWorn,
  onAddTimelineEntry,
}: {
  watch: Watch;
  displaySrc?: string;
  gallerySrcs?: string[];
  currency: CollectionCurrency;
  onClose: () => void;
  onEdit: (w: Watch) => void;
  onMarkWorn: (id: string) => void;
  onAddTimelineEntry: (id: string, entry: WatchTimelineEntry) => void;
}) {
  const src = displaySrc ?? watch.photoUrl;
  const gallery = gallerySrcs?.length ? gallerySrcs : src ? [src] : [];
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const [timelineType, setTimelineType] = useState<WatchTimelineEntryType>("serviced");
  const [timelineDate, setTimelineDate] = useState(todayIsoDate());
  const [timelineNote, setTimelineNote] = useState("");
  const [timelineCost, setTimelineCost] = useState("");
  const wearCount = watch.wearCount ?? 0;
  const costPerWear =
    typeof watch.purchasePrice === "number" && watch.purchasePrice > 0 && wearCount > 0 ? watch.purchasePrice / wearCount : undefined;

  useEffect(() => {
    setActiveGalleryIndex(0);
  }, [watch.id, gallery.length]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="watch-detail-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        className={classNames(
          "relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl sm:max-h-[85vh] sm:rounded-3xl",
          gold.frameLg,
        )}
      >
        <div className="relative max-h-[40vh] shrink-0 overflow-hidden bg-black/35 sm:max-h-[min(42vh,360px)]">
          <EditorialWatchImage
            src={gallery[activeGalleryIndex] ?? src}
            alt={`${watch.brand} ${watch.model}`}
            variant="detail"
            className="aspect-[16/10] max-h-[40vh] sm:max-h-[360px]"
          />
          {gallery.length > 1 ? (
            <div className="absolute bottom-3 left-3 right-3 flex gap-2 overflow-x-auto">
              {gallery.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  type="button"
                  onClick={() => setActiveGalleryIndex(i)}
                  className={classNames(
                    "h-12 w-16 shrink-0 overflow-hidden rounded-lg border bg-black/50 transition",
                    activeGalleryIndex === i ? "border-[hsla(44,46%,72%,0.82)]" : "border-white/18 opacity-70 hover:opacity-95",
                  )}
                  aria-label={`Show photo ${i + 1}`}
                >
                  <img src={u} alt="" className="h-full w-full object-cover grayscale saturate-[0.42] brightness-[0.8]" />
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className={classNames(
              "absolute right-3 top-3 min-h-[44px] min-w-[44px] rounded-xl px-3 text-sm",
              gold.btnSmSecondary,
            )}
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p id="watch-detail-title" className="text-lg font-semibold tracking-tight text-white/96">
                {watch.brand}
              </p>
              <p className="mt-1 text-[0.9375rem] font-medium text-white/74">{watch.model}</p>
            </div>
            {watch.isDemo ? <span className={gold.pill}>Demo sample</span> : null}
          </div>

          <div className="mt-5 grid gap-2.5 rounded-2xl border border-[hsla(42,32%,52%,0.42)] bg-black/28 p-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Wears</p>
              <p className="mt-1 text-sm font-semibold text-white/88">{wearCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Last worn</p>
              <p className="mt-1 text-sm font-semibold text-white/88">{formatDaysSinceLastWorn(watch.lastWornDate)}</p>
            </div>
            {costPerWear !== undefined ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Cost / wear</p>
                <p className="mt-1 text-sm font-semibold text-white/88">{formatCollectionCurrency(costPerWear, currency)}</p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onMarkWorn(watch.id)}
              className={classNames("min-h-[42px] sm:col-span-3", gold.btnSmPrimary)}
            >
              Mark as worn today
            </button>
          </div>

          <dl className="mt-5 grid gap-3.5 text-[0.9375rem] leading-snug">
            {getWatchReference(watch) ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Reference</dt>
                <dd className="text-right font-medium text-white/92">{getWatchReference(watch)}</dd>
              </div>
            ) : null}
            {watch.year ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Year</dt>
                <dd className="text-right font-medium text-white/92">{watch.year}</dd>
              </div>
            ) : null}
            {watch.serialNumber ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Serial</dt>
                <dd className="text-right font-medium text-white/92">{watch.serialNumber}</dd>
              </div>
            ) : null}
            {watch.caseSize ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Case size</dt>
                <dd className="text-right font-medium text-white/92">{watch.caseSize}</dd>
              </div>
            ) : null}
            {watch.lugToLug ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Lug-to-lug</dt>
                <dd className="text-right font-medium text-white/92">{watch.lugToLug}</dd>
              </div>
            ) : null}
            {watch.waterResistance ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Water resistance</dt>
                <dd className="text-right font-medium text-white/92">{watch.waterResistance}</dd>
              </div>
            ) : null}
            {watch.movement ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Movement</dt>
                <dd className="text-right font-medium text-white/92">{watch.movement}</dd>
              </div>
            ) : null}
            {typeof watch.purchasePrice === "number" ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Purchase price</dt>
                <dd className="text-right font-medium text-white/92">
                  {formatCollectionCurrency(watch.purchasePrice, currency)}
                </dd>
              </div>
            ) : null}
            {typeof getWatchCurrentValue(watch) === "number" ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Current value</dt>
                <dd className="text-right font-medium text-white/92">
                  {formatCollectionCurrency(getWatchCurrentValue(watch)!, currency)}
                </dd>
              </div>
            ) : null}
            {watch.purchaseDate ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Purchase date</dt>
                <dd className="text-right font-medium text-white/92">{watch.purchaseDate}</dd>
              </div>
            ) : null}
            {getWatchPurchaseSource(watch) ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Seller / source</dt>
                <dd className="text-right font-medium text-white/92">{getWatchPurchaseSource(watch)}</dd>
              </div>
            ) : null}
            {watch.condition ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Condition</dt>
                <dd className="text-right font-medium text-white/92">{CONDITION_LABELS[watch.condition]}</dd>
              </div>
            ) : null}
            {watch.boxPapers ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Box &amp; papers</dt>
                <dd className="text-right font-medium text-white/92">{BOXPAPERS_LABELS[watch.boxPapers]}</dd>
              </div>
            ) : null}
            {getWatchServiceNotes(watch) ? (
              <div className="grid gap-1.5 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Service history</dt>
                <dd className="whitespace-pre-wrap font-normal leading-relaxed text-white/88">{getWatchServiceNotes(watch)}</dd>
              </div>
            ) : null}
            {watch.provenanceNotes ? (
              <div className="grid gap-1.5 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Provenance</dt>
                <dd className="whitespace-pre-wrap font-normal leading-relaxed text-white/88">{watch.provenanceNotes}</dd>
              </div>
            ) : null}
            {watch.notes ? (
              <div className="grid gap-1.5">
                <dt className="font-medium text-white/62">Notes</dt>
                <dd className="whitespace-pre-wrap font-normal leading-relaxed text-white/88">{watch.notes}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-7 rounded-2xl border border-[hsla(42,32%,52%,0.42)] bg-black/24 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,40%,74%,0.78)]">
                  Ownership journal
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-white/48">Service, provenance, and ownership moments.</p>
              </div>
            </div>
            {watch.timeline?.length ? (
              <ol className="mt-4 grid gap-3">
                {[...watch.timeline]
                  .sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0))
                  .map((entry) => (
                    <li key={entry.id} className="border-l border-[hsla(42,34%,54%,0.4)] pl-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-white/88">{TIMELINE_ENTRY_LABELS[entry.type]}</p>
                        <p className="text-[11px] text-white/42">{entry.date || "Undated"}</p>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-white/58">{entry.note}</p>
                      {typeof entry.cost === "number" ? (
                        <p className="mt-1 text-[11px] text-[hsla(44,42%,78%,0.76)]">
                          Cost {formatCollectionCurrency(entry.cost, currency)}
                        </p>
                      ) : null}
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-[hsla(42,30%,48%,0.45)] bg-black/22 px-3 py-3 text-[12px] leading-relaxed text-white/48">
                No journal entries yet. Add purchase, service, regulation, strap, repair, or sale notes as the watch lives
                with you.
              </p>
            )}
            <div className="mt-4 grid gap-2.5">
              <div className="grid gap-2 sm:grid-cols-[0.8fr_0.8fr_1fr]">
                <select
                  value={timelineType}
                  onChange={(e) => setTimelineType(e.target.value as WatchTimelineEntryType)}
                  className={classNames(gold.input, gold.focus, "min-h-[44px] py-2 text-[13px]")}
                >
                  {TIMELINE_ENTRY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TIMELINE_ENTRY_LABELS[type]}
                    </option>
                  ))}
                </select>
                <input
                  value={timelineDate}
                  onChange={(e) => setTimelineDate(e.target.value)}
                  className={classNames(gold.input, gold.focus, "min-h-[44px] py-2 text-[13px]")}
                  placeholder="YYYY-MM-DD"
                />
                <input
                  value={timelineCost}
                  onChange={(e) => setTimelineCost(e.target.value)}
                  className={classNames(gold.input, gold.focus, "min-h-[44px] py-2 text-[13px]")}
                  placeholder="Cost (optional)"
                  inputMode="numeric"
                />
              </div>
              <textarea
                value={timelineNote}
                onChange={(e) => setTimelineNote(e.target.value)}
                className={classNames("min-h-[76px] resize-y", gold.input, gold.focus)}
                placeholder="Short archival note..."
              />
              <button
                type="button"
                onClick={() => {
                  const note = timelineNote.trim();
                  if (!note) return;
                  const parsedCost = Number(timelineCost.replace(/[^\d]/g, ""));
                  onAddTimelineEntry(watch.id, {
                    id: crypto.randomUUID(),
                    type: timelineType,
                    date: timelineDate.trim() || undefined,
                    note,
                    cost: Number.isFinite(parsedCost) && parsedCost > 0 ? parsedCost : undefined,
                  });
                  setTimelineNote("");
                  setTimelineCost("");
                }}
                className={classNames("min-h-[44px]", gold.btnSmSecondary)}
              >
                Add journal entry
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(watch);
              }}
              className={classNames("min-h-[48px] flex-1", gold.btnPrimary)}
            >
              Edit watch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [watchesHydrated, setWatchesHydrated] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [editingWatchId, setEditingWatchId] = useState<string | null>(null);
  const [collectionCurrency, setCollectionCurrency] = useState<CollectionCurrency>(DEFAULT_CURRENCY);

  const [resolvedPhotoUrls, setResolvedPhotoUrls] = useState<Record<string, string>>({});
  const [resolvedPhotoGalleryUrls, setResolvedPhotoGalleryUrls] = useState<Record<string, string[]>>({});
  const resolvedPhotoUrlsRef = useRef(resolvedPhotoUrls);
  const resolvedPhotoGalleryUrlsRef = useRef(resolvedPhotoGalleryUrls);
  resolvedPhotoUrlsRef.current = resolvedPhotoUrls;
  resolvedPhotoGalleryUrlsRef.current = resolvedPhotoGalleryUrls;
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [detailWatch, setDetailWatch] = useState<Watch | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedBackup | null>(null);
  const [photoRemoveRequested, setPhotoRemoveRequested] = useState(false);

  const pendingPhotoBlobRef = useRef<Blob | null>(null);
  const pendingPhotoBlobsRef = useRef<Blob[]>([]);
  const backupImportRef = useRef<HTMLInputElement>(null);
  const [backupReminderDays, setBackupReminderDays] = useState<0 | 7 | 30>(0);
  const [lastBackupExportedAt, setLastBackupExportedAt] = useState<number | null>(null);
  /** Default true: never persist `[]` until the initial storage merge completes and clears this (see `startupBlockEmptyPersist`). */
  const blockEmptyWatchListPersistRef = useRef(true);
  const [watchStorageIssue, setWatchStorageIssue] = useState<WatchStorageLoadIssue | null>(null);
  const [watchStorageIssueDismissed, setWatchStorageIssueDismissed] = useState(false);
  const [indexedDbUnavailable, setIndexedDbUnavailable] = useState(false);
  const [noWatchDataFound, setNoWatchDataFound] = useState(false);
  const [collectionPersistenceWarning, setCollectionPersistenceWarning] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const [mainNavView, setMainNavView] = useState<MainNavView>("dashboard");
  const [collectionDisplayMode, setCollectionDisplayMode] = useState<CollectionDisplayMode>("grid");

  const goMainView = useCallback((v: MainNavView) => {
    setMainNavView(v);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  }, []);

  const trackLocalUsage = useCallback((key: LocalUsageCounterKey) => {
    incrementLocalUsageCounter(key);
  }, []);

  const goAddWatchFromClick = useCallback(() => {
    trackLocalUsage("addWatchClicks");
    goMainView("add-watch");
  }, [goMainView, trackLocalUsage]);

  // Form state
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [reference, setReference] = useState("");
  const [year, setYear] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [purchasePriceStr, setPurchasePriceStr] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [condition, setCondition] = useState<WatchCondition | "">("");
  const [boxPapers, setBoxPapers] = useState<WatchBoxPapers | "">("");
  const [serviceHistory, setServiceHistory] = useState("");
  const [notes, setNotes] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | undefined>(undefined);
  const [photoGalleryPreviewUrls, setPhotoGalleryPreviewUrls] = useState<string[]>([]);
  const [primaryPhotoIndex, setPrimaryPhotoIndex] = useState(0);
  const [caseSizeStr, setCaseSizeStr] = useState("");
  const [movementStr, setMovementStr] = useState("");
  const [lugToLugStr, setLugToLugStr] = useState("");
  const [waterResistanceStr, setWaterResistanceStr] = useState("");
  const [complicationStyleStr, setComplicationStyleStr] = useState("");
  const [purchaseDateStr, setPurchaseDateStr] = useState("");
  const [sellerStr, setSellerStr] = useState("");
  const [provenanceNotesStr, setProvenanceNotesStr] = useState("");
  const [addWatchStep, setAddWatchStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>("all");

  const collectionLabel = useMemo(() => {
    if (watches.length === 0) return "No watches yet";
    if (watches.length === 1) return "1 watch in collection";
    return `${watches.length} watches in collection`;
  }, [watches.length]);

  const totalCollectionValue = useMemo(() => {
    return watches.reduce((sum, w) => sum + (getWatchCurrentValue(w) ?? 0), 0);
  }, [watches]);

  const watchesMissingValueData = useMemo(() => {
    return watches.filter((w) => typeof w.purchasePrice !== "number" || typeof getWatchCurrentValue(w) !== "number").length;
  }, [watches]);

  const recentlyAddedWatches = useMemo(() => {
    return [...watches].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  }, [watches]);

  const collectionCoverWatch = useMemo(() => {
    return (
      recentlyAddedWatches.find((w) => Boolean(resolvedPhotoUrls[w.id] ?? w.photoUrl)) ??
      watches.find((w) => Boolean(resolvedPhotoUrls[w.id] ?? w.photoUrl))
    );
  }, [recentlyAddedWatches, resolvedPhotoUrls, watches]);

  const collectionCoverImageSrc = collectionCoverWatch
    ? (resolvedPhotoUrls[collectionCoverWatch.id] ?? collectionCoverWatch.photoUrl)
    : undefined;

  const dashboardTotalValueNeedsData = watchesHydrated && watches.length > 0 && totalCollectionValue === 0;
  const dashboardTotalValueDisplay = !watchesHydrated
    ? "—"
    : watches.length === 0
      ? "—"
      : totalCollectionValue > 0
        ? formatCollectionCurrency(totalCollectionValue, collectionCurrency)
        : "Needs values";
  const dashboardTotalValueHelper = !watchesHydrated
    ? "Loading saved value data..."
    : watches.length === 0
      ? "Add watches with current values to calculate a total."
      : totalCollectionValue === 0
        ? "Add purchase or current values to calculate your total collection value."
        : "Calculated from saved current estimated values.";

  const estimatedFieldLabel = useMemo(() => {
    const entry = CURRENCIES.find((c) => c.code === collectionCurrency);
    return `Current value (${entry?.label ?? collectionCurrency})`;
  }, [collectionCurrency]);

  const mostCommonBrand = useMemo(() => {
    if (watches.length === 0) return undefined;
    const counts = new Map<string, number>();
    for (const w of watches) {
      const key = (w.brand || "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [brand, count] of counts.entries()) {
      if (count > bestCount) {
        best = brand;
        bestCount = count;
      }
    }
    return best;
  }, [watches]);

  const brandsRepresented = useMemo(() => {
    return new Set(watches.map((w) => w.brand.trim()).filter(Boolean)).size;
  }, [watches]);

  const mostWornWatch = useMemo(() => {
    return watches.reduce<Watch | undefined>((best, watch) => {
      if (!best) return watch;
      return (watch.wearCount ?? 0) > (best.wearCount ?? 0) ? watch : best;
    }, undefined);
  }, [watches]);

  const newestAddition = useMemo(() => {
    return watches.reduce<Watch | undefined>((best, watch) => {
      if (!best) return watch;
      return watch.createdAt > best.createdAt ? watch : best;
    }, undefined);
  }, [watches]);

  const watchesWithCurrentValue = useMemo(() => watches.filter((w) => typeof getWatchCurrentValue(w) === "number"), [watches]);
  const averageCollectionValue = useMemo(() => {
    if (watchesWithCurrentValue.length === 0) return undefined;
    return watchesWithCurrentValue.reduce((sum, w) => sum + (getWatchCurrentValue(w) ?? 0), 0) / watchesWithCurrentValue.length;
  }, [watchesWithCurrentValue]);

  const brandFilterOptions = useMemo(() => [...new Set(watches.map((w) => w.brand).filter(Boolean))].sort(), [watches]);
  const styleFilterOptions = useMemo(
    () => [...new Set(watches.map((w) => w.complicationStyle).filter((v): v is string => Boolean(v)))].sort(),
    [watches],
  );

  const filteredWatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = watches.filter((watch) => {
      const haystack = [watch.brand, watch.model, getWatchReference(watch), watch.complicationStyle].filter(Boolean).join(" ").toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (brandFilter !== "all" && watch.brand !== brandFilter) return false;
      if (styleFilter !== "all" && watch.complicationStyle !== styleFilter) return false;
      if (collectionFilter === "service" && !getWatchServiceNotes(watch) && !watch.timeline?.some((e) => e.type === "serviced")) return false;
      if (collectionFilter === "missing-values" && typeof watch.purchasePrice === "number" && typeof getWatchCurrentValue(watch) === "number") return false;
      return true;
    });
    if (collectionFilter === "most-worn") {
      list = [...list].sort((a, b) => (b.wearCount ?? 0) - (a.wearCount ?? 0));
    }
    return list;
  }, [brandFilter, collectionFilter, searchQuery, styleFilter, watches]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const myGeneration = ++loadGenerationRef.current;
    void (async () => {
      try {
        const loaded = await loadWatchesFromAllSources();
        if (myGeneration !== loadGenerationRef.current) return;
        setCollectionPersistenceWarning(null);
        setWatches(loaded.watches);
        setWatchStorageIssue(loaded.issue);
        blockEmptyWatchListPersistRef.current = loaded.startupBlockEmptyPersist;
        setIndexedDbUnavailable(loaded.indexedDbUnavailable);
        setNoWatchDataFound(loaded.noWatchDataFound);
      } catch {
        if (myGeneration !== loadGenerationRef.current) return;
        setWatches([]);
        setWatchStorageIssue(null);
        blockEmptyWatchListPersistRef.current = true;
        setIndexedDbUnavailable(false);
        setNoWatchDataFound(false);
        setCollectionPersistenceWarning(null);
      } finally {
        if (myGeneration === loadGenerationRef.current) {
          setWatchesHydrated(true);
        }
      }
    })();
    setIsMounted(true);
    try {
      const raw = window.localStorage.getItem(WRISTFOLIO_COLLECTION_CURRENCY_KEY);
      if (raw && isCollectionCurrency(raw)) setCollectionCurrency(raw);
    } catch {
      /* ignore */
    }
    return () => {
      loadGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const w = window as unknown as {
      __wristfolioInspectStorage?: () => ReturnType<typeof inspectWristfolioStorageReadonly>;
    };
    w.__wristfolioInspectStorage = () => inspectWristfolioStorageReadonly();
    return () => {
      delete w.__wristfolioInspectStorage;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawDays = window.localStorage.getItem(WRISTFOLIO_BACKUP_REMINDER_DAYS_KEY);
      const days = rawDays ? Number(rawDays) : 0;
      setBackupReminderDays(days === 7 || days === 30 ? days : 0);
      const rawLast = window.localStorage.getItem(WRISTFOLIO_BACKUP_LAST_EXPORTED_AT_KEY);
      const last = rawLast ? Number(rawLast) : NaN;
      setLastBackupExportedAt(Number.isFinite(last) && last > 0 ? last : null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (watches.length > 0) {
      blockEmptyWatchListPersistRef.current = false;
      setWatchStorageIssue(null);
      setWatchStorageIssueDismissed(false);
      setNoWatchDataFound(false);
    }
  }, [watches.length]);

  const storageFullWarnedRef = useRef(false);
  // Mirrors `watches` to IndexedDB + canonical localStorage only after hydration. Empty arrays are skipped while
  // `blockEmptyWatchListPersistRef` is true so startup never clobbers recoverable legacy / IDB data with `[]`.
  useEffect(() => {
    if (typeof window === "undefined" || !watchesHydrated) return;
    if (watches.length === 0 && blockEmptyWatchListPersistRef.current) return;
    let cancelled = false;
    void (async () => {
      const r = await persistWatchCollection(watches, {
        blockEmptyWrite: watches.length === 0 && blockEmptyWatchListPersistRef.current,
      });
      if (cancelled) return;

      if (r.primaryWritten === "none" && watches.length > 0) {
        setCollectionPersistenceWarning(
          "Your collection could not be saved to browser storage. Export a JSON backup immediately, then try freeing space or another browser.",
        );
        if (!storageFullWarnedRef.current) {
          storageFullWarnedRef.current = true;
          setToastMessage("Could not save your collection. Export a JSON backup now.");
        }
        return;
      }

      if (r.primaryWritten === "localStorage") {
        setCollectionPersistenceWarning(
          r.indexedDbTried
            ? "IndexedDB could not be used for the main collection store; your collection was saved using browser storage, which mobile Safari may clear. Export a JSON backup regularly."
            : "IndexedDB is not available in this browser profile; your collection is stored in browser storage only. Export a JSON backup regularly — especially on iPhone.",
        );
      } else if (r.primaryWritten === "indexeddb" && !r.localStorageMirrorOk) {
        setCollectionPersistenceWarning(
          "Saved to IndexedDB, but a backup copy in localStorage failed (often storage quota). Export a JSON backup periodically.",
        );
      } else {
        setCollectionPersistenceWarning(null);
      }

      if (r.errorMessage && r.primaryWritten !== "none") {
        /* non-fatal: user already has primaryWritten */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watches, watchesHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(WRISTFOLIO_COLLECTION_CURRENCY_KEY, collectionCurrency);
    } catch {
      /* ignore */
    }
  }, [collectionCurrency]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      const next: Record<string, string> = {};
      const galleryNext: Record<string, string[]> = {};
      for (const w of watches) {
        const photos = w.photos?.length
          ? w.photos
          : w.photoStorageKey || w.photoUrl
            ? [{ id: "legacy-primary", storageKey: w.photoStorageKey, url: w.photoUrl, isPrimary: true }]
            : [];
        const gallery: string[] = [];
        for (const photo of photos) {
          if (photo.storageKey) {
            try {
              const blob = await getWatchImageBlob(photo.storageKey);
              if (!blob || cancelled) continue;
              const u = URL.createObjectURL(blob);
              created.push(u);
              gallery.push(u);
              const primary = photo.id === w.primaryPhotoId || photo.isPrimary;
              if (primary || !next[w.id]) next[w.id] = u;
            } catch {
              /* missing blob */
            }
          } else if (photo.url) {
            gallery.push(photo.url);
            const primary = photo.id === w.primaryPhotoId || photo.isPrimary;
            if (primary || !next[w.id]) next[w.id] = photo.url;
          }
        }
        if (!next[w.id] && w.photoStorageKey) {
          try {
            const blob = await getWatchImageBlob(w.photoStorageKey);
            if (!blob || cancelled) continue;
            const u = URL.createObjectURL(blob);
            created.push(u);
            next[w.id] = u;
            gallery.push(u);
          } catch {
            /* missing blob */
          }
        } else if (!next[w.id] && w.photoUrl) {
          next[w.id] = w.photoUrl;
          gallery.push(w.photoUrl);
        }
        if (gallery.length) galleryNext[w.id] = gallery;
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setResolvedPhotoUrls((prev) => {
        for (const u of Object.values(prev)) URL.revokeObjectURL(u);
        return next;
      });
      setResolvedPhotoGalleryUrls((prev) => {
        for (const list of Object.values(prev)) {
          for (const u of list) {
            if (u.startsWith("blob:")) URL.revokeObjectURL(u);
          }
        }
        return galleryNext;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [watches]);

  useEffect(() => {
    return () => {
      for (const u of Object.values(resolvedPhotoUrlsRef.current)) URL.revokeObjectURL(u);
      for (const list of Object.values(resolvedPhotoGalleryUrlsRef.current)) {
        for (const u of list) {
          if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 5200);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const clearPhotoPreviews = useCallback(() => {
    pendingPhotoBlobRef.current = null;
    pendingPhotoBlobsRef.current = [];
    setPhotoPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return undefined;
    });
    setPhotoGalleryPreviewUrls((prev) => {
      for (const u of prev) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      return [];
    });
    setPrimaryPhotoIndex(0);
  }, []);

  const onPickPhotos = useCallback(async (files: FileList | File[] | null) => {
    setPhotoRemoveRequested(false);
    const list = files ? Array.from(files).slice(0, 6) : [];
    if (list.length === 0) {
      clearPhotoPreviews();
      return;
    }
    try {
      const blobs = await Promise.all(list.map((file) => compressImageFile(file)));
      pendingPhotoBlobRef.current = blobs[0] ?? null;
      pendingPhotoBlobsRef.current = blobs;
      const urls = blobs.map((blob) => URL.createObjectURL(blob));
      setPhotoPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return urls[0];
      });
      setPhotoGalleryPreviewUrls((prev) => {
        for (const u of prev) {
          if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        }
        return urls;
      });
      setPrimaryPhotoIndex(0);
      trackLocalUsage("imageUploads");
    } catch {
      setToastMessage("Could not process that image. Try another file or format.");
    }
  }, [clearPhotoPreviews, trackLocalUsage]);

  const onPickPhoto = useCallback((file: File | null) => {
    void onPickPhotos(file ? [file] : null);
  }, [onPickPhotos]);

  const resetForm = useCallback(() => {
    setBrand("");
    setModel("");
    setReference("");
    setYear("");
    setSerialNumber("");
    setPurchasePriceStr("");
    setEstimatedValue("");
    setCondition("");
    setBoxPapers("");
    setServiceHistory("");
    setNotes("");
    setCaseSizeStr("");
    setMovementStr("");
    setLugToLugStr("");
    setWaterResistanceStr("");
    setComplicationStyleStr("");
    setPurchaseDateStr("");
    setSellerStr("");
    setProvenanceNotesStr("");
    setAddWatchStep(1);
    setPhotoRemoveRequested(false);
    clearPhotoPreviews();
    setEditingWatchId(null);
  }, [clearPhotoPreviews]);

  const onAddWatch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (addWatchStep !== ADD_WATCH_STEP_COUNT) return;
      const trimmedBrand = brand.trim();
      const trimmedModel = model.trim();
      if (!trimmedBrand || !trimmedModel) {
        setToastMessage("Brand and model are required.");
        setAddWatchStep(2);
        return;
      }

      const parsedEst = Number(estimatedValue.replace(/[^\d]/g, ""));
      const normalizedEstimatedValue = Number.isFinite(parsedEst) && parsedEst > 0 ? parsedEst : undefined;
      const parsedPur = Number(purchasePriceStr.replace(/[^\d]/g, ""));
      const purchasePrice = Number.isFinite(parsedPur) && parsedPur > 0 ? parsedPur : undefined;

      const baseFields = {
        brand: trimmedBrand,
        model: trimmedModel,
        referenceNumber: reference.trim() || undefined,
        reference: reference.trim() || undefined,
        year: year.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        caseSize: caseSizeStr.trim() || undefined,
        lugToLug: lugToLugStr.trim() || undefined,
        waterResistance: waterResistanceStr.trim() || undefined,
        movement: movementStr.trim() || undefined,
        purchasePrice,
        currentValue: normalizedEstimatedValue,
        estimatedValue: normalizedEstimatedValue,
        purchaseDate: purchaseDateStr.trim() || undefined,
        purchaseSource: sellerStr.trim() || undefined,
        seller: sellerStr.trim() || undefined,
        complicationStyle: complicationStyleStr.trim() || undefined,
        condition: condition || undefined,
        boxPapers: boxPapers || undefined,
        serviceHistoryNotes: serviceHistory.trim() || undefined,
        serviceHistory: serviceHistory.trim() || undefined,
        provenanceNotes: provenanceNotesStr.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      const savedFromEditSession = Boolean(editingWatchId);

      const saveNewPhotoToId = async (watchId: string): Promise<{ photoStorageKey?: string; photoUrl?: string }> => {
        const blob = pendingPhotoBlobRef.current;
        if (!blob) return {};
        try {
          await saveWatchImage(watchId, blob);
          pendingPhotoBlobRef.current = null;
          setPhotoPreviewUrl((prev) => {
            if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
            return undefined;
          });
          return { photoStorageKey: watchId, photoUrl: undefined };
        } catch {
          setToastMessage("Could not save the photo — storage may be full. Watch was saved without the new image.");
          pendingPhotoBlobRef.current = null;
          return {};
        }
      };

      const saveNewPhotosToId = async (watchId: string): Promise<{ photos?: WatchPhoto[]; primaryPhotoId?: string; photoStorageKey?: string; photoUrl?: string }> => {
        const blobs = pendingPhotoBlobsRef.current.length ? pendingPhotoBlobsRef.current : pendingPhotoBlobRef.current ? [pendingPhotoBlobRef.current] : [];
        if (blobs.length === 0) return {};
        const photos: WatchPhoto[] = [];
        const primaryIndex = Math.min(primaryPhotoIndex, Math.max(0, blobs.length - 1));
        for (let i = 0; i < blobs.length; i++) {
          const photoId = i === 0 ? "primary" : crypto.randomUUID();
          const isPrimary = i === primaryIndex;
          const storageKey = isPrimary ? watchId : `${watchId}-photo-${photoId}`;
          try {
            await saveWatchImage(storageKey, blobs[i]);
            photos.push({
              id: photoId,
              storageKey,
              isPrimary,
              createdAt: Date.now() + i,
            });
          } catch {
            setToastMessage("One or more photos could not be saved — storage may be full.");
          }
        }
        pendingPhotoBlobRef.current = null;
        pendingPhotoBlobsRef.current = [];
        return {
          photos: photos.length ? photos : undefined,
          primaryPhotoId: photos.find((p) => p.isPrimary)?.id ?? photos[0]?.id,
          photoStorageKey: photos.find((p) => p.isPrimary)?.storageKey ?? photos[0]?.storageKey,
          photoUrl: undefined,
        };
      };

      if (editingWatchId) {
        const existing = watches.find((w) => w.id === editingWatchId);
        if (!existing) return;

        let photoUrl: string | undefined = existing.photoUrl;
        let photoStorageKey: string | undefined = existing.photoStorageKey;

        let photos: WatchPhoto[] | undefined = existing.photos;
        let primaryPhotoId: string | undefined = existing.primaryPhotoId;

        if (photoRemoveRequested) {
          if (existing.photoStorageKey) await deleteWatchImage(existing.photoStorageKey).catch(() => {});
          for (const p of existing.photos ?? []) {
            if (p.storageKey) await deleteWatchImage(p.storageKey).catch(() => {});
          }
          photoUrl = undefined;
          photoStorageKey = undefined;
          photos = undefined;
          primaryPhotoId = undefined;
        } else if (pendingPhotoBlobsRef.current.length || pendingPhotoBlobRef.current) {
          if (existing.photoStorageKey) await deleteWatchImage(existing.photoStorageKey).catch(() => {});
          for (const p of existing.photos ?? []) {
            if (p.storageKey) await deleteWatchImage(p.storageKey).catch(() => {});
          }
          const saved = await saveNewPhotosToId(editingWatchId);
          photoUrl = saved.photoUrl;
          photoStorageKey = saved.photoStorageKey;
          photos = saved.photos;
          primaryPhotoId = saved.primaryPhotoId;
        } else if (photoPreviewUrl?.startsWith("blob:")) {
          /* loaded IDB preview only — keep stored image */
        } else if (photoPreviewUrl?.startsWith("data:")) {
          photoUrl = photoPreviewUrl;
          photoStorageKey = undefined;
          photos = [{ id: "primary", url: photoPreviewUrl, isPrimary: true }];
          primaryPhotoId = "primary";
        }

        setWatches((prev) =>
          prev.map((w) =>
            w.id === editingWatchId
              ? {
                  ...w,
                  ...baseFields,
                  photoUrl,
                  photoStorageKey,
                  photos,
                  primaryPhotoId,
                }
              : w,
          ),
        );
      } else {
        const id = crypto.randomUUID();
        let photoUrl: string | undefined;
        let photoStorageKey: string | undefined;

        let photos: WatchPhoto[] | undefined;
        let primaryPhotoId: string | undefined;

        if (photoRemoveRequested) {
          photoUrl = undefined;
          photoStorageKey = undefined;
        } else {
          const saved = await saveNewPhotosToId(id);
          photoStorageKey = saved.photoStorageKey;
          photoUrl = saved.photoUrl;
          photos = saved.photos;
          primaryPhotoId = saved.primaryPhotoId;
        }

        const watch: Watch = {
          id,
          ...baseFields,
          photoUrl,
          photoStorageKey,
          photos,
          primaryPhotoId,
          timeline: purchaseDateStr.trim()
            ? [
                {
                  id: crypto.randomUUID(),
                  type: "purchased",
                  date: purchaseDateStr.trim(),
                  note: sellerStr.trim() ? `Purchased from ${sellerStr.trim()}.` : "Purchase recorded.",
                  cost: purchasePrice,
                },
              ]
            : undefined,
          createdAt: Date.now(),
        };

        setWatches((prev) => [watch, ...prev]);
      }

      trackLocalUsage("watchesSaved");
      resetForm();
      requestAnimationFrame(() => {
        goMainView(savedFromEditSession ? "add-watch" : "collection");
      });
    },
    [
      brand,
      model,
      reference,
      year,
      serialNumber,
      purchasePriceStr,
      estimatedValue,
      condition,
      boxPapers,
      serviceHistory,
      notes,
      caseSizeStr,
      movementStr,
      lugToLugStr,
      waterResistanceStr,
      complicationStyleStr,
      purchaseDateStr,
      sellerStr,
      provenanceNotesStr,
      photoPreviewUrl,
      primaryPhotoIndex,
      photoRemoveRequested,
      editingWatchId,
      watches,
      resetForm,
      addWatchStep,
      goMainView,
      trackLocalUsage,
    ],
  );

  const onDeleteWatch = useCallback(async (id: string) => {
    const w = watches.find((x) => x.id === id);
    if (w?.photoStorageKey) await deleteWatchImage(w.photoStorageKey).catch(() => {});
    for (const p of w?.photos ?? []) {
      if (p.storageKey) await deleteWatchImage(p.storageKey).catch(() => {});
    }
    setWatches((prev) => prev.filter((x) => x.id !== id));
    setEditingWatchId((cur) => (cur === id ? null : cur));
    setDetailWatch((cur) => (cur?.id === id ? null : cur));
  }, [watches]);

  const onMarkWorn = useCallback((id: string) => {
    setWatches((prev) =>
      prev.map((watch) =>
        watch.id === id
          ? {
              ...watch,
              wearCount: (watch.wearCount ?? 0) + 1,
              lastWornDate: todayIsoDate(),
            }
          : watch,
      ),
    );
    setDetailWatch((cur) =>
      cur?.id === id
        ? {
            ...cur,
            wearCount: (cur.wearCount ?? 0) + 1,
            lastWornDate: todayIsoDate(),
          }
        : cur,
    );
    setToastMessage("Marked as worn today.");
  }, []);

  const onAddTimelineEntry = useCallback((id: string, entry: WatchTimelineEntry) => {
    setWatches((prev) =>
      prev.map((watch) =>
        watch.id === id
          ? {
              ...watch,
              timeline: [entry, ...(watch.timeline ?? [])],
            }
          : watch,
      ),
    );
    setDetailWatch((cur) => (cur?.id === id ? { ...cur, timeline: [entry, ...(cur.timeline ?? [])] } : cur));
    setToastMessage("Journal entry added.");
  }, []);

  const onStartEdit = useCallback(
    async (watch: Watch) => {
      setPhotoRemoveRequested(false);
      pendingPhotoBlobRef.current = null;
      pendingPhotoBlobsRef.current = [];
      setEditingWatchId(watch.id);
      setAddWatchStep(1);
      setBrand(watch.brand ?? "");
      setModel(watch.model ?? "");
      setReference(getWatchReference(watch) ?? "");
      setYear(watch.year ?? "");
      setSerialNumber(watch.serialNumber ?? "");
      setPurchasePriceStr(typeof watch.purchasePrice === "number" ? String(watch.purchasePrice) : "");
      setEstimatedValue(typeof getWatchCurrentValue(watch) === "number" ? String(getWatchCurrentValue(watch)) : "");
      setCondition(watch.condition ?? "");
      setBoxPapers(watch.boxPapers ?? "");
      setServiceHistory(getWatchServiceNotes(watch) ?? "");
      setNotes(watch.notes ?? "");
      setCaseSizeStr(watch.caseSize ?? "");
      setMovementStr(watch.movement ?? "");
      setLugToLugStr(watch.lugToLug ?? "");
      setWaterResistanceStr(watch.waterResistance ?? "");
      setComplicationStyleStr(watch.complicationStyle ?? "");
      setPurchaseDateStr(watch.purchaseDate ?? "");
      setSellerStr(getWatchPurchaseSource(watch) ?? "");
      setProvenanceNotesStr(watch.provenanceNotes ?? "");

      setPhotoPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return undefined;
      });

      if (watch.photoStorageKey) {
        try {
          const blob = await getWatchImageBlob(watch.photoStorageKey);
          if (blob) setPhotoPreviewUrl(URL.createObjectURL(blob));
        } catch {
          setToastMessage("Could not load the saved photo for editing.");
        }
      } else if (watch.photoUrl) {
        setPhotoPreviewUrl(watch.photoUrl);
      }
      setPhotoGalleryPreviewUrls(resolvedPhotoGalleryUrls[watch.id] ?? []);

      requestAnimationFrame(() => {
        goMainView("add-watch");
      });
    },
    [goMainView, resolvedPhotoGalleryUrls],
  );

  const onCancelEdit = useCallback(() => {
    resetForm();
  }, [resetForm]);

  const goAddWatchNext = useCallback(() => {
    if (addWatchStep >= ADD_WATCH_STEP_COUNT) return;
    if (addWatchStep === 2 && (!brand.trim() || !model.trim())) {
      setToastMessage("Brand and model are required to continue.");
      return;
    }
    setAddWatchStep((s) => Math.min(ADD_WATCH_STEP_COUNT, s + 1));
  }, [addWatchStep, brand, model]);

  const goAddWatchBack = useCallback(() => {
    setAddWatchStep((s) => Math.max(1, s - 1));
  }, []);

  const persistImportedPhotos = useCallback(
    async (list: Watch[], photos: { watchId: string; photoId?: string; base64: string }[]) => {
      const byWatch = new Map<string, { photoId?: string; base64: string }[]>();
      for (const ep of photos) {
        const group = byWatch.get(ep.watchId) ?? [];
        group.push({ photoId: ep.photoId, base64: ep.base64 });
        byWatch.set(ep.watchId, group);
      }
      for (const ep of photos) {
        const blob = base64ToBlob(ep.base64);
        const storageKey = ep.photoId ? `${ep.watchId}-photo-${ep.photoId}` : ep.watchId;
        await saveWatchImage(storageKey, blob);
      }
      return list.map((w) => {
        const group = byWatch.get(w.id);
        if (!group?.length) return w;
        const importedPhotos: WatchPhoto[] = group.map((photo, index) => {
          const photoId = photo.photoId ?? (index === 0 ? "primary" : crypto.randomUUID());
          return {
            id: photoId,
            storageKey: photo.photoId ? `${w.id}-photo-${photoId}` : w.id,
            isPrimary: index === 0,
            createdAt: Date.now() + index,
          };
        });
        return {
          ...w,
          photos: importedPhotos,
          primaryPhotoId: importedPhotos[0]?.id,
          photoStorageKey: importedPhotos[0]?.storageKey,
          photoUrl: undefined,
        };
      });
    },
    [],
  );

  const applyImport = useCallback(
    async (parsed: ParsedBackup, mode: "replace" | "merge") => {
      try {
        if (mode === "replace") {
          const withBlobs = await persistImportedPhotos(parsed.watches, parsed.embeddedPhotos);
          const byId = new Map(withBlobs.map((w) => [w.id, w]));
          for (const ow of watches) {
            if (ow.photoStorageKey) {
              const nw = byId.get(ow.id);
              if (!nw?.photoStorageKey || nw.photoStorageKey !== ow.photoStorageKey) {
                await deleteWatchImage(ow.photoStorageKey).catch(() => {});
              }
            }
            for (const p of ow.photos ?? []) {
              if (!p.storageKey) continue;
              const nw = byId.get(ow.id);
              if (!nw?.photos?.some((np) => np.storageKey === p.storageKey)) {
                await deleteWatchImage(p.storageKey).catch(() => {});
              }
            }
          }
          setWatches(withBlobs);
          setCollectionCurrency(parsed.collectionCurrency);
        } else {
          const { watches: incoming, idMap } = remapIncomingForMerge(watches, parsed.watches);
          const photos = parsed.embeddedPhotos.map((ep) => ({
            watchId: idMap.get(ep.watchId) ?? ep.watchId,
            photoId: ep.photoId,
            base64: ep.base64,
          }));
          const withBlobs = await persistImportedPhotos(incoming, photos);
          setWatches([...withBlobs, ...watches]);
        }
        setImportPreview(null);
        setToastMessage("Backup imported successfully.");
        setWatchStorageIssue(null);
        setWatchStorageIssueDismissed(false);
        blockEmptyWatchListPersistRef.current = false;
        setCollectionPersistenceWarning(null);
        goMainView("collection");
      } catch {
        setToastMessage("Import failed. Your collection was not changed.");
      }
    },
    [watches, persistImportedPhotos, goMainView],
  );

  const onExportBackup = useCallback(async () => {
    try {
      const json = await buildBackupJsonString(watches, collectionCurrency);
      triggerTextDownload(`horolair-backup-${Date.now()}.json`, json, "application/json");
      const now = Date.now();
      setLastBackupExportedAt(now);
      try {
        window.localStorage.setItem(WRISTFOLIO_BACKUP_LAST_EXPORTED_AT_KEY, String(now));
      } catch {
        /* ignore */
      }
    } catch {
      setToastMessage("Export failed. Try again with a smaller collection or fewer photos.");
    }
  }, [watches, collectionCurrency]);

  const onExportCsv = useCallback(() => {
    const csv = buildCollectionCsv(watches, collectionCurrency);
    triggerTextDownload(`horolair-export-${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
  }, [watches, collectionCurrency]);

  const onExportCollectionPdf = useCallback(async () => {
    if (watches.length === 0) {
      setToastMessage("Add at least one watch before exporting a PDF report.");
      return;
    }
    try {
      await downloadWristfolioCollectionPdf({
        watches,
        collectionCurrency,
        getPhotoSrc: (w) => resolvedPhotoUrls[w.id] ?? w.photoUrl,
      });
      trackLocalUsage("pdfExports");
      setToastMessage("Collection PDF generated.");
    } catch (e) {
      setToastMessage(
        e instanceof Error ? e.message : "PDF export failed. Try again, or export a JSON backup instead.",
      );
    }
  }, [watches, collectionCurrency, resolvedPhotoUrls, trackLocalUsage]);

  const backupIsDue = useMemo(() => {
    if (!isMounted) return false;
    if (backupReminderDays === 0) return false;
    if (!lastBackupExportedAt) return true;
    const ms = backupReminderDays * 24 * 60 * 60 * 1000;
    return Date.now() - lastBackupExportedAt > ms;
  }, [backupReminderDays, lastBackupExportedAt, isMounted]);

  const backupLastLabel = useMemo(() => {
    if (!lastBackupExportedAt) return "Never exported";
    try {
      return new Date(lastBackupExportedAt).toLocaleString();
    } catch {
      return "Previously exported";
    }
  }, [lastBackupExportedAt]);

  const showSubtleNeverExportedBackupCue = useMemo(
    () => isMounted && watches.length >= 1 && lastBackupExportedAt === null,
    [isMounted, watches.length, lastBackupExportedAt],
  );

  const setBackupReminder = useCallback(
    (days: 0 | 7 | 30) => {
      setBackupReminderDays(days);
      try {
        window.localStorage.setItem(WRISTFOLIO_BACKUP_REMINDER_DAYS_KEY, String(days));
      } catch {
        /* ignore */
      }
      if (days === 0) setToastMessage("Backup reminders turned off.");
      else setToastMessage(days === 7 ? "Backup reminder set: weekly." : "Backup reminder set: monthly.");
    },
    [],
  );

  const onBackupFileChosen = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBackupJson(text);
      if (!parsed) {
        setToastMessage("That file is not a valid HoroLair backup.");
        return;
      }
      setImportPreview(parsed);
    } catch {
      setToastMessage("Could not read that file.");
    }
  }, []);

  const onLoadDemo = useCallback(() => {
    setWatches((prev) => [...getDemoWatches(), ...prev]);
    requestAnimationFrame(() => {
      goMainView("collection");
    });
  }, [goMainView]);

  const onClearDemoWatches = useCallback(() => {
    setWatches((prev) => prev.filter((w) => !w.isDemo));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-2 border-[hsla(42,38%,52%,0.95)] bg-black/50 backdrop-blur-md">
        <div
          className={classNames(
            "mx-auto max-w-6xl px-4 py-3.5 sm:py-4 md:py-5",
            "flex min-w-0 flex-col items-stretch gap-y-4 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4 md:gap-y-3",
          )}
        >
          <Link
            href="/"
            className="inline-flex min-h-[40px] w-fit items-center rounded-xl border border-[hsla(42,38%,52%,0.58)] bg-black/30 px-3 py-2 text-[12px] font-medium tracking-wide text-white/68 transition hover:border-[hsla(44,44%,62%,0.86)] hover:text-white md:order-none"
          >
            &larr; Back to Home
          </Link>
          <div className="flex min-w-0 w-full flex-col items-start gap-y-3 md:w-auto md:min-w-0 md:flex-1">
            <div className="flex min-w-0 w-full items-center gap-2.5 sm:gap-3.5 md:min-w-0 md:flex-1">
              <div
                className={classNames(
                  "relative flex h-[3.5rem] w-[3.5rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-black/50 to-black/30 sm:h-16 sm:w-16 md:h-[4.25rem] md:w-[4.25rem]",
                  gold.frame,
                )}
              >
                <VaultMark className="h-10 w-10 sm:h-12 sm:w-12 md:h-14 md:w-14" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={classNames(
                    vaultSerif.className,
                    "bg-gradient-to-b from-[hsla(46,50%,99%,0.99)] via-[hsla(44,42%,90%,0.98)] to-[hsla(42,40%,68%,0.97)] bg-clip-text text-[1.35rem] font-bold leading-[1.05] tracking-[0.03em] text-transparent drop-shadow-[0_1px_14px_rgba(0,0,0,0.55)] min-[380px]:text-[1.55rem] min-[400px]:text-[1.75rem] sm:text-[2.1rem] sm:tracking-[0.05em] md:text-[2.42rem] md:tracking-[0.055em]",
                  )}
                >
                  HoroLair
                </p>
                <p className="mt-1 hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsla(44,38%,76%,0.88)] sm:mt-1.5 sm:text-xs sm:tracking-[0.2em] md:block">
                  Private. Local. Yours.
                </p>
              </div>
            </div>
            <p
              className={classNames(
                "w-full min-w-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsla(44,40%,78%,0.9)] sm:text-xs sm:tracking-[0.2em]",
                "pl-[calc(3.5rem+0.625rem)] sm:pl-[calc(4rem+0.875rem)] md:hidden",
              )}
            >
              Private. Local. Yours.
            </p>
          </div>

          <nav
            className="flex w-full min-w-0 flex-wrap items-stretch gap-3 md:w-auto md:max-w-none md:flex-nowrap md:items-center md:justify-end md:gap-2"
            aria-label="Main views"
          >
            <button
              type="button"
              onClick={() => goMainView("dashboard")}
              className={classNames(
                "min-h-[44px] max-md:inline-flex max-md:flex-1 max-md:min-w-[110px] max-md:items-center max-md:justify-center rounded-xl px-2.5 text-[12px] font-semibold tracking-wide sm:px-3 sm:text-[13px] md:inline-flex md:min-w-0 md:flex-none",
                mainNavView === "dashboard" ? gold.btnSmPrimary : gold.btnSmSecondary,
              )}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={goAddWatchFromClick}
              className={classNames(
                "min-h-[44px] max-md:inline-flex max-md:flex-1 max-md:min-w-[110px] max-md:items-center max-md:justify-center rounded-xl px-2.5 text-[12px] font-semibold tracking-wide sm:px-3 sm:text-[13px] md:inline-flex md:min-w-0 md:flex-none",
                mainNavView === "add-watch" ? gold.btnSmPrimary : gold.btnSmSecondary,
              )}
            >
              Add Watch
            </button>
            <button
              type="button"
              onClick={() => goMainView("collection")}
              className={classNames(
                "min-h-[44px] max-md:inline-flex max-md:flex-1 max-md:min-w-[110px] max-md:items-center max-md:justify-center rounded-xl px-2.5 text-[12px] font-semibold tracking-wide sm:px-3 sm:text-[13px] md:inline-flex md:min-w-0 md:flex-none",
                mainNavView === "collection" ? gold.btnSmPrimary : gold.btnSmSecondary,
              )}
            >
              Collection
            </button>
            <a
              href={FEEDBACK_MAILTO}
              className={classNames(
                "hidden min-h-[40px] items-center rounded-xl px-2.5 text-[13px] font-medium tracking-wide text-[hsla(44,34%,68%,0.95)] underline-offset-4 hover:text-white/90 sm:inline-flex",
              )}
            >
              Feedback
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <input
          ref={backupImportRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void onBackupFileChosen(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        {watchesHydrated && indexedDbUnavailable && !collectionPersistenceWarning ? (
          <div className="pt-4" role="status">
            <div
              className={classNames(
                "rounded-2xl border border-amber-200/18 bg-amber-200/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-50/88",
                gold.frameLg,
              )}
            >
              <p className="text-[11px] font-medium uppercase tracking-widest text-amber-100/55">Storage</p>
              <p className="mt-1.5">
                Encrypted collection storage (IndexedDB) is not available in this browser profile. HoroLair will use local
                storage only — export a JSON backup regularly, especially on iPhone.
              </p>
            </div>
          </div>
        ) : null}
        {watchesHydrated && collectionPersistenceWarning ? (
          <div className="pt-4" role="alert">
            <div
              className={classNames(
                "rounded-2xl border border-amber-200/22 bg-amber-200/[0.07] px-4 py-3 text-[13px] leading-relaxed text-amber-50/92",
                gold.frameLg,
              )}
            >
              <p className="text-[11px] font-medium uppercase tracking-widest text-amber-100/55">Save notice</p>
              <p className="mt-1.5">{collectionPersistenceWarning}</p>
            </div>
          </div>
        ) : null}
        {mainNavView === "dashboard" ? (
          <section id="dashboard" className="scroll-mt-24 pb-10 pt-6 sm:pt-8 lg:pt-10">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className={classNames("mb-4 inline-flex items-center gap-2", gold.pill)}>PRIVATE VAULT</p>
                <h1
                  className={classNames(
                    vaultSerif.className,
                    "text-balance text-[2.35rem] font-bold leading-[0.98] tracking-[0.01em] text-white/96 sm:text-[3.25rem] lg:text-[3.65rem]",
                  )}
                >
                  The vault at a glance
                </h1>
                <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-white/66 sm:text-base">
                  A quiet overview of your watches, valuation gaps, recent additions, and local backups.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
                <button type="button" onClick={goAddWatchFromClick} className={classNames("min-h-[48px] sm:min-w-[12rem]", gold.btnPrimary)}>
                  Add Watch
                </button>
                <button type="button" onClick={() => goMainView("collection")} className={classNames("min-h-[48px] sm:min-w-[11rem]", gold.btnSecondary)}>
                  View collection
                </button>
              </div>
            </div>

            <div className="mt-6">
              <VaultAtmospherePanel
                watch={collectionCoverWatch}
                imageSrc={collectionCoverImageSrc}
                collectionLabel={watchesHydrated ? collectionLabel : "Loading collection"}
                onAddWatch={goAddWatchFromClick}
              />
            </div>

            <div className="mt-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardMetricCard
                label="Saved watches"
                value={!watchesHydrated ? "—" : String(watches.length)}
                helper={!watchesHydrated ? "Loading your local collection..." : collectionLabel}
              />
              <DashboardMetricCard
                label="Total collection value"
                value={dashboardTotalValueDisplay}
                helper={dashboardTotalValueHelper}
                tone={dashboardTotalValueNeedsData ? "attention" : "default"}
              />
              <DashboardMetricCard
                label="Missing value data"
                value={!watchesHydrated ? "—" : String(watchesMissingValueData)}
                helper="Watches missing purchase or current value fields."
                tone={watchesHydrated && watchesMissingValueData > 0 ? "attention" : "default"}
              />
              <DashboardMetricCard
                label="Brands represented"
                value={!watchesHydrated ? "—" : String(brandsRepresented)}
                helper={mostCommonBrand ? `Most represented: ${mostCommonBrand}.` : "A picture of collection breadth."}
              />
            </div>

            <div className="mt-4 grid gap-3 rounded-3xl border border-[hsla(42,32%,52%,0.36)] bg-black/24 p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42">Most worn</p>
                <p className="mt-1 truncate text-sm font-semibold text-white/86">
                  {mostWornWatch ? `${mostWornWatch.brand} ${mostWornWatch.model}` : "—"}
                </p>
                <p className="mt-1 text-[12px] text-white/44">{mostWornWatch ? `${mostWornWatch.wearCount ?? 0} wears` : "Start tracking wear."}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42">Newest addition</p>
                <p className="mt-1 truncate text-sm font-semibold text-white/86">
                  {newestAddition ? `${newestAddition.brand} ${newestAddition.model}` : "—"}
                </p>
                <p className="mt-1 text-[12px] text-white/44">{newestAddition ? "Latest catalogue entry." : "Add your first watch."}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42">Average value</p>
                <p className="mt-1 truncate text-sm font-semibold text-white/86">
                  {averageCollectionValue ? formatCollectionCurrency(averageCollectionValue, collectionCurrency) : "—"}
                </p>
                <p className="mt-1 text-[12px] text-white/44">Based on watches with current value data.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <DashboardRecentWatches
                watches={recentlyAddedWatches}
                isLoading={!watchesHydrated}
                resolvedPhotoUrls={resolvedPhotoUrls}
                currency={collectionCurrency}
                onOpenDetail={setDetailWatch}
                onAddWatch={goAddWatchFromClick}
              />

              <div className={classNames("rounded-3xl p-4 sm:p-5", gold.frameLg)}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,44%,74%,0.86)]">
                  Collection controls
                </p>
                <div className="mt-4 rounded-2xl border border-[hsla(42,34%,48%,0.5)] bg-black/28 p-3.5">
                  <p className="text-[12px] font-semibold uppercase tracking-widest text-white/52">Currency</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/48">
                    Display and entry currency. Values are not converted when you switch.
                  </p>
                  <div className="mt-3">
                    <CurrencyDropdown value={collectionCurrency} onChange={setCollectionCurrency} />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[hsla(42,34%,48%,0.5)] bg-black/28 p-3.5">
                  <p className="text-[12px] font-semibold uppercase tracking-widest text-white/52">Local backup</p>
                  <p className="mt-1 text-sm text-white/70">Last export: {backupLastLabel}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/48">
                    HoroLair stores your collection locally. Export a JSON backup regularly, especially on mobile browsers.
                  </p>
                  {watchStorageIssue && watches.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-amber-200/18 bg-amber-200/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-50/88">
                      {watchStorageIssueUserMessage(watchStorageIssue)}
                    </div>
                  ) : null}
                  {backupIsDue ? (
                    <div className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/5 px-3 py-2 text-[12px] text-amber-100/85">
                      Backup recommended. Export a JSON backup to keep a copy.
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void onExportBackup()} className={classNames("min-h-[44px]", gold.btnSmPrimary)}>
                      Export backup
                    </button>
                    <button
                      type="button"
                      onClick={() => backupImportRef.current?.click()}
                      className={classNames("min-h-[44px]", gold.btnSmSecondary)}
                    >
                      Import backup
                    </button>
                    <button type="button" onClick={onExportCsv} className={classNames("min-h-[44px]", gold.btnSmSecondary)}>
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => void onExportCollectionPdf()}
                      className={classNames("min-h-[44px]", gold.btnSmSecondary)}
                    >
                      Export PDF
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[hsla(42,34%,48%,0.5)] bg-black/28 p-3.5">
                  <p className="text-[12px] font-semibold uppercase tracking-widest text-white/52">Backup reminder</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/48">
                    Optional local reminder shown in this dashboard.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setBackupReminder(0)}
                      className={classNames("min-h-[40px]", backupReminderDays === 0 ? gold.btnSmPrimary : gold.btnSmSecondary)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackupReminder(7)}
                      className={classNames("min-h-[40px]", backupReminderDays === 7 ? gold.btnSmPrimary : gold.btnSmSecondary)}
                    >
                      Weekly
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackupReminder(30)}
                      className={classNames("min-h-[40px]", backupReminderDays === 30 ? gold.btnSmPrimary : gold.btnSmSecondary)}
                    >
                      Monthly
                    </button>
                  </div>
                </div>

                {showSubtleNeverExportedBackupCue ? (
                  <p className="mt-3 rounded-xl border border-[hsla(42,36%,44%,0.58)] bg-black/30 px-3 py-2 text-[12px] leading-relaxed text-[hsla(44,38%,80%,0.88)]">
                    Backup recommended: export your collection to avoid losing local data.
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
        {mainNavView === "add-watch" ? (
        <section
          id="add-watch"
          className={classNames("scroll-mt-24 rounded-[2rem] p-5 backdrop-blur sm:p-8", gold.frameLg)}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[hsla(44,40%,74%,0.82)]">
                Catalogue entry
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white/94">
                {editingWatchId ? "Edit watch" : "Add a watch"}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/62">
                A short guided flow — photos first, then details, ownership, and notes. Nothing leaves this browser until
                you export.
              </p>
            </div>
            <div className="shrink-0 text-right text-xs leading-relaxed tracking-wide text-white/48">
              <p>Step {addWatchStep} of {ADD_WATCH_STEP_COUNT}</p>
              <p className="mt-1">Local-only · No sign-in</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Add watch steps">
            {(["Photos", "Core details", "Ownership & value", "Notes & review"] as const).map((label, i) => {
              const n = i + 1;
              const active = addWatchStep === n;
              return (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setAddWatchStep(n)}
                  className={classNames(
                    "min-h-[40px] rounded-full border-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition sm:px-4",
                    active
                      ? "border-[hsla(44,42%,58%,0.95)] bg-white/[0.08] text-[hsla(46,46%,94%,0.98)]"
                      : "border-[hsla(42,32%,38%,0.55)] bg-black/25 text-white/55 hover:border-[hsla(44,36%,48%,0.75)] hover:text-white/75",
                  )}
                >
                  {n}. {label}
                </button>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (addWatchStep === ADD_WATCH_STEP_COUNT) void onAddWatch(e);
            }}
            className="mt-8 space-y-8"
          >
            {addWatchStep === 1 ? (
              <div className="mx-auto max-w-4xl space-y-6">
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-white/92">Photograph</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                    Add a clear photo of the watch. HoroLair uses it for restrained thumbnails and, when suitable, the
                    optional vault atmosphere image.
                  </p>
                </div>
                <div className={classNames("overflow-hidden rounded-[1.6rem] bg-black/25", gold.frame)}>
                  <div className="grid gap-0 lg:grid-cols-[1.08fr_0.92fr]">
                    <div className="aspect-[4/3] p-4 sm:p-5 lg:aspect-auto">
                      <div className="relative h-full min-h-[18rem] overflow-hidden rounded-2xl">
                        <EditorialWatchImage src={photoPreviewUrl} alt="Photo preview" variant="preview" />
                        {!photoPreviewUrl ? (
                          <div className="pointer-events-none absolute inset-x-6 bottom-6 rounded-2xl border border-[hsla(42,34%,54%,0.34)] bg-black/36 p-4 text-center backdrop-blur-sm">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,42%,76%,0.78)]">
                              Watch photograph
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-white/64">
                              Use a quiet wrist shot, dial close-up, or provenance image.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="border-t-2 border-[hsla(42,34%,40%,0.75)] p-4 sm:p-5 lg:border-l-2 lg:border-t-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/48">Image treatment</p>
                      <p className="mt-2 text-[13px] leading-relaxed text-white/58">
                        Photos are kept practical for identification, then displayed with restrained monochrome overlays in the
                        archive.
                      </p>
                      <label className="mt-5 grid gap-2.5">
                      <span className="text-[13px] font-medium tracking-wide text-white/68">Upload image</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => void onPickPhotos(e.target.files)}
                        className="block w-full min-h-[48px] text-[13px] font-medium text-white/80 file:mr-3 file:rounded-xl file:border-2 file:border-[hsla(42,36%,48%,0.9)] file:bg-black/45 file:px-3 file:py-2.5 file:text-[13px] file:font-medium file:text-white/90 hover:file:border-[hsla(44,40%,58%,0.96)] hover:file:bg-black/55"
                      />
                    </label>
                    {photoGalleryPreviewUrls.length > 1 ? (
                      <div className="mt-4 grid grid-cols-4 gap-2">
                        {photoGalleryPreviewUrls.map((url, index) => (
                          <button
                            key={`${url}-${index}`}
                            type="button"
                            onClick={() => {
                              setPhotoPreviewUrl(url);
                              setPrimaryPhotoIndex(index);
                            }}
                            className={classNames(
                              "relative aspect-square overflow-hidden rounded-xl border bg-black/40",
                              primaryPhotoIndex === index ? "border-[hsla(44,44%,70%,0.78)]" : "border-white/12",
                            )}
                            aria-label={`Set photo ${index + 1} as primary`}
                          >
                            <img src={url} alt="" className="h-full w-full object-cover grayscale saturate-[0.5] brightness-[0.82]" />
                            {primaryPhotoIndex === index ? (
                              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/80">
                                Primary
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4">
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="w-full cursor-not-allowed rounded-xl border-2 border-dashed border-[hsla(42,32%,38%,0.65)] bg-black/30 px-4 py-3 text-left text-[13px] font-medium text-white/45"
                      >
                        Identify watch from photo — coming soon
                      </button>
                    </div>
                    {(photoPreviewUrl || editingWatchId) && (
                      <button
                        type="button"
                        className={classNames("mt-4 w-full min-h-[48px]", gold.btnSmSecondary)}
                        onClick={() => {
                          setPhotoRemoveRequested(true);
                          pendingPhotoBlobRef.current = null;
                          setPhotoPreviewUrl((prev) => {
                            if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
                            return undefined;
                          });
                        }}
                      >
                        Remove photo
                      </button>
                    )}
                    <p className="mt-4 text-[12px] leading-relaxed text-white/50">
                      Images are resized (max ~1600px) and saved as JPEG in this browser. Older entries with inline photos
                      still work.
                    </p>
                    <p className="mt-2 text-[12px] leading-relaxed text-white/52">
                      Photos and details stay in your private vault.
                    </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {addWatchStep === 2 ? (
              <div className="mx-auto max-w-3xl space-y-7">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-white/90">Core details</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                    Identity of the piece. You can edit these details later.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-6">
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Brand *</span>
                    <input
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. Rolex"
                      autoComplete="off"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Model *</span>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. Submariner Date"
                      autoComplete="off"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Reference</span>
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="126610LN"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Year</span>
                    <input
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="2024"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="grid gap-2.5 sm:col-span-2">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Serial number</span>
                    <input
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="Optional — omit or redact if you prefer"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Case size</span>
                    <input
                      value={caseSizeStr}
                      onChange={(e) => setCaseSizeStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. 40 mm"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Movement</span>
                    <input
                      value={movementStr}
                      onChange={(e) => setMovementStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. Automatic calibre 3235"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Lug-to-lug</span>
                    <input
                      value={lugToLugStr}
                      onChange={(e) => setLugToLugStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. 47 mm"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Water resistance</span>
                    <input
                      value={waterResistanceStr}
                      onChange={(e) => setWaterResistanceStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. 100 m"
                    />
                  </label>
                  <label className="grid gap-2.5 sm:col-span-2">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Complication / style</span>
                    <input
                      value={complicationStyleStr}
                      onChange={(e) => setComplicationStyleStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. Diver, GMT, chronograph, dress"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {addWatchStep === 3 ? (
              <div className="mx-auto max-w-3xl space-y-7">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-white/90">Ownership &amp; value</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                    Estimated value can be approximate. Purchase and value amounts use your collection currency below.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-6">
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">
                      Purchase price ({CURRENCIES.find((c) => c.code === collectionCurrency)?.label ?? collectionCurrency})
                    </span>
                    <input
                      value={purchasePriceStr}
                      onChange={(e) => setPurchasePriceStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="12000"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">{estimatedFieldLabel}</span>
                    <input
                      value={estimatedValue}
                      onChange={(e) => setEstimatedValue(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="8500"
                      inputMode="numeric"
                    />
                  </label>
                  <p className="sm:col-span-2 text-[12px] leading-relaxed text-white/52">
                    Uses your collection currency setting.
                  </p>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Purchase date</span>
                    <input
                      value={purchaseDateStr}
                      onChange={(e) => setPurchaseDateStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="e.g. 2019-06 or June 2019"
                    />
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Seller / source</span>
                    <input
                      value={sellerStr}
                      onChange={(e) => setSellerStr(e.target.value)}
                      className={classNames(gold.input, gold.focus, "min-h-[52px]")}
                      placeholder="AD, private sale, auction…"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {addWatchStep === 4 ? (
              <div className="mx-auto max-w-3xl space-y-7">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-white/90">Notes &amp; review</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                    Condition, provenance notes, and anything you want to remember. Review the summary, then save.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-6">
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Condition</span>
                    <select
                      value={condition}
                      onChange={(e) => setCondition((e.target.value || "") as WatchCondition | "")}
                      className={classNames(gold.input, gold.focus, "min-h-[52px] cursor-pointer")}
                    >
                      <option value="">—</option>
                      {ALL_WATCH_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {CONDITION_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Box &amp; papers</span>
                    <select
                      value={boxPapers}
                      onChange={(e) => setBoxPapers((e.target.value || "") as WatchBoxPapers | "")}
                      className={classNames(gold.input, gold.focus, "min-h-[52px] cursor-pointer")}
                    >
                      <option value="">—</option>
                      {ALL_WATCH_BOXPAPERS.map((b) => (
                        <option key={b} value={b}>
                          {BOXPAPERS_LABELS[b]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sm:col-span-2 grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Service history</span>
                    <textarea
                      value={serviceHistory}
                      onChange={(e) => setServiceHistory(e.target.value)}
                      className={classNames("min-h-[110px] resize-y", gold.input, gold.focus)}
                      placeholder="Last service, work done, dates…"
                    />
                  </label>
                  <label className="sm:col-span-2 grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Provenance notes</span>
                    <textarea
                      value={provenanceNotesStr}
                      onChange={(e) => setProvenanceNotesStr(e.target.value)}
                      className={classNames("min-h-[90px] resize-y", gold.input, gold.focus)}
                      placeholder="Original owner, full set story, important context…"
                    />
                  </label>
                  <label className="sm:col-span-2 grid gap-2.5">
                    <span className="text-[13px] font-medium tracking-wide text-white/65">Personal notes</span>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={classNames("min-h-[100px] resize-y", gold.input, gold.focus)}
                      placeholder="Dial, bracelet, story…"
                    />
                  </label>
                </div>

                <div className={classNames("rounded-2xl p-4 sm:p-5", gold.frame)}>
                  <p className="text-[12px] font-semibold uppercase tracking-widest text-white/55">Summary</p>
                  <dl className="mt-4 grid gap-2.5 text-[13px] sm:grid-cols-2">
                    <div className="flex justify-between gap-3 border-b border-white/10 pb-2 sm:block sm:border-0 sm:pb-0">
                      <dt className="text-white/50">Brand / model</dt>
                      <dd className="font-medium text-white/90">
                        {(brand.trim() || "—") + " " + (model.trim() || "")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-white/10 pb-2 sm:block sm:border-0 sm:pb-0">
                      <dt className="text-white/50">Reference</dt>
                      <dd className="font-medium text-white/90">{reference.trim() || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-white/10 pb-2 sm:block sm:border-0 sm:pb-0">
                      <dt className="text-white/50">Year</dt>
                      <dd className="font-medium text-white/90">{year.trim() || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-white/10 pb-2 sm:block sm:border-0 sm:pb-0">
                      <dt className="text-white/50">Case / movement</dt>
                      <dd className="font-medium text-white/90">
                        {[caseSizeStr.trim(), movementStr.trim()].filter(Boolean).join(" · ") || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-white/10 pb-2 sm:block sm:border-0 sm:pb-0">
                      <dt className="text-white/50">Photo</dt>
                      <dd className="font-medium text-white/90">
                        {photoRemoveRequested ? "Removed" : photoPreviewUrl ? "Attached" : editingWatchId ? "Existing" : "None"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-white/10 pb-2 sm:block sm:border-0 sm:pb-0">
                      <dt className="text-white/50">Est. value</dt>
                      <dd className="font-medium text-white/90">
                        {estimatedValue.trim()
                          ? previewValueDisplay(estimatedValue, collectionCurrency)
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-3 border-t border-[hsla(42,32%,32%,0.45)] pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={goAddWatchBack}
                  disabled={addWatchStep <= 1}
                  className={classNames(
                    "min-h-[48px] px-5",
                    addWatchStep <= 1 ? "cursor-not-allowed opacity-40" : "",
                    gold.btnSecondary,
                  )}
                >
                  Back
                </button>
                {editingWatchId ? (
                  <button type="button" onClick={onCancelEdit} className={classNames("min-h-[48px] px-5", gold.btnSmSecondary)}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {addWatchStep < ADD_WATCH_STEP_COUNT ? (
                  <button type="button" onClick={goAddWatchNext} className={classNames("min-h-[48px] min-w-[8rem]", gold.btnPrimary)}>
                    Next
                  </button>
                ) : (
                  <button type="submit" className={classNames("min-h-[48px] min-w-[10rem]", gold.btnPrimary)}>
                    Save watch
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
        ) : null}
        {mainNavView === "collection" ? (
        <section id="collection" className="scroll-mt-24 pb-16 pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[hsla(44,40%,74%,0.82)]">Collection</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white/94">Private archive</h2>
              <p className="mt-1 text-sm leading-relaxed text-white/58">Curated records for the watches that matter to you.</p>
            </div>
            <div className="flex flex-wrap items-end justify-end gap-2 sm:items-center">
              <div className="flex rounded-2xl border border-[hsla(42,34%,50%,0.52)] bg-black/34 p-1">
                <button
                  type="button"
                  onClick={() => setCollectionDisplayMode("grid")}
                  className={classNames(
                    "min-h-[38px] rounded-xl px-3 text-[12px] font-semibold tracking-wide transition",
                    collectionDisplayMode === "grid" ? "bg-white/[0.08] text-white/92" : "text-white/52 hover:text-white/78",
                  )}
                >
                  Grid
                </button>
                <button
                  type="button"
                  onClick={() => setCollectionDisplayMode("compact")}
                  className={classNames(
                    "min-h-[38px] rounded-xl px-3 text-[12px] font-semibold tracking-wide transition",
                    collectionDisplayMode === "compact" ? "bg-white/[0.08] text-white/92" : "text-white/52 hover:text-white/78",
                  )}
                >
                  Compact
                </button>
              </div>
              <button
                type="button"
                onClick={() => void onExportBackup()}
                className={classNames("min-h-[44px]", gold.btnSmSecondary)}
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => backupImportRef.current?.click()}
                className={classNames("min-h-[44px]", gold.btnSmSecondary)}
              >
                Import JSON
              </button>
              <button
                type="button"
                onClick={() => void onExportCollectionPdf()}
                className={classNames("min-h-[44px] rounded-2xl px-4 py-2", gold.btnSmSecondary)}
              >
                Export PDF report
              </button>
              <button
                type="button"
                onClick={goAddWatchFromClick}
                className={classNames("min-h-[44px] rounded-2xl px-4 py-2", gold.btnSmSecondary)}
              >
                Add another
              </button>
            </div>
          </div>

          <div className={classNames("mt-6 grid gap-3 rounded-3xl p-4 sm:grid-cols-2 lg:grid-cols-[1.25fr_0.8fr_0.8fr_0.9fr]", gold.frameLg)}>
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/46">Search archive</span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={classNames(gold.input, gold.focus, "min-h-[46px] py-2.5")}
                placeholder="Brand, model, reference..."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/46">Brand</span>
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className={classNames(gold.input, gold.focus, "min-h-[46px] py-2.5")}
              >
                <option value="all">All brands</option>
                {brandFilterOptions.map((brandName) => (
                  <option key={brandName} value={brandName}>
                    {brandName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/46">Style</span>
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
                className={classNames(gold.input, gold.focus, "min-h-[46px] py-2.5")}
              >
                <option value="all">All styles</option>
                {styleFilterOptions.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/46">Filter</span>
              <select
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value as CollectionFilter)}
                className={classNames(gold.input, gold.focus, "min-h-[46px] py-2.5")}
              >
                <option value="all">All watches</option>
                <option value="service">Has service history</option>
                <option value="missing-values">Missing values</option>
                <option value="most-worn">Most worn first</option>
              </select>
            </label>
          </div>

          {!watchesHydrated ? (
            <div className={classNames("mt-6 rounded-3xl p-8 text-center text-sm text-white/62", gold.frameLg)}>
              Loading collection...
            </div>
          ) : watchStorageIssue && watches.length === 0 && !watchStorageIssueDismissed ? (
            <div className={classNames("mt-6 rounded-3xl p-8 sm:p-10", gold.frameLg)} role="alert">
              <div className="mx-auto max-w-lg text-center">
                <p className={classNames("mx-auto inline-flex rounded-full px-3 py-1 text-[11px] tracking-widest", gold.pill)}>
                  STORAGE READ ISSUE
                </p>
                <p className="mt-5 text-lg font-semibold tracking-tight text-white/92">We could not load your saved watches</p>
                <p className="mt-3 text-sm leading-relaxed text-white/62">{watchStorageIssueUserMessage(watchStorageIssue)}</p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => backupImportRef.current?.click()}
                    className={classNames("min-h-[48px] w-full sm:w-auto sm:min-w-[200px]", gold.btnPrimary)}
                  >
                    Import JSON backup
                  </button>
                  <button
                    type="button"
                    onClick={goAddWatchFromClick}
                    className={classNames("min-h-[48px] w-full sm:w-auto sm:min-w-[200px]", gold.btnSecondary)}
                  >
                    Add a watch (new collection)
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setWatchStorageIssueDismissed(true)}
                  className="mt-6 text-xs tracking-wide text-white/45 underline decoration-white/25 underline-offset-4 hover:text-white/70"
                >
                  Dismiss this notice
                </button>
              </div>
            </div>
          ) : watches.length === 0 ? (
            <>
              {noWatchDataFound ? (
                <p className="mt-6 rounded-2xl border border-[hsla(42,34%,48%,0.38)] bg-black/24 px-4 py-3 text-sm leading-relaxed text-white/58">
                  No collection data was found in this browser. If you have a backup file, import it to restore your collection.
                </p>
              ) : null}
              <div className="mt-6">
                <CollectorEmptyState
                  title="Your vault is empty."
                  body="Start documenting the watches that matter to you. Add photos, references, provenance notes, and value data in a private local archive."
                  primaryLabel="Add first watch"
                  onPrimary={goAddWatchFromClick}
                  secondaryLabel="Load demo collection"
                  onSecondary={onLoadDemo}
                />
                <p className="mx-auto mt-5 max-w-md text-center text-xs leading-relaxed text-white/42">
                  Demo entries are labelled &ldquo;Demo&rdquo; and can be removed with one tap after you load them.
                </p>
              </div>
            </>
          ) : (
            <div
              className={classNames(
                "mt-6",
                collectionDisplayMode === "grid" ? "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-3",
              )}
            >
              {watches.some((w) => w.isDemo) ? (
                <div className="col-span-full flex flex-col gap-3 rounded-2xl border-2 border-dashed border-[hsla(42,36%,48%,0.58)] bg-black/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-white/70">
                    <span className="font-semibold text-[hsla(38,44%,88%,0.95)]">Demo samples</span> in your list — remove
                    them anytime without touching your real watches.
                  </p>
                  <button type="button" onClick={onClearDemoWatches} className={classNames("min-h-[44px] shrink-0", gold.btnSmSecondary)}>
                    Clear demo watches
                  </button>
                </div>
              ) : null}
              {filteredWatches.length === 0 ? (
                <div className="col-span-full rounded-3xl border border-dashed border-[hsla(42,34%,48%,0.5)] bg-black/24 p-8 text-center">
                  <p className="text-base font-semibold text-white/82">No watches match this archive view.</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/52">Try clearing search or changing the filters.</p>
                </div>
              ) : null}
              {filteredWatches.map((w) =>
                collectionDisplayMode === "grid" ? (
                  <WatchCard
                    key={w.id}
                    watch={w}
                    displaySrc={resolvedPhotoUrls[w.id]}
                    onDelete={onDeleteWatch}
                    onEdit={onStartEdit}
                    onOpenDetail={setDetailWatch}
                    currency={collectionCurrency}
                  />
                ) : (
                  <CompactWatchRow
                    key={w.id}
                    watch={w}
                    displaySrc={resolvedPhotoUrls[w.id]}
                    onDelete={onDeleteWatch}
                    onEdit={onStartEdit}
                    onOpenDetail={setDetailWatch}
                    currency={collectionCurrency}
                  />
                ),
              )}
            </div>
          )}
        </section>
        ) : null}

        <footer className="mx-auto max-w-6xl border-t-2 border-[hsla(42,34%,34%,0.58)] px-4 pb-16 pt-10">
          <p className="max-w-2xl text-sm leading-relaxed text-white/58">
            HoroLair stores your collection locally on this device and browser — private, with no account or cloud
            database. Watches added here do not appear on other devices by themselves; export a backup and import it where
            you want your collection to live next. On phones, browsers may discard site data to save space — keep a JSON export
            you trust.
          </p>
          <a
            href={FEEDBACK_MAILTO}
            className="mt-4 inline-flex min-h-[44px] items-center text-[0.9375rem] font-medium tracking-wide text-[hsla(44,36%,72%,0.96)] underline decoration-[hsla(42,36%,46%,0.78)] underline-offset-4 hover:text-white/90"
          >
            Beta feedback
          </a>
        </footer>
      </main>

      {toastMessage ? (
        <div
          className="fixed bottom-6 left-1/2 z-[130] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border-2 border-[hsla(44,42%,56%,0.92)] bg-[#0c0c0f]/95 px-4 py-3 text-center text-[0.9375rem] font-medium text-white/90 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.85)] backdrop-blur-md"
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}

      {importPreview ? (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className={classNames("max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl p-6 sm:p-7", gold.frameLg)}>
            <p className="text-[11px] tracking-widest text-white/55">IMPORT BACKUP</p>
            <h3 className="mt-2 text-lg font-semibold text-white/95">Apply this backup?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/62">
              This file contains <span className="font-semibold text-white/85">{importPreview.watches.length}</span>{" "}
              watches
              {importPreview.exportedAt ? (
                <>
                  {" "}
                  (exported {new Date(importPreview.exportedAt).toLocaleString()})
                </>
              ) : null}
              .
            </p>
            {watches.length > 0 ? (
              <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/5 px-3 py-2 text-sm text-amber-100/85">
                You already have {watches.length} saved watch{watches.length === 1 ? "" : "es"}. Replacing will remove the
                current collection from this browser (export first if unsure). Merging keeps your current watches and adds
                the backup.
              </p>
            ) : null}
            <div className="mt-6 grid gap-2">
              <button
                type="button"
                onClick={() => void applyImport(importPreview, "replace")}
                className={classNames("min-h-[48px]", gold.btnPrimary)}
              >
                Replace current collection
              </button>
              <button
                type="button"
                onClick={() => void applyImport(importPreview, "merge")}
                className={classNames("min-h-[48px]", gold.btnSecondary)}
              >
                Merge with current collection
              </button>
              <button type="button" onClick={() => setImportPreview(null)} className={classNames("min-h-[48px]", gold.btnSmSecondary)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailWatch ? (
        <WatchDetailPanel
          watch={detailWatch}
          displaySrc={resolvedPhotoUrls[detailWatch.id]}
          gallerySrcs={resolvedPhotoGalleryUrls[detailWatch.id]}
          currency={collectionCurrency}
          onClose={() => setDetailWatch(null)}
          onEdit={(w) => {
            void onStartEdit(w);
          }}
          onMarkWorn={onMarkWorn}
          onAddTimelineEntry={onAddTimelineEntry}
        />
      ) : null}
    </div>
  );
}

