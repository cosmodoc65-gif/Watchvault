"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Watch = {
  id: string;
  brand: string;
  model: string;
  reference?: string;
  year?: string;
  notes?: string;
  photoUrl?: string;
  estimatedValue?: number;
  createdAt: number;
};

function classNames(...values: Array<string | false | undefined | null>) {
  return values.filter(Boolean).join(" ");
}

/**
 * Champagne / antique brushed gold — strong legibility on black, still boutique-restrained.
 * ~2px frames, warm metallic tone, soft separation shadows (no neon, no orange pop).
 */
const gold = {
  frame:
    "border-2 border-[hsla(35,30%,46%,0.92)] bg-white/[0.03] shadow-[inset_0_1px_0_0_hsla(38,22%,58%,0.2),0_0_0_1px_rgba(0,0,0,0.55),0_12px_44px_-14px_hsla(36,32%,14%,0.45)]",
  frameLg:
    "border-2 border-[hsla(34,28%,44%,0.9)] bg-white/[0.03] shadow-[inset_0_1px_0_0_hsla(37,20%,56%,0.18),0_0_0_1px_rgba(0,0,0,0.58),0_14px_52px_-16px_hsla(36,30%,12%,0.48)]",
  cardHover:
    "transition duration-300 ease-out hover:border-[hsla(33,32%,54%,0.98)] hover:bg-white/[0.045] hover:shadow-[inset_0_1px_0_0_hsla(36,24%,64%,0.24),0_0_0_1px_hsla(34,28%,32%,0.45),0_22px_58px_-18px_hsla(36,34%,10%,0.5)] hover:-translate-y-0.5",
  focus:
    "focus:border-[hsla(33,30%,52%,0.95)] focus:ring-2 focus:ring-[hsla(34,32%,42%,0.45)] focus:ring-offset-2 focus:ring-offset-[#070708]",
  input:
    "rounded-2xl border-2 border-[hsla(34,26%,44%,0.88)] bg-black/45 px-4 py-3 text-sm text-white/92 outline-none placeholder:text-white/40",
  tag: "rounded-lg border-2 border-[hsla(34,24%,46%,0.82)] bg-black/38 px-2 py-1 text-[11px] text-white/85 shadow-[inset_0_1px_0_0_hsla(36,18%,54%,0.12)]",
  statCell:
    "rounded-xl border-2 border-[hsla(34,24%,44%,0.85)] bg-black/42 px-3 py-2 shadow-[inset_0_1px_0_0_hsla(36,18%,52%,0.12),0_6px_22px_-14px_hsla(36,30%,10%,0.42)]",
  btnPrimary:
    "rounded-2xl border-2 border-[hsla(32,34%,54%,0.96)] bg-gradient-to-b from-[hsla(33,24%,22%,0.97)] via-[hsla(32,20%,14%,0.95)] to-[hsla(30,18%,9%,0.94)] px-5 py-3 text-sm font-semibold tracking-wide text-[hsla(38,38%,95%,0.99)] shadow-[inset_0_1px_0_0_hsla(36,26%,62%,0.32)] transition hover:border-[hsla(31,36%,58%,0.99)] hover:shadow-[inset_0_1px_0_0_hsla(35,28%,68%,0.22),0_0_36px_-12px_hsla(36,36%,22%,0.45)]",
  btnSecondary:
    "rounded-2xl border-2 border-[hsla(34,26%,46%,0.88)] bg-black/48 px-5 py-3 text-sm font-semibold tracking-wide text-white/92 shadow-[inset_0_1px_0_0_hsla(36,18%,52%,0.14)] transition hover:border-[hsla(32,30%,54%,0.95)] hover:bg-black/56 hover:text-white",
  btnSmPrimary:
    "rounded-xl border-2 border-[hsla(32,32%,52%,0.94)] bg-gradient-to-b from-[hsla(32,22%,18%,0.96)] to-[hsla(30,16%,10%,0.94)] px-3 py-2 text-xs font-semibold tracking-wide text-[hsla(38,36%,94%,0.99)] shadow-[inset_0_1px_0_0_hsla(35,24%,58%,0.28)] transition hover:border-[hsla(31,36%,56%,0.98)] hover:shadow-[0_0_28px_-10px_hsla(36,34%,18%,0.42)]",
  btnSmSecondary:
    "rounded-xl border-2 border-[hsla(34,24%,44%,0.86)] bg-black/52 px-3 py-2 text-xs tracking-wide text-white/90 transition hover:border-[hsla(32,30%,52%,0.95)] hover:bg-black/60",
  pill:
    "rounded-full border-2 border-[hsla(34,26%,46%,0.88)] bg-black/40 px-3 py-1 text-[11px] tracking-widest text-white/82 shadow-[inset_0_1px_0_0_hsla(36,18%,54%,0.14)]",
};

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
            "border-2 border-[hsla(34,26%,44%,0.82)] shadow-[inset_0_1px_0_0_hsla(36,18%,52%,0.12)]",
          )}
        />
        <p className="text-xs tracking-wide text-white/55">No photo</p>
      </div>
    </div>
  );
}

function formatGBP(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

function WatchCard({
  watch,
  onDelete,
  onEdit,
}: {
  watch: Watch;
  onDelete: (id: string) => void;
  onEdit: (watch: Watch) => void;
}) {
  return (
    <div
      className={classNames(
        "group relative overflow-hidden rounded-2xl backdrop-blur",
        gold.frame,
        gold.cardHover,
      )}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/25">
        {watch.photoUrl ? (
          <img
            src={watch.photoUrl}
            alt={`${watch.brand} ${watch.model}`}
            draggable={false}
            className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.02]"
          />
        ) : (
          <Placeholder />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/0 to-black/0" />
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-2 opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-300 sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(watch)}
          className={classNames(
            "px-2.5 py-2 text-[11px] font-medium tracking-wide text-white/90 backdrop-blur",
            gold.btnSmSecondary,
          )}
          aria-label={`Edit ${watch.brand} ${watch.model}`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(watch.id)}
          className={classNames(
            "px-2.5 py-2 text-[11px] font-medium tracking-wide text-white/90 backdrop-blur",
            gold.btnSmSecondary,
          )}
          aria-label={`Delete ${watch.brand} ${watch.model}`}
        >
          Delete
        </button>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-white/92">{watch.brand}</p>
            <p className="truncate text-xs text-white/65">{watch.model}</p>
          </div>
          <span className="shrink-0 rounded-full border-2 border-[hsla(32,32%,50%,0.92)] bg-[hsla(30,16%,8%,0.78)] px-2 py-1 text-[10px] tracking-widest text-[hsla(38,36%,92%,0.97)] shadow-[inset_0_1px_0_0_hsla(36,22%,56%,0.2)]">
            VAULTED
          </span>
        </div>

        {(watch.reference || watch.year || typeof watch.estimatedValue === "number") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {watch.reference ? <span className={gold.tag}>Ref. {watch.reference}</span> : null}
            {watch.year ? <span className={gold.tag}>Year {watch.year}</span> : null}
            {typeof watch.estimatedValue === "number" ? (
              <span className={gold.tag}>Estimated Value: {formatGBP(watch.estimatedValue)}</span>
            ) : null}
          </div>
        )}

        {watch.notes ? (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-white/55">{watch.notes}</p>
        ) : null}
      </div>
    </div>
  );
}

export default function Page() {
  const [watches, setWatches] = useState<Watch[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = window.localStorage.getItem("watchvault-watches");
    try {
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isMounted, setIsMounted] = useState(false);
  const [editingWatchId, setEditingWatchId] = useState<string | null>(null);

  // Form state
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [reference, setReference] = useState("");
  const [year, setYear] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | undefined>(undefined);

  const collectionLabel = useMemo(() => {
    if (watches.length === 0) return "No watches yet";
    if (watches.length === 1) return "1 watch in collection";
    return `${watches.length} watches in collection`;
  }, [watches.length]);

  const totalCollectionValue = useMemo(() => {
    return watches.reduce((sum, w) => sum + (typeof w.estimatedValue === "number" ? w.estimatedValue : 0), 0);
  }, [watches]);

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
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("watchvault-watches", JSON.stringify(watches));
  }, [watches]);

  const onPickPhoto = useCallback(
    (file: File | null) => {
      if (!file) {
        setPhotoPreviewUrl(undefined);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") setPhotoPreviewUrl(result);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const onAddWatch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedBrand = brand.trim();
      const trimmedModel = model.trim();
      if (!trimmedBrand || !trimmedModel) return;

      const parsedValue = Number(estimatedValue.replace(/[^\d]/g, ""));
      const normalizedEstimatedValue = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined;

      if (editingWatchId) {
        setWatches((prev) =>
          prev.map((w) =>
            w.id === editingWatchId
              ? {
                  ...w,
                  brand: trimmedBrand,
                  model: trimmedModel,
                  reference: reference.trim() || undefined,
                  year: year.trim() || undefined,
                  estimatedValue: normalizedEstimatedValue,
                  notes: notes.trim() || undefined,
                  photoUrl: photoPreviewUrl,
                  // preserve createdAt
                }
              : w,
          ),
        );
      } else {
        const watch: Watch = {
          id: crypto.randomUUID(),
          brand: trimmedBrand,
          model: trimmedModel,
          reference: reference.trim() || undefined,
          year: year.trim() || undefined,
          estimatedValue: normalizedEstimatedValue,
          notes: notes.trim() || undefined,
          photoUrl: photoPreviewUrl,
          createdAt: Date.now(),
        };

        setWatches((prev) => [watch, ...prev]);
      }

      // Reset form (keep UX snappy)
      setBrand("");
      setModel("");
      setReference("");
      setYear("");
      setEstimatedValue("");
      setNotes("");
      // Don't revoke here: this URL is now owned by the saved watch object.
      setPhotoPreviewUrl(undefined);
      setEditingWatchId(null);

      // After adding, take user to their collection
      requestAnimationFrame(() => {
        document.getElementById(editingWatchId ? "add-watch" : "collection")?.scrollIntoView({ behavior: "smooth" });
      });
    },
    [brand, model, reference, year, estimatedValue, notes, photoPreviewUrl, editingWatchId],
  );

  const onDeleteWatch = useCallback((id: string) => {
    setWatches((prev) => prev.filter((w) => w.id !== id));
    setEditingWatchId((cur) => (cur === id ? null : cur));
  }, []);

  const onStartEdit = useCallback((watch: Watch) => {
    setEditingWatchId(watch.id);
    setBrand(watch.brand ?? "");
    setModel(watch.model ?? "");
    setReference(watch.reference ?? "");
    setYear(watch.year ?? "");
    setEstimatedValue(typeof watch.estimatedValue === "number" ? String(watch.estimatedValue) : "");
    setNotes(watch.notes ?? "");
    setPhotoPreviewUrl(watch.photoUrl);
    requestAnimationFrame(() => {
      document.getElementById("add-watch")?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  const onCancelEdit = useCallback(() => {
    setEditingWatchId(null);
    setBrand("");
    setModel("");
    setReference("");
    setYear("");
    setEstimatedValue("");
    setNotes("");
    setPhotoPreviewUrl(undefined);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-2 border-[hsla(34,28%,42%,0.82)] bg-black/45 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div
              className={classNames(
                "h-9 w-9 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02]",
                gold.frame,
              )}
            />
            <div>
              <p className="text-sm font-semibold tracking-wide">WatchVault</p>
              <p className="text-[11px] text-white/55">Private. Local. Yours.</p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
              className={classNames("hidden sm:inline-flex", gold.btnSmSecondary)}
            >
              View collection
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("add-watch")?.scrollIntoView({ behavior: "smooth" })}
              className={gold.btnSmPrimary}
            >
              Add Watch
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="pb-10 pt-12 sm:pt-16">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className={classNames("mb-3 inline-flex items-center gap-2", gold.pill)}>YOUR COLLECTION, REFINED</p>
              <h1 className="text-balance text-4xl font-semibold tracking-tight text-white/95 sm:text-5xl">
                A dark, quiet place for the watches you love.
              </h1>
              <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-white/65">
                Add a watch, upload a photo, and keep your collection at a glance. Everything stays local — no accounts, no
                database.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => document.getElementById("add-watch")?.scrollIntoView({ behavior: "smooth" })}
                  className={gold.btnPrimary}
                >
                  Start your vault
                </button>
                <button
                  type="button"
                  onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
                  className={gold.btnSecondary}
                >
                  View collection
                </button>
              </div>

              <div className="mt-6 grid gap-1">
                <p className="text-xs tracking-wide text-white/45">{isMounted ? collectionLabel : "Loading collection..."}</p>
                <p className="text-xs tracking-wide text-white/55">Saved locally in this browser.</p>
                <p className="text-xs tracking-wide text-white/45">Saved watches: {isMounted ? watches.length : "—"}</p>
                <p className="text-xs tracking-wide text-white/45">
                  Total Collection Value: {isMounted ? formatGBP(totalCollectionValue) : "—"}
                </p>
              </div>

              <div className={classNames("mt-6 grid gap-3 rounded-2xl p-4 sm:max-w-xl", gold.frameLg)}>
                <p className="text-[11px] tracking-widest text-white/55">COLLECTION STATISTICS</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className={gold.statCell}>
                    <p className="text-[11px] tracking-widest text-white/45">TOTAL</p>
                    <p className="mt-1 text-sm font-semibold text-white/90">{isMounted ? watches.length : "—"}</p>
                  </div>
                  <div className={gold.statCell}>
                    <p className="text-[11px] tracking-widest text-white/45">COMMON BRAND</p>
                    <p className="mt-1 truncate text-sm font-semibold text-white/90">
                      {isMounted ? (mostCommonBrand ?? "—") : "—"}
                    </p>
                  </div>
                  <div className={gold.statCell}>
                    <p className="text-[11px] tracking-widest text-white/45">TOTAL VALUE</p>
                    <p className="mt-1 text-sm font-semibold text-white/90">
                      {isMounted ? formatGBP(totalCollectionValue) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className={classNames("relative overflow-hidden rounded-3xl p-5", gold.frameLg)}>
              <div className="absolute inset-0 bg-[radial-gradient(650px_350px_at_30%_20%,hsla(35,28%,48%,0.22),transparent_60%)]" />
              <div className="relative">
                <p className="text-xs tracking-widest text-white/55">PREVIEW</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className={classNames("aspect-[4/3] overflow-hidden rounded-2xl bg-black/25", gold.frame)}>
                    {photoPreviewUrl ? (
                      <img
                        src={photoPreviewUrl}
                        alt="Selected watch preview"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Placeholder />
                    )}
                  </div>
                  <div className={classNames("rounded-2xl bg-white/[0.04] p-4", gold.frame)}>
                    <p className="text-[11px] tracking-widest text-white/55">DETAILS</p>
                    <p className="mt-3 truncate text-sm font-semibold text-white/90">{brand || "Brand"}</p>
                    <p className="truncate text-xs text-white/65">{model || "Model"}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={gold.tag}>Ref. {reference || "—"}</span>
                      <span className={gold.tag}>Year {year || "—"}</span>
                      <span className={gold.tag}>
                        Value {estimatedValue ? `£${estimatedValue.replace(/[^\d]/g, "")}` : "—"}
                      </span>
                    </div>
                    <p className="mt-4 line-clamp-2 text-xs leading-relaxed text-white/55">{notes || "Notes…"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="add-watch"
          className={classNames("scroll-mt-24 rounded-3xl p-5 backdrop-blur sm:p-7", gold.frameLg)}
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-white/92">Add a watch</h2>
              <p className="mt-1 text-sm text-white/60">Upload a photo and keep it in your local vault.</p>
            </div>
            <div className="hidden text-right text-xs tracking-wide text-white/45 sm:block">
              <p>Local-only</p>
              <p>No sign-in</p>
            </div>
          </div>

          <form onSubmit={onAddWatch} className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Brand *</span>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className={classNames(gold.input, gold.focus)}
                  placeholder="Rolex"
                  required
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Model *</span>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={classNames(gold.input, gold.focus)}
                  placeholder="Submariner"
                  required
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Reference</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className={classNames(gold.input, gold.focus)}
                  placeholder="126610LN"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Year</span>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className={classNames(gold.input, gold.focus)}
                  placeholder="2024"
                  inputMode="numeric"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Estimated value (£)</span>
                <input
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  className={classNames(gold.input, gold.focus)}
                  placeholder="8500"
                  inputMode="numeric"
                />
              </label>

              <label className="sm:col-span-2 grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={classNames("min-h-[92px] resize-y", gold.input, gold.focus)}
                  placeholder="Dial, bracelet, story…"
                />
              </label>
            </div>

            <div className="grid gap-4">
              <div className={classNames("overflow-hidden rounded-2xl bg-black/25", gold.frame)}>
                <div className="aspect-[4/3] p-3">
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
                <div className="border-t-2 border-[hsla(34,26%,42%,0.72)] p-3">
                  <label className="grid gap-2">
                    <span className="text-xs tracking-wide text-white/55">Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-white/78 file:mr-3 file:rounded-xl file:border-2 file:border-[hsla(34,26%,44%,0.88)] file:bg-black/45 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white/90 hover:file:border-[hsla(32,32%,52%,0.95)] hover:file:bg-black/55"
                    />
                  </label>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                    Uploads stay local. The image is saved in this browser.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button type="submit" className={gold.btnPrimary}>
                  {editingWatchId ? "Save Changes" : "Add to collection"}
                </button>
                {editingWatchId ? (
                  <button type="button" onClick={onCancelEdit} className={gold.btnSecondary}>
                    Cancel Edit
                  </button>
                ) : (
                  <div className="hidden sm:block" />
                )}
              </div>
            </div>
          </form>
        </section>

        <section id="collection" className="scroll-mt-24 pb-16 pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-white/92">Collection</h2>
              <p className="mt-1 text-sm text-white/60">Your watches, at a glance.</p>
            </div>
            <button
              type="button"
              onClick={() => document.getElementById("add-watch")?.scrollIntoView({ behavior: "smooth" })}
              className={classNames("rounded-2xl px-4 py-2", gold.btnSmSecondary)}
            >
              Add another
            </button>
          </div>

          {!isMounted ? (
            <div className={classNames("mt-6 rounded-3xl p-8 text-center text-sm text-white/62", gold.frameLg)}>
              Loading collection...
            </div>
          ) : watches.length === 0 ? (
            <div className={classNames("mt-6 rounded-3xl p-8 text-center text-sm text-white/62", gold.frameLg)}>
              Your vault is empty. Add your first watch to begin.
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {watches.map((w) => (
                <WatchCard key={w.id} watch={w} onDelete={onDeleteWatch} onEdit={onStartEdit} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

