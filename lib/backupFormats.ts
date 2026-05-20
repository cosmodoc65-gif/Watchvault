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
      referenceNumber: w.referenceNumber ?? w.reference,
      reference: w.reference,
      year: w.year,
      serialNumber: w.serialNumber,
      caseSize: w.caseSize,
      lugToLug: w.lugToLug,
      waterResistance: w.waterResistance,
      movement: w.movement,
      purchasePrice: w.purchasePrice,
      currentValue: w.currentValue ?? w.estimatedValue,
      estimatedValue: w.estimatedValue,
      purchaseDate: w.purchaseDate,
      purchaseSource: w.purchaseSource ?? w.seller,
      seller: w.seller,
      complicationStyle: w.complicationStyle,
      condition: w.condition,
      boxPapers: w.boxPapers,
      serviceHistoryNotes: w.serviceHistoryNotes ?? w.serviceHistory,
      serviceHistory: w.serviceHistory,
      provenanceNotes: w.provenanceNotes,
      timeline: w.timeline,
      wearCount: w.wearCount,
      lastWornDate: w.lastWornDate,
      photos: w.photos,
      primaryPhotoId: w.primaryPhotoId,
      notes: w.notes,
      isDemo: w.isDemo,
      createdAt: w.createdAt,
    };

    let photoExportBase64: string | undefined;
    const primaryPhoto = w.photos?.find((p) => p.id === w.primaryPhotoId) ?? w.photos?.find((p) => p.isPrimary) ?? w.photos?.[0];
    if (primaryPhoto?.storageKey) {
      const blob = await getWatchImageBlob(primaryPhoto.storageKey);
      if (blob) photoExportBase64 = await blobToBase64(blob);
    } else if (primaryPhoto?.url?.startsWith("data:")) {
      const comma = primaryPhoto.url.indexOf(",");
      photoExportBase64 = comma >= 0 ? primaryPhoto.url.slice(comma + 1) : undefined;
    } else if (w.photoStorageKey) {
      const blob = await getWatchImageBlob(w.photoStorageKey);
      if (blob) photoExportBase64 = await blobToBase64(blob);
    } else if (w.photoUrl?.startsWith("data:")) {
      const comma = w.photoUrl.indexOf(",");
      photoExportBase64 = comma >= 0 ? w.photoUrl.slice(comma + 1) : undefined;
    }
    if (photoExportBase64) row.photoExportBase64 = photoExportBase64;

    const photoExportsBase64: { photoId: string; base64: string }[] = [];
    for (const photo of w.photos ?? []) {
      let base64: string | undefined;
      if (photo.storageKey) {
        const blob = await getWatchImageBlob(photo.storageKey);
        if (blob) base64 = await blobToBase64(blob);
      } else if (photo.url?.startsWith("data:")) {
        const comma = photo.url.indexOf(",");
        base64 = comma >= 0 ? photo.url.slice(comma + 1) : undefined;
      }
      if (base64) photoExportsBase64.push({ photoId: photo.id, base64 });
    }
    if (photoExportsBase64.length > 1) row.photoExportsBase64 = photoExportsBase64;

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
    "reference_number",
    "year",
    "serial_number",
    "case_size",
    "lug_to_lug",
    "water_resistance",
    "movement",
    "current_value",
    "currency",
    "purchase_price",
    "purchase_date",
    "purchase_source",
    "complication_style",
    "wear_count",
    "last_worn_date",
    "condition",
    "box_papers",
    "notes",
    "service_history",
    "provenance_notes",
  ];
  const lines = [headers.join(",")];
  for (const w of watches) {
    lines.push(
      [
        escapeCsvCell(w.brand),
        escapeCsvCell(w.model),
        escapeCsvCell(w.referenceNumber ?? w.reference),
        escapeCsvCell(w.referenceNumber ?? w.reference),
        escapeCsvCell(w.year),
        escapeCsvCell(w.serialNumber),
        escapeCsvCell(w.caseSize),
        escapeCsvCell(w.lugToLug),
        escapeCsvCell(w.waterResistance),
        escapeCsvCell(w.movement),
        escapeCsvCell(typeof (w.currentValue ?? w.estimatedValue) === "number" ? (w.currentValue ?? w.estimatedValue) : undefined),
        escapeCsvCell(collectionCurrency),
        escapeCsvCell(typeof w.purchasePrice === "number" ? w.purchasePrice : undefined),
        escapeCsvCell(w.purchaseDate),
        escapeCsvCell(w.purchaseSource ?? w.seller),
        escapeCsvCell(w.complicationStyle),
        escapeCsvCell(w.wearCount),
        escapeCsvCell(w.lastWornDate),
        escapeCsvCell(w.condition ? CONDITION_LABELS[w.condition] : undefined),
        escapeCsvCell(w.boxPapers ? BOXPAPERS_LABELS[w.boxPapers] : undefined),
        escapeCsvCell(w.notes),
        escapeCsvCell(w.serviceHistoryNotes ?? w.serviceHistory),
        escapeCsvCell(w.provenanceNotes),
      ].join(","),
    );
  }
  return lines.join("\n");
}
