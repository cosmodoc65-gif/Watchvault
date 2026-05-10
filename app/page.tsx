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

function Placeholder() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0">
      <div className="text-center">
        <div className="mx-auto mb-2 h-10 w-10 rounded-full border border-white/10 bg-white/5" />
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
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.04] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_18px_45px_-30px_rgba(0,0,0,0.75)]">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/20">
        {watch.photoUrl ? (
          // Normal img avoids Next image config pitfalls for blob: URLs
          <img
            src={watch.photoUrl}
            alt={`${watch.brand} ${watch.model}`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <Placeholder />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/0 to-black/0" />
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-2 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(watch)}
          className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] tracking-wide text-white/80 backdrop-blur transition hover:bg-black/55 hover:text-white"
          aria-label={`Edit ${watch.brand} ${watch.model}`}
          title="Edit"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(watch.id)}
          className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] tracking-wide text-white/80 backdrop-blur transition hover:bg-black/55 hover:text-white"
          aria-label={`Delete ${watch.brand} ${watch.model}`}
          title="Delete"
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
          <span className="shrink-0 rounded-full border border-amber-200/15 bg-amber-200/10 px-2 py-1 text-[10px] tracking-widest text-amber-200/80">
            VAULTED
          </span>
        </div>

        {(watch.reference || watch.year || typeof watch.estimatedValue === "number") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {watch.reference ? (
              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                Ref. {watch.reference}
              </span>
            ) : null}
            {watch.year ? (
              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                Year {watch.year}
              </span>
            ) : null}
            {typeof watch.estimatedValue === "number" ? (
              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                Estimated Value: {formatGBP(watch.estimatedValue)}
              </span>
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
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl border border-white/10 bg-gradient-to-br from-amber-200/20 to-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]" />
            <div>
              <p className="text-sm font-semibold tracking-wide">WatchVault</p>
              <p className="text-[11px] text-white/55">Private. Local. Yours.</p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
              className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs tracking-wide text-white/80 hover:bg-white/10 sm:inline-flex"
            >
              View collection
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("add-watch")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-xs font-semibold tracking-wide text-amber-200/90 hover:bg-amber-200/15"
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
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] tracking-widest text-white/70">
                YOUR COLLECTION, REFINED
              </p>
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
                  className="rounded-2xl border border-amber-200/20 bg-gradient-to-b from-amber-200/15 to-amber-200/10 px-5 py-3 text-sm font-semibold tracking-wide text-amber-200/90 shadow-[0_0_0_1px_rgba(255,215,128,0.16)_inset] hover:from-amber-200/20 hover:to-amber-200/12"
                >
                  Start your vault
                </button>
                <button
                  type="button"
                  onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm tracking-wide text-white/80 hover:bg-white/10"
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

              <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] sm:max-w-xl">
                <p className="text-[11px] tracking-widest text-white/55">COLLECTION STATISTICS</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[11px] tracking-widest text-white/45">TOTAL</p>
                    <p className="mt-1 text-sm font-semibold text-white/90">{isMounted ? watches.length : "—"}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[11px] tracking-widest text-white/45">COMMON BRAND</p>
                    <p className="mt-1 truncate text-sm font-semibold text-white/90">
                      {isMounted ? (mostCommonBrand ?? "—") : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[11px] tracking-widest text-white/45">TOTAL VALUE</p>
                    <p className="mt-1 text-sm font-semibold text-white/90">
                      {isMounted ? formatGBP(totalCollectionValue) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]">
              <div className="absolute inset-0 bg-[radial-gradient(650px_350px_at_30%_20%,rgba(255,215,128,0.10),transparent_60%)]" />
              <div className="relative">
                <p className="text-xs tracking-widest text-white/55">PREVIEW</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    {photoPreviewUrl ? (
                      <img src={photoPreviewUrl} alt="Selected watch preview" className="h-full w-full object-cover" />
                    ) : (
                      <Placeholder />
                    )}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-[11px] tracking-widest text-white/55">DETAILS</p>
                    <p className="mt-3 truncate text-sm font-semibold text-white/90">{brand || "Brand"}</p>
                    <p className="truncate text-xs text-white/65">{model || "Model"}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/65">
                        Ref. {reference || "—"}
                      </span>
                      <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/65">
                        Year {year || "—"}
                      </span>
                      <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/65">
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
          className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur sm:p-7"
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
                  className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/35 focus:border-amber-200/25"
                  placeholder="Rolex"
                  required
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Model *</span>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/35 focus:border-amber-200/25"
                  placeholder="Submariner"
                  required
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Reference</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/35 focus:border-amber-200/25"
                  placeholder="126610LN"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Year</span>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/35 focus:border-amber-200/25"
                  placeholder="2024"
                  inputMode="numeric"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Estimated value (£)</span>
                <input
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/35 focus:border-amber-200/25"
                  placeholder="8500"
                  inputMode="numeric"
                />
              </label>

              <label className="sm:col-span-2 grid gap-2">
                <span className="text-xs tracking-wide text-white/55">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[92px] resize-y rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/90 outline-none placeholder:text-white/35 focus:border-amber-200/25"
                  placeholder="Dial, bracelet, story…"
                />
              </label>
            </div>

            <div className="grid gap-4">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <div className="aspect-[4/3] p-3">
                  {photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Photo preview" className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    <Placeholder />
                  )}
                </div>
                <div className="border-t border-white/10 p-3">
                  <label className="grid gap-2">
                    <span className="text-xs tracking-wide text-white/55">Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-white/70 file:mr-3 file:rounded-xl file:border file:border-white/10 file:bg-white/5 file:px-3 file:py-2 file:text-xs file:text-white/80 hover:file:bg-white/10"
                    />
                  </label>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                    Uploads stay local. The image is saved in this browser.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="submit"
                  className={classNames(
                    "rounded-2xl border border-amber-200/20 bg-amber-200/10 px-5 py-3 text-sm font-semibold tracking-wide text-amber-200/90",
                    "hover:bg-amber-200/15",
                  )}
                >
                  {editingWatchId ? "Save Changes" : "Add to collection"}
                </button>
                {editingWatchId ? (
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold tracking-wide text-white/80 hover:bg-white/10"
                  >
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
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs tracking-wide text-white/80 hover:bg-white/10"
            >
              Add another
            </button>
          </div>

          {!isMounted ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">
              Loading collection...
            </div>
          ) : watches.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">
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

