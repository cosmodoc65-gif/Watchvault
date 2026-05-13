import { blobToBase64 } from "./backupEncoding";
import { BOXPAPERS_LABELS, CONDITION_LABELS, type CollectionCurrency, type Watch } from "./watchNormalize";
import { getWatchImageBlob } from "./wristfolioIdb";

export async function buildBackupJsonString(
  watches: Watch[],
  collectionCurrency: CollectionCurrency,
): Promise<string> {
  const exportedAt = new Date().toISOString();
  const watchesOut: Record<string, unknown>[] = [];

  for (const w of watches) {
    const row: Record<string, unknown> = {
      id: w.id,
      brand: w.brand,
      model: w.model,
      reference: w.reference,
      year: w.year,
      serialNumber: w.serialNumber,
      caseSize: w.caseSize,
      movement: w.movement,
      purchasePrice: w.purchasePrice,
      estimatedValue: w.estimatedValue,
      purchaseDate: w.purchaseDate,
      seller: w.seller,
      condition: w.condition,
      boxPapers: w.boxPapers,
      serviceHistory: w.serviceHistory,
      notes: w.notes,
      isDemo: w.isDemo,
      createdAt: w.createdAt,
    };

    let photoExportBase64: string | undefined;
    if (w.photoStorageKey) {
      const blob = await getWatchImageBlob(w.photoStorageKey);
      if (blob) photoExportBase64 = await blobToBase64(blob);
    } else if (w.photoUrl?.startsWith("data:")) {
      const comma = w.photoUrl.indexOf(",");
      photoExportBase64 = comma >= 0 ? w.photoUrl.slice(comma + 1) : undefined;
    }
    if (photoExportBase64) row.photoExportBase64 = photoExportBase64;

    watchesOut.push(row);
  }

  return JSON.stringify(
    {
      // Legacy schema flag (original app codename); keep so existing backups and imports keep working.
      watchvaultBackup: true,
      version: 1,
      exportedAt,
      collectionCurrency,
      watches: watchesOut,
    },
    null,
    2,
  );
}

function escapeCsvCell(v: string | number | undefined): string {
  if (v === undefined || v === "") return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCollectionCsv(watches: Watch[], collectionCurrency: CollectionCurrency): string {
  const headers = [
    "brand",
    "model",
    "reference",
    "year",
    "serial_number",
    "case_size",
    "movement",
    "estimated_value",
    "currency",
    "purchase_price",
    "purchase_date",
    "seller",
    "condition",
    "box_papers",
    "notes",
    "service_history",
  ];
  const lines = [headers.join(",")];
  for (const w of watches) {
    lines.push(
      [
        escapeCsvCell(w.brand),
        escapeCsvCell(w.model),
        escapeCsvCell(w.reference),
        escapeCsvCell(w.year),
        escapeCsvCell(w.serialNumber),
        escapeCsvCell(w.caseSize),
        escapeCsvCell(w.movement),
        escapeCsvCell(typeof w.estimatedValue === "number" ? w.estimatedValue : undefined),
        escapeCsvCell(collectionCurrency),
        escapeCsvCell(typeof w.purchasePrice === "number" ? w.purchasePrice : undefined),
        escapeCsvCell(w.purchaseDate),
        escapeCsvCell(w.seller),
        escapeCsvCell(w.condition ? CONDITION_LABELS[w.condition] : undefined),
        escapeCsvCell(w.boxPapers ? BOXPAPERS_LABELS[w.boxPapers] : undefined),
        escapeCsvCell(w.notes),
        escapeCsvCell(w.serviceHistory),
      ].join(","),
    );
  }
  return lines.join("\n");
}
