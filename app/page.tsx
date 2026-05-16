"use client";

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
  type WatchStorageLoadIssue,
  parseBackupJson,
  watchStorageIssueUserMessage,
} from "@/lib/watchNormalize";
import {
  WRISTFOLIO_BACKUP_LAST_EXPORTED_AT_KEY,
  WRISTFOLIO_BACKUP_REMINDER_DAYS_KEY,
  WRISTFOLIO_COLLECTION_CURRENCY_KEY,
} from "@/lib/watchStorageKeys";
import { deleteWatchImage, getWatchImageBlob, saveWatchImage } from "@/lib/wristfolioIdb";

const FEEDBACK_MAILTO =
  "mailto:DrASchuter@proton.me?subject=" +
  encodeURIComponent("Wristfolio beta feedback") +
  "&body=" +
  encodeURIComponent("Hi, I tested Wristfolio and my feedback is…");

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
      reference: "5226G-001",
      year: "2023",
      serialNumber: "DEMO-PP-001",
      purchasePrice: 38000,
      estimatedValue: 42000,
      condition: "excellent",
      boxPapers: "full_set",
      serviceHistory: "Demo sample — timing checked 2024.",
      notes: "Sample entry for the private beta. Clear demo watches anytime.",
      createdAt: t - 5000,
      isDemo: true,
    },
    {
      id: crypto.randomUUID(),
      brand: "Rolex",
      model: "Submariner Date",
      reference: "126610LN",
      year: "2022",
      estimatedValue: 11500,
      condition: "very_good",
      boxPapers: "full_set",
      serviceHistory: "Demo — no real service history.",
      notes: "Demo sample.",
      createdAt: t - 4000,
      isDemo: true,
    },
    {
      id: crypto.randomUUID(),
      brand: "Omega",
      model: "Speedmaster Professional",
      reference: "310.30.42.50.01.001",
      year: "2021",
      purchasePrice: 5200,
      estimatedValue: 5800,
      condition: "good",
      boxPapers: "box_only",
      notes: "Demo sample — moonwatch vibes.",
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

function Placeholder() {
  return (
    <div
      className={classNames(
        "flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-white/[0.04] to-transparent",
        gold.frame,
      )}
    >
      <div className="text-center">
        <div
          className={classNames(
            "mx-auto mb-2 h-10 w-10 rounded-full bg-black/30",
            "border-2 border-[hsla(42,34%,50%,0.85)] shadow-[inset_0_1px_0_0_hsla(44,28%,58%,0.14)]",
          )}
        />
        <p className="text-[13px] font-medium tracking-wide text-white/62">No photo</p>
      </div>
    </div>
  );
}

const collectorHeroCards = [
  { title: "Dress", detail: "Moonphase", accent: "from-[hsla(44,48%,64%,0.24)]" },
  { title: "Sport", detail: "Chronograph", accent: "from-[hsla(42,44%,58%,0.2)]" },
  { title: "Diver", detail: "Daily rotation", accent: "from-[hsla(40,40%,52%,0.18)]" },
] as const;

function CollectorHeroCard({ title, detail, accent }: (typeof collectorHeroCards)[number]) {
  return (
    <div
      className={classNames(
        "relative min-h-[8.5rem] overflow-hidden rounded-2xl p-3 sm:min-h-[10rem] sm:p-4",
        gold.frame,
        `bg-gradient-to-br ${accent} via-white/[0.035] to-black/30`,
      )}
    >
      <div className="absolute inset-x-4 top-4 h-px bg-gradient-to-r from-transparent via-[hsla(44,44%,72%,0.45)] to-transparent" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex justify-center pt-3 sm:pt-4">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-[hsla(44,46%,68%,0.86)] bg-black/36 shadow-[inset_0_1px_0_0_hsla(45,40%,76%,0.22),0_14px_28px_-18px_hsla(42,46%,24%,0.55)] sm:h-16 sm:w-16">
            <div className="h-10 w-10 rounded-full border border-[hsla(44,40%,68%,0.44)] bg-[radial-gradient(circle_at_50%_38%,hsla(44,40%,70%,0.18),transparent_42%),linear-gradient(145deg,rgba(255,255,255,0.05),rgba(0,0,0,0.2))] sm:h-12 sm:w-12" />
            <span className="absolute top-2 h-1.5 w-px rounded-full bg-[hsla(44,52%,76%,0.85)]" />
            <span className="absolute h-px w-5 origin-left rotate-[28deg] rounded-full bg-[hsla(44,52%,76%,0.78)]" />
            <span className="absolute h-4 w-px origin-bottom -rotate-[36deg] rounded-full bg-[hsla(44,44%,68%,0.72)]" />
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,44%,74%,0.86)]">{title}</p>
          <p className="mt-1 truncate text-[13px] font-medium text-white/78">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function CollectorHeroPanel() {
  return (
    <div className={classNames("relative overflow-hidden rounded-3xl p-4 sm:p-5", gold.frameLg)}>
      <div className="absolute inset-0 bg-[radial-gradient(520px_260px_at_28%_18%,hsla(44,44%,58%,0.22),transparent_62%),radial-gradient(420px_240px_at_78%_85%,hsla(42,34%,44%,0.14),transparent_68%)]" />
      <div className="relative">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[hsla(44,46%,76%,0.88)]">
              Private watch vault
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white/94 sm:text-2xl">
              Catalogue, track and enjoy your collection.
            </h2>
          </div>
          <p className="max-w-[14rem] text-[12px] leading-relaxed text-white/54 sm:text-right">
            A calm local-first space for watches, photos, values and notes.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
          {collectorHeroCards.map((card) => (
            <CollectorHeroCard key={card.title} {...card} />
          ))}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {["Local", "Private", "Exportable"].map((label) => (
            <div
              key={label}
              className="rounded-xl border border-[hsla(42,40%,58%,0.42)] bg-black/24 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsla(44,44%,82%,0.86)]"
            >
              {label}
            </div>
          ))}
        </div>
      </div>
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
        "group relative flex flex-col overflow-hidden rounded-2xl backdrop-blur",
        gold.frame,
        gold.cardHover,
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetail(watch)}
        className="relative block w-full overflow-hidden bg-black/25 text-left"
        aria-label={`View details for ${watch.brand} ${watch.model}`}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          {src ? (
            <img
              src={src}
              alt={`${watch.brand} ${watch.model}`}
              draggable={false}
              className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.02]"
            />
          ) : (
            <Placeholder />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/25" />
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

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold tracking-wide text-white/93">{watch.brand}</p>
            <p className="mt-0.5 truncate text-[0.9375rem] font-medium text-white/76">{watch.model}</p>
          </div>
          <span className="hidden shrink-0 rounded-full border-2 border-[hsla(44,40%,56%,0.92)] bg-[hsla(40,24%,8%,0.82)] px-2 py-1 text-[11px] font-medium tracking-widest text-[hsla(46,46%,94%,0.97)] shadow-[inset_0_1px_0_0_hsla(44,32%,58%,0.22)] sm:inline">
            CATALOGUED
          </span>
        </div>

        {(watch.reference ||
          watch.year ||
          typeof watch.estimatedValue === "number" ||
          watch.condition ||
          watch.boxPapers) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {watch.reference ? <span className={gold.tag}>Ref. {watch.reference}</span> : null}
            {watch.year ? <span className={gold.tag}>Year {watch.year}</span> : null}
            {typeof watch.estimatedValue === "number" ? (
              <span className={gold.tag}>Est. {formatCollectionCurrency(watch.estimatedValue, currency)}</span>
            ) : null}
            {watch.condition ? <span className={gold.tag}>{CONDITION_LABELS[watch.condition]}</span> : null}
            {watch.boxPapers ? <span className={gold.tag}>{BOXPAPERS_LABELS[watch.boxPapers]}</span> : null}
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

function WatchDetailPanel({
  watch,
  displaySrc,
  currency,
  onClose,
  onEdit,
}: {
  watch: Watch;
  displaySrc?: string;
  currency: CollectionCurrency;
  onClose: () => void;
  onEdit: (w: Watch) => void;
}) {
  const src = displaySrc ?? watch.photoUrl;

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
          {src ? (
            <img
              src={src}
              alt={`${watch.brand} ${watch.model}`}
              className="h-full w-full max-h-[40vh] object-cover object-center sm:max-h-[360px]"
            />
          ) : (
            <div className="aspect-[16/10] max-h-[40vh] sm:max-h-[360px]">
              <Placeholder />
            </div>
          )}
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

          <dl className="mt-5 grid gap-3.5 text-[0.9375rem] leading-snug">
            {watch.reference ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Reference</dt>
                <dd className="text-right font-medium text-white/92">{watch.reference}</dd>
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
            {typeof watch.estimatedValue === "number" ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Estimated value</dt>
                <dd className="text-right font-medium text-white/92">
                  {formatCollectionCurrency(watch.estimatedValue, currency)}
                </dd>
              </div>
            ) : null}
            {watch.purchaseDate ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Purchase date</dt>
                <dd className="text-right font-medium text-white/92">{watch.purchaseDate}</dd>
              </div>
            ) : null}
            {watch.seller ? (
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Seller / source</dt>
                <dd className="text-right font-medium text-white/92">{watch.seller}</dd>
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
            {watch.serviceHistory ? (
              <div className="grid gap-1.5 border-b border-white/12 pb-2.5">
                <dt className="font-medium text-white/62">Service history</dt>
                <dd className="whitespace-pre-wrap font-normal leading-relaxed text-white/88">{watch.serviceHistory}</dd>
              </div>
            ) : null}
            {watch.notes ? (
              <div className="grid gap-1.5">
                <dt className="font-medium text-white/62">Notes</dt>
                <dd className="whitespace-pre-wrap font-normal leading-relaxed text-white/88">{watch.notes}</dd>
              </div>
            ) : null}
          </dl>

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
  const resolvedPhotoUrlsRef = useRef(resolvedPhotoUrls);
  resolvedPhotoUrlsRef.current = resolvedPhotoUrls;
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [detailWatch, setDetailWatch] = useState<Watch | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedBackup | null>(null);
  const [photoRemoveRequested, setPhotoRemoveRequested] = useState(false);

  const pendingPhotoBlobRef = useRef<Blob | null>(null);
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

  const goMainView = useCallback((v: MainNavView) => {
    setMainNavView(v);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  }, []);

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
  const [caseSizeStr, setCaseSizeStr] = useState("");
  const [movementStr, setMovementStr] = useState("");
  const [purchaseDateStr, setPurchaseDateStr] = useState("");
  const [sellerStr, setSellerStr] = useState("");
  const [addWatchStep, setAddWatchStep] = useState(1);

  const collectionLabel = useMemo(() => {
    if (watches.length === 0) return "No watches yet";
    if (watches.length === 1) return "1 watch in collection";
    return `${watches.length} watches in collection`;
  }, [watches.length]);

  const totalCollectionValue = useMemo(() => {
    return watches.reduce((sum, w) => sum + (typeof w.estimatedValue === "number" ? w.estimatedValue : 0), 0);
  }, [watches]);

  const estimatedFieldLabel = useMemo(() => {
    const entry = CURRENCIES.find((c) => c.code === collectionCurrency);
    return `Estimated value (${entry?.label ?? collectionCurrency})`;
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
      for (const w of watches) {
        if (!w.photoStorageKey) continue;
        try {
          const blob = await getWatchImageBlob(w.photoStorageKey);
          if (!blob || cancelled) continue;
          const u = URL.createObjectURL(blob);
          created.push(u);
          next[w.id] = u;
        } catch {
          /* missing blob */
        }
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setResolvedPhotoUrls((prev) => {
        for (const u of Object.values(prev)) URL.revokeObjectURL(u);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [watches]);

  useEffect(() => {
    return () => {
      for (const u of Object.values(resolvedPhotoUrlsRef.current)) URL.revokeObjectURL(u);
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 5200);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const onPickPhoto = useCallback(async (file: File | null) => {
    setPhotoRemoveRequested(false);
    if (!file) {
      pendingPhotoBlobRef.current = null;
      setPhotoPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return undefined;
      });
      return;
    }
    try {
      const blob = await compressImageFile(file);
      pendingPhotoBlobRef.current = blob;
      setPhotoPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch {
      setToastMessage("Could not process that image. Try another file or format.");
    }
  }, []);

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
    setPurchaseDateStr("");
    setSellerStr("");
    setAddWatchStep(1);
    setPhotoRemoveRequested(false);
    pendingPhotoBlobRef.current = null;
    setPhotoPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return undefined;
    });
    setEditingWatchId(null);
  }, []);

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
        reference: reference.trim() || undefined,
        year: year.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        caseSize: caseSizeStr.trim() || undefined,
        movement: movementStr.trim() || undefined,
        purchasePrice,
        estimatedValue: normalizedEstimatedValue,
        purchaseDate: purchaseDateStr.trim() || undefined,
        seller: sellerStr.trim() || undefined,
        condition: condition || undefined,
        boxPapers: boxPapers || undefined,
        serviceHistory: serviceHistory.trim() || undefined,
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

      if (editingWatchId) {
        const existing = watches.find((w) => w.id === editingWatchId);
        if (!existing) return;

        let photoUrl: string | undefined = existing.photoUrl;
        let photoStorageKey: string | undefined = existing.photoStorageKey;

        if (photoRemoveRequested) {
          if (existing.photoStorageKey) await deleteWatchImage(existing.photoStorageKey).catch(() => {});
          photoUrl = undefined;
          photoStorageKey = undefined;
        } else if (pendingPhotoBlobRef.current) {
          if (existing.photoStorageKey) await deleteWatchImage(existing.photoStorageKey).catch(() => {});
          const saved = await saveNewPhotoToId(editingWatchId);
          photoUrl = saved.photoUrl;
          photoStorageKey = saved.photoStorageKey;
        } else if (photoPreviewUrl?.startsWith("blob:")) {
          /* loaded IDB preview only — keep stored image */
        } else if (photoPreviewUrl?.startsWith("data:")) {
          photoUrl = photoPreviewUrl;
          photoStorageKey = undefined;
        }

        setWatches((prev) =>
          prev.map((w) =>
            w.id === editingWatchId
              ? {
                  ...w,
                  ...baseFields,
                  photoUrl,
                  photoStorageKey,
                }
              : w,
          ),
        );
      } else {
        const id = crypto.randomUUID();
        let photoUrl: string | undefined;
        let photoStorageKey: string | undefined;

        if (photoRemoveRequested) {
          photoUrl = undefined;
          photoStorageKey = undefined;
        } else {
          const saved = await saveNewPhotoToId(id);
          photoStorageKey = saved.photoStorageKey;
          photoUrl = saved.photoUrl;
        }

        const watch: Watch = {
          id,
          ...baseFields,
          photoUrl,
          photoStorageKey,
          createdAt: Date.now(),
        };

        setWatches((prev) => [watch, ...prev]);
      }

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
      purchaseDateStr,
      sellerStr,
      photoPreviewUrl,
      photoRemoveRequested,
      editingWatchId,
      watches,
      resetForm,
      addWatchStep,
      goMainView,
    ],
  );

  const onDeleteWatch = useCallback(async (id: string) => {
    const w = watches.find((x) => x.id === id);
    if (w?.photoStorageKey) await deleteWatchImage(w.photoStorageKey).catch(() => {});
    setWatches((prev) => prev.filter((x) => x.id !== id));
    setEditingWatchId((cur) => (cur === id ? null : cur));
    setDetailWatch((cur) => (cur?.id === id ? null : cur));
  }, [watches]);

  const onStartEdit = useCallback(
    async (watch: Watch) => {
      setPhotoRemoveRequested(false);
      pendingPhotoBlobRef.current = null;
      setEditingWatchId(watch.id);
      setAddWatchStep(1);
      setBrand(watch.brand ?? "");
      setModel(watch.model ?? "");
      setReference(watch.reference ?? "");
      setYear(watch.year ?? "");
      setSerialNumber(watch.serialNumber ?? "");
      setPurchasePriceStr(typeof watch.purchasePrice === "number" ? String(watch.purchasePrice) : "");
      setEstimatedValue(typeof watch.estimatedValue === "number" ? String(watch.estimatedValue) : "");
      setCondition(watch.condition ?? "");
      setBoxPapers(watch.boxPapers ?? "");
      setServiceHistory(watch.serviceHistory ?? "");
      setNotes(watch.notes ?? "");
      setCaseSizeStr(watch.caseSize ?? "");
      setMovementStr(watch.movement ?? "");
      setPurchaseDateStr(watch.purchaseDate ?? "");
      setSellerStr(watch.seller ?? "");

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

      requestAnimationFrame(() => {
        goMainView("add-watch");
      });
    },
    [goMainView],
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
    async (list: Watch[], photos: { watchId: string; base64: string }[]) => {
      const withPhoto = new Set(photos.map((p) => p.watchId));
      for (const ep of photos) {
        const blob = base64ToBlob(ep.base64);
        await saveWatchImage(ep.watchId, blob);
      }
      return list.map((w) =>
        withPhoto.has(w.id) ? { ...w, photoStorageKey: w.id, photoUrl: undefined } : w,
      );
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
            if (!ow.photoStorageKey) continue;
            const nw = byId.get(ow.id);
            if (!nw?.photoStorageKey) {
              await deleteWatchImage(ow.photoStorageKey).catch(() => {});
            } else if (nw.photoStorageKey !== ow.photoStorageKey) {
              await deleteWatchImage(ow.photoStorageKey).catch(() => {});
            }
          }
          setWatches(withBlobs);
          setCollectionCurrency(parsed.collectionCurrency);
        } else {
          const { watches: incoming, idMap } = remapIncomingForMerge(watches, parsed.watches);
          const photos = parsed.embeddedPhotos.map((ep) => ({
            watchId: idMap.get(ep.watchId) ?? ep.watchId,
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
      triggerTextDownload(`wristfolio-backup-${Date.now()}.json`, json, "application/json");
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
    triggerTextDownload(`wristfolio-export-${Date.now()}.csv`, csv, "text/csv;charset=utf-8");
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
      setToastMessage("Collection PDF generated.");
    } catch (e) {
      setToastMessage(
        e instanceof Error ? e.message : "PDF export failed. Try again, or export a JSON backup instead.",
      );
    }
  }, [watches, collectionCurrency, resolvedPhotoUrls]);

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
        setToastMessage("That file is not a valid Wristfolio backup.");
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
                  Wristfolio
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
              onClick={() => goMainView("add-watch")}
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
                Encrypted collection storage (IndexedDB) is not available in this browser profile. Wristfolio will use local
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
        <>
        <section className="pb-10 pt-14 sm:pt-[4.25rem]">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className={classNames("mb-5 inline-flex items-center gap-2", gold.pill)}>YOUR COLLECTION, REFINED</p>
              <h1 className="mt-1 text-balance text-4xl font-semibold tracking-tight text-white/95 sm:text-5xl">
                A dark, quiet place for the watches you love.
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-[0.9375rem] font-normal leading-relaxed text-white/70">
                Add a watch, upload a photo, and keep your collection at a glance. Wristfolio stores your collection locally
                on this device and browser — private, with no account or cloud database. Export a backup to keep a copy or
                carry your collection to another device.
              </p>

              <div className="mt-10 flex flex-wrap gap-3">
                <button type="button" onClick={() => goMainView("add-watch")} className={gold.btnPrimary}>
                  Start your collection
                </button>
                <button type="button" onClick={() => goMainView("collection")} className={gold.btnSecondary}>
                  View collection
                </button>
              </div>

              <div className="mt-9 grid gap-1.5">
                <p className="text-[13px] font-medium tracking-wide text-white/52">{isMounted ? collectionLabel : "Loading collection..."}</p>
                <p className="text-[13px] font-normal leading-relaxed tracking-wide text-white/60">
                  Your collection stays on this device and browser. Export a backup to open it elsewhere — nothing syncs
                  automatically.
                </p>
                <p className="text-[13px] font-medium tracking-wide text-white/52">Saved watches: {isMounted ? watches.length : "—"}</p>
                <p className="text-[13px] font-medium tracking-wide text-white/52">
                  Total Collection Value:{" "}
                  {isMounted ? formatCollectionCurrency(totalCollectionValue, collectionCurrency) : "—"}
                </p>
              </div>

              <div className={classNames("mt-8 grid gap-3.5 rounded-2xl p-4 sm:max-w-xl", gold.frameLg)}>
                <div className="border-b border-[hsla(42,32%,38%,0.55)] pb-3.5">
                  <p className="text-[12px] font-semibold tracking-widest text-white/58">COLLECTION CURRENCY</p>
                  <p className="mt-1.5 text-[11px] font-normal leading-relaxed text-white/48">
                    Display and entry currency. Values are not converted when you switch.
                  </p>
                  <div className="mt-2">
                    <CurrencyDropdown value={collectionCurrency} onChange={setCollectionCurrency} />
                  </div>
                </div>
                <p className="text-[12px] font-semibold tracking-widest text-white/58">COLLECTION STATISTICS</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className={gold.statCell}>
                    <p className="text-[12px] font-semibold tracking-widest text-white/50">TOTAL</p>
                    <p className="mt-1.5 text-[0.9375rem] font-semibold text-white/92">{isMounted ? watches.length : "—"}</p>
                  </div>
                  <div className={gold.statCell}>
                    <p className="text-[12px] font-semibold tracking-widest text-white/50">COMMON BRAND</p>
                    <p className="mt-1.5 truncate text-[0.9375rem] font-semibold text-white/92">
                      {isMounted ? (mostCommonBrand ?? "—") : "—"}
                    </p>
                  </div>
                  <div className={gold.statCell}>
                    <p className="text-[12px] font-semibold tracking-widest text-white/50">TOTAL VALUE</p>
                    <p className="mt-1.5 text-[0.9375rem] font-semibold text-white/92">
                      {isMounted ? formatCollectionCurrency(totalCollectionValue, collectionCurrency) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <CollectorHeroPanel />
          </div>
        </section>

        <section className="pb-4 pt-2">
          <div className={classNames("rounded-3xl p-5 sm:p-6", gold.frameLg)}>
            <p className="text-[11px] tracking-widest text-white/55">BACKUP &amp; EXPORT</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-white/92">Protect your collection</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/58">
              Your collection is stored locally on this device and browser — private by design, no cloud. To use it on
              another device, export a backup and import it there. Export regularly; JSON backups include watch details and
              embedded photos for a full restore.
            </p>
            <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-white/44">
              Wristfolio stores your collection locally on this device/browser. Mobile browsers may remove local website
              data. Export a backup regularly.
            </p>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-white/44">
              To use your collection on another device, export a backup and import it there. Wristfolio does not currently sync
              between devices.
            </p>
            {watchStorageIssue && watches.length === 0 ? (
              <div
                className="mt-4 max-w-2xl rounded-2xl border border-amber-200/18 bg-amber-200/[0.06] px-4 py-3 text-sm leading-relaxed text-amber-50/88"
                role="status"
              >
                <p className="text-[11px] font-medium uppercase tracking-widest text-amber-100/55">Recovery</p>
                <p className="mt-1.5 text-[13px] text-amber-50/90">{watchStorageIssueUserMessage(watchStorageIssue)}</p>
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-center">
              <div className="rounded-2xl border-2 border-[hsla(42,34%,46%,0.82)] bg-black/35 px-4 py-3">
                <p className="text-[11px] tracking-widest text-white/50">BACKUP REMINDER</p>
                <p className="mt-1 text-sm text-white/70">Last export: {backupLastLabel}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                  Optional local reminder (no notifications). Wristfolio will gently nudge you here when it’s time.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setBackupReminder(0)}
                  className={classNames("min-h-[44px]", backupReminderDays === 0 ? gold.btnSmPrimary : gold.btnSmSecondary)}
                >
                  Off
                </button>
                <button
                  type="button"
                  onClick={() => setBackupReminder(7)}
                  className={classNames("min-h-[44px]", backupReminderDays === 7 ? gold.btnSmPrimary : gold.btnSmSecondary)}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  onClick={() => setBackupReminder(30)}
                  className={classNames("min-h-[44px]", backupReminderDays === 30 ? gold.btnSmPrimary : gold.btnSmSecondary)}
                >
                  Monthly
                </button>
              </div>
            </div>

            {backupIsDue ? (
              <div className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/5 px-4 py-3">
                <p className="text-sm text-amber-100/85">
                  Backup recommended. Your collection is local-only — export a JSON backup to keep a copy.
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void onExportBackup()}
                    className={classNames("min-h-[44px]", gold.btnSmPrimary)}
                  >
                    Export backup now
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
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
                Export collection PDF
              </button>
            </div>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-white/44">
              Wristfolio does not currently sync between devices.
            </p>
            {showSubtleNeverExportedBackupCue ? (
              <div
                className={classNames(
                  "mt-3 max-w-2xl rounded-2xl border border-[hsla(42,36%,44%,0.58)] bg-black/30 px-3 py-2.5 text-[12px] font-normal leading-relaxed text-[hsla(44,38%,80%,0.88)]",
                  gold.frame,
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[hsla(44,32%,58%,0.78)]">Backup</p>
                <p className="mt-1">
                  Backup recommended: export your collection to avoid losing local data. Mobile browsers may clear site
                  storage without warning.
                </p>
              </div>
            ) : null}
            <p className="mt-4 text-[11px] leading-relaxed text-white/42">
              CSV export includes metadata only (no images): brand, model, reference, year, serial, case size, movement,
              values, currency, purchase date, seller, condition, box / papers, notes, and service history. The PDF is a
              printable personal collection report with photos (generated entirely in your browser).
            </p>
          </div>
        </section>
        </>
        ) : null}
        {mainNavView === "add-watch" ? (
        <section
          id="add-watch"
          className={classNames("scroll-mt-24 rounded-3xl p-5 backdrop-blur sm:p-7", gold.frameLg)}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-white/92">
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
              <div className="mx-auto max-w-xl space-y-6">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-white/90">Photos</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                    Add a clear photo of the watch. You can change it anytime when editing.
                  </p>
                </div>
                <div className={classNames("overflow-hidden rounded-2xl bg-black/25", gold.frame)}>
                  <div className="aspect-[4/3] p-4">
                    {photoPreviewUrl ? (
                      <img
                        src={photoPreviewUrl}
                        alt="Photo preview"
                        draggable={false}
                        className="h-full w-full rounded-xl object-cover"
                      />
                    ) : (
                      <Placeholder />
                    )}
                  </div>
                  <div className="border-t-2 border-[hsla(42,34%,40%,0.75)] p-4 sm:p-5">
                    <label className="grid gap-2.5">
                      <span className="text-[13px] font-medium tracking-wide text-white/65">Upload image</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
                        className="block w-full min-h-[48px] text-[13px] font-medium text-white/80 file:mr-3 file:rounded-xl file:border-2 file:border-[hsla(42,36%,48%,0.9)] file:bg-black/45 file:px-3 file:py-2.5 file:text-[13px] file:font-medium file:text-white/90 hover:file:border-[hsla(44,40%,58%,0.96)] hover:file:bg-black/55"
                      />
                    </label>
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
              <h2 className="text-xl font-semibold tracking-tight text-white/92">Collection</h2>
              <p className="mt-1 text-sm text-white/60">Your watches, at a glance.</p>
            </div>
            <div className="flex flex-wrap items-end justify-end gap-2 sm:items-center">
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
                onClick={() => goMainView("add-watch")}
                className={classNames("min-h-[44px] rounded-2xl px-4 py-2", gold.btnSmSecondary)}
              >
                Add another
              </button>
            </div>
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
                    onClick={() => goMainView("add-watch")}
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
            <div className={classNames("mt-6 rounded-3xl p-8 sm:p-10", gold.frameLg)}>
              <div className="mx-auto max-w-md text-center">
                {noWatchDataFound ? (
                  <p className="text-sm leading-relaxed text-white/62">
                    No collection data was found in this browser. If you have a backup file, import it to restore your
                    collection.
                  </p>
                ) : null}
                <p
                  className={classNames(
                    "mx-auto inline-flex rounded-full px-3 py-1 text-[11px] tracking-widest",
                    gold.pill,
                    noWatchDataFound ? "mt-6" : "",
                  )}
                >
                  EMPTY COLLECTION
                </p>
                <p className="mt-5 text-lg font-semibold tracking-tight text-white/92">Your collection is ready</p>
                <p className="mt-3 text-sm leading-relaxed text-white/58">
                  Start your private watch collection by adding your first watch. Everything stays on this device until you export
                  a backup.
                </p>
                <p className="mt-3 text-[11px] leading-relaxed text-white/42">
                  Wristfolio stores your collection locally on this device/browser. Mobile browsers may remove local website
                  data. Export a backup regularly.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => goMainView("add-watch")}
                    className={classNames("min-h-[48px] w-full sm:w-auto sm:min-w-[200px]", gold.btnPrimary)}
                  >
                    Add first watch
                  </button>
                  <button
                    type="button"
                    onClick={onLoadDemo}
                    className={classNames("min-h-[48px] w-full sm:w-auto sm:min-w-[200px]", gold.btnSecondary)}
                  >
                    Load demo collection
                  </button>
                </div>
                <p className="mt-6 text-xs leading-relaxed text-white/45">
                  Demo entries are labelled &ldquo;Demo&rdquo; and can be removed with one tap after you load them.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
              {watches.map((w) => (
                <WatchCard
                  key={w.id}
                  watch={w}
                  displaySrc={resolvedPhotoUrls[w.id]}
                  onDelete={onDeleteWatch}
                  onEdit={onStartEdit}
                  onOpenDetail={setDetailWatch}
                  currency={collectionCurrency}
                />
              ))}
            </div>
          )}
        </section>
        ) : null}

        <footer className="mx-auto max-w-6xl border-t-2 border-[hsla(42,34%,34%,0.58)] px-4 pb-16 pt-10">
          <p className="max-w-2xl text-sm leading-relaxed text-white/58">
            Wristfolio stores your collection locally on this device and browser — private, with no account or cloud
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
          currency={collectionCurrency}
          onClose={() => setDetailWatch(null)}
          onEdit={(w) => {
            void onStartEdit(w);
          }}
        />
      ) : null}
    </div>
  );
}

