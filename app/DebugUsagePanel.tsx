"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  EMPTY_LOCAL_USAGE_COUNTERS,
  LOCAL_USAGE_COUNTER_KEYS,
  LOCAL_USAGE_COUNTERS_UPDATED_EVENT,
  type LocalUsageCounters,
  readLocalUsageCounters,
  writeLocalUsageCounters,
} from "@/lib/localUsageAnalytics";

function classNames(...values: Array<string | false | undefined | null>) {
  return values.filter(Boolean).join(" ");
}

const btnSmSecondary =
  "rounded-xl border-2 border-[hsla(42,38%,54%,0.9)] bg-black/52 px-3 py-2 text-xs font-medium tracking-wide text-white/92 transition hover:border-[hsla(44,44%,62%,0.96)] hover:bg-black/60";

function isDebugMode(searchParams: ReturnType<typeof useSearchParams>): boolean {
  return searchParams.get("debug") === "true";
}

export default function DebugUsagePanel() {
  const searchParams = useSearchParams();
  const debugEnabled = isDebugMode(searchParams);
  const [counters, setCounters] = useState<LocalUsageCounters>(EMPTY_LOCAL_USAGE_COUNTERS);

  useEffect(() => {
    if (!debugEnabled) return;
    setCounters(readLocalUsageCounters());

    const onCountersUpdated = () => {
      setCounters(readLocalUsageCounters());
    };

    window.addEventListener(LOCAL_USAGE_COUNTERS_UPDATED_EVENT, onCountersUpdated);
    window.addEventListener("storage", onCountersUpdated);
    return () => {
      window.removeEventListener(LOCAL_USAGE_COUNTERS_UPDATED_EVENT, onCountersUpdated);
      window.removeEventListener("storage", onCountersUpdated);
    };
  }, [debugEnabled]);

  if (!debugEnabled) return null;

  const resetCounters = () => {
    const reset = { ...EMPTY_LOCAL_USAGE_COUNTERS };
    writeLocalUsageCounters(reset);
    setCounters(reset);
  };

  return (
    <aside
      className="fixed bottom-6 right-4 z-[140] w-[min(92vw,20rem)] rounded-2xl border-2 border-[hsla(44,42%,56%,0.92)] bg-[#0c0c0f]/95 p-4 text-white/88 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.85)] backdrop-blur-md"
      aria-label="Local usage debug panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,44%,82%,0.86)]">
            DEBUG MODE ACTIVE
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/50">Stored locally in this browser only.</p>
        </div>
        <button type="button" onClick={resetCounters} className={classNames("shrink-0", btnSmSecondary)}>
          Reset
        </button>
      </div>
      <dl className="mt-4 grid gap-2 text-sm">
        {LOCAL_USAGE_COUNTER_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-3 py-2">
            <dt className="font-medium text-white/68">{key}</dt>
            <dd className="font-semibold tabular-nums text-white/94">{counters[key]}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
