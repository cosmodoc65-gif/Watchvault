import { jsPDF } from "jspdf";
import { BOXPAPERS_LABELS, CONDITION_LABELS, type CollectionCurrency, type Watch } from "./watchNormalize";

const LOCALE_BY_CURRENCY: Record<CollectionCurrency, string> = {
  GBP: "en-GB",
  EUR: "de-DE",
  USD: "en-US",
  CHF: "de-CH",
  JPY: "ja-JP",
};

function formatMoney(value: number, currency: CollectionCurrency): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function reportDateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for PDF."));
    img.src = src;
  });
}

/** Resize for embedded PDF JPEG (identification / archive quality, bounded file size). */
function imageToJpegDataUrl(img: HTMLImageElement, maxLongSidePx: number, quality: number): { dataUrl: string; w: number; h: number } {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const scale = Math.min(1, maxLongSidePx / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image for PDF.");
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl, w, h };
}

function fitImageToBoxMm(imgWpx: number, imgHpx: number, maxWMm: number, maxHMm: number): { wMm: number; hMm: number } {
  const aspect = imgWpx / imgHpx;
  let wMm = maxWMm;
  let hMm = wMm / aspect;
  if (hMm > maxHMm) {
    hMm = maxHMm;
    wMm = hMm * aspect;
  }
  return { wMm, hMm };
}

function drawGoldFrame(doc: jsPDF, margin: number, pageW: number, pageH: number) {
  doc.setDrawColor(150, 124, 78);
  doc.setLineWidth(0.35);
  doc.rect(margin, margin, pageW - 2 * margin, pageH - 2 * margin);
}

function ensureY(doc: jsPDF, y: number, neededMm: number, margin: number, pageH: number, bottomPad: number): number {
  if (y + neededMm <= pageH - margin - bottomPad) return y;
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
  drawGoldFrame(doc, margin, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight());
  return margin + 8;
}

function drawWrapped(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidthMm: number,
  lineMm: number,
  margin: number,
  pageH: number,
  bottomPad: number,
  fontSize: number,
): number {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, maxWidthMm);
  let cy = y;
  for (const line of lines) {
    cy = ensureY(doc, cy, lineMm, margin, pageH, bottomPad);
    doc.text(line, x, cy);
    cy += lineMm;
  }
  return cy;
}

export type CollectionPdfOptions = {
  watches: Watch[];
  collectionCurrency: CollectionCurrency;
  /** Resolved blob: URL, legacy data URL, or remote http(s) URL. */
  getPhotoSrc: (watch: Watch) => string | undefined;
};

/**
 * Builds a printable personal collection report (browser-only).
 * Wording is intentionally conservative — not an appraisal or insurance certificate.
 */
export async function downloadWatchVaultCollectionPdf(options: CollectionPdfOptions): Promise<void> {
  const { watches, collectionCurrency, getPhotoSrc } = options;
  if (watches.length === 0) {
    throw new Error("Add at least one watch before exporting a PDF report.");
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const bottomPad = 14;
  const contentW = pageW - 2 * margin - 8;
  const gold = { r: 150, g: 124, b: 78 };
  const ink = { r: 28, g: 28, b: 32 };

  const totalEstimated = watches.reduce((sum, w) => sum + (typeof w.estimatedValue === "number" ? w.estimatedValue : 0), 0);

  // —— Cover ——
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, "F");
  drawGoldFrame(doc, margin, pageW, pageH);

  let y = margin + 10;
  doc.setTextColor(gold.r, gold.g, gold.b);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("WatchVault", margin + 4, y);
  y += 12;

  doc.setTextColor(ink.r, ink.g, ink.b);
  doc.setFontSize(15);
  const titleLines = doc.splitTextToSize("WatchVault Collection Report", contentW);
  doc.text(titleLines, margin + 4, y);
  y += titleLines.length * 6 + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin + 4, y);
  y += 6;
  doc.text(`Display currency: ${collectionCurrency} (user-entered amounts, not converted)`, margin + 4, y);
  y += 6;
  doc.text(`Watches in this report: ${watches.length}`, margin + 4, y);
  y += 6;
  doc.text(`Total estimated value: ${formatMoney(totalEstimated, collectionCurrency)}`, margin + 4, y);
  y += 10;

  doc.setFontSize(8.5);
  doc.setTextColor(72, 72, 78);
  const disclaimer =
    "Values shown are user-entered estimates and do not represent a formal valuation. " +
    "This personal collection report is for personal archive and supporting documentation only. " +
    "It is not a professional appraisal, an insurance certificate, a market valuation, or proof of ownership by itself.";
  y = drawWrapped(doc, disclaimer, margin + 4, y, contentW, 4.2, margin, pageH, bottomPad, 8.5);

  y += 6;
  doc.setTextColor(ink.r, ink.g, ink.b);
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.text("Following pages: one watch per section (may continue across pages if needed).", margin + 4, y);

  // —— Watches ——
  const maxImgW = contentW;
  const maxImgH = 78;

  for (let i = 0; i < watches.length; i++) {
    const w = watches[i];
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageW, pageH, "F");
    drawGoldFrame(doc, margin, pageW, pageH);

    let cy = margin + 8;
    doc.setTextColor(gold.r, gold.g, gold.b);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Watch ${i + 1} of ${watches.length}`, margin + 4, cy);
    cy += 8;

    const src = getPhotoSrc(w);
    if (src?.startsWith("http://") || src?.startsWith("https://")) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 108);
      cy = drawWrapped(
        doc,
        "Photo uses a remote URL and was not embedded in this PDF. Open WatchVault to view the image.",
        margin + 4,
        cy,
        contentW,
        4.2,
        margin,
        pageH,
        bottomPad,
        9,
      );
      cy += 2;
    } else if (src) {
      try {
        const el = await loadImageElement(src);
        const { dataUrl, w: pxW, h: pxH } = imageToJpegDataUrl(el, 1100, 0.82);
        const { wMm, hMm } = fitImageToBoxMm(pxW, pxH, maxImgW, maxImgH);
        cy = ensureY(doc, cy, hMm + 2, margin, pageH, bottomPad);
        doc.addImage(dataUrl, "JPEG", margin + 4, cy, wMm, hMm);
        cy += hMm + 6;
      } catch {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 108);
        cy = drawWrapped(doc, "Photo could not be included in this PDF.", margin + 4, cy, contentW, 4.2, margin, pageH, bottomPad, 9);
        cy += 2;
      }
    } else {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 108);
      cy = drawWrapped(doc, "No photo on file for this entry.", margin + 4, cy, contentW, 4.2, margin, pageH, bottomPad, 9);
      cy += 2;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(ink.r, ink.g, ink.b);
    const title = `${w.brand} — ${w.model}`;
    cy = drawWrapped(doc, title, margin + 4, cy, contentW, 5.5, margin, pageH, bottomPad, 12);
    cy += 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const rows: string[] = [];
    if (w.reference) rows.push(`Reference: ${w.reference}`);
    if (w.year) rows.push(`Year: ${w.year}`);
    if (w.serialNumber) rows.push(`Serial number: ${w.serialNumber}`);
    if (typeof w.purchasePrice === "number") rows.push(`Purchase price: ${formatMoney(w.purchasePrice, collectionCurrency)}`);
    if (typeof w.estimatedValue === "number") rows.push(`Estimated value: ${formatMoney(w.estimatedValue, collectionCurrency)}`);
    rows.push(`Currency (display): ${collectionCurrency}`);
    if (w.condition) rows.push(`Condition: ${CONDITION_LABELS[w.condition]}`);
    if (w.boxPapers) rows.push(`Box & papers: ${BOXPAPERS_LABELS[w.boxPapers]}`);
    if (w.isDemo) rows.push("Entry type: Demo / sample data");

    for (const row of rows) {
      cy = drawWrapped(doc, row, margin + 4, cy, contentW, 5, margin, pageH, bottomPad, 10);
    }

    if (w.serviceHistory?.trim()) {
      cy += 3;
      cy = ensureY(doc, cy, 8, margin, pageH, bottomPad);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Service history", margin + 4, cy);
      cy += 5;
      doc.setFont("helvetica", "normal");
      cy = drawWrapped(doc, w.serviceHistory.trim(), margin + 4, cy, contentW, 4.8, margin, pageH, bottomPad, 9.5);
    }

    if (w.notes?.trim()) {
      cy += 3;
      cy = ensureY(doc, cy, 8, margin, pageH, bottomPad);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Notes", margin + 4, cy);
      cy += 5;
      doc.setFont("helvetica", "normal");
      cy = drawWrapped(doc, w.notes.trim(), margin + 4, cy, contentW, 4.8, margin, pageH, bottomPad, 9.5);
    }

    doc.setFontSize(8);
    doc.setTextColor(120, 120, 128);
    cy = ensureY(doc, cy, 6, margin, pageH, bottomPad);
    doc.text("User-entered fields only — not a formal valuation.", margin + 4, cy);
  }

  doc.save(`WatchVault-Collection-Report-${reportDateStamp()}.pdf`);
}
