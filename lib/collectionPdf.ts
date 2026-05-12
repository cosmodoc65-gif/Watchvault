import { jsPDF } from "jspdf";
import { BOXPAPERS_LABELS, CONDITION_LABELS, type CollectionCurrency, type Watch } from "./watchNormalize";

const LOCALE_BY_CURRENCY: Record<CollectionCurrency, string> = {
  GBP: "en-GB",
  EUR: "de-DE",
  USD: "en-US",
  CHF: "de-CH",
  JPY: "ja-JP",
};

const GRID_COLS = 2;
const GRID_ROWS = 3;
const CARDS_PER_PAGE = GRID_COLS * GRID_ROWS;

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

/** object-fit: cover — center crop to box, export JPEG for embedding. */
function imageCoverToJpegDataUrl(
  img: HTMLImageElement,
  boxWmm: number,
  boxHmm: number,
  quality: number,
): string {
  const scalePx = 3;
  const pxW = Math.max(80, Math.round(((boxWmm * 96) / 25.4) * scalePx));
  const pxH = Math.max(60, Math.round(((boxHmm * 96) / 25.4) * scalePx));
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(pxW / iw, pxH / ih);
  const sw = pxW / s;
  const sh = pxH / s;
  const sx = Math.max(0, (iw - sw) / 2);
  const sy = Math.max(0, (ih - sh) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image for PDF.");
  ctx.fillStyle = "#f3f3f4";
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, pxW, pxH);
  return canvas.toDataURL("image/jpeg", quality);
}

type CardImage =
  | { kind: "jpeg"; dataUrl: string }
  | { kind: "placeholder"; reason: "none" | "remote" | "error" };

async function resolveCardImage(src: string | undefined, boxWmm: number, boxHmm: number): Promise<CardImage> {
  if (!src) return { kind: "placeholder", reason: "none" };
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return { kind: "placeholder", reason: "remote" };
  }
  try {
    const el = await loadImageElement(src);
    return { kind: "jpeg", dataUrl: imageCoverToJpegDataUrl(el, boxWmm, boxHmm, 0.8) };
  } catch {
    return { kind: "placeholder", reason: "error" };
  }
}

function drawGoldFrame(doc: jsPDF, margin: number, pageW: number, pageH: number) {
  doc.setDrawColor(150, 124, 78);
  doc.setLineWidth(0.35);
  doc.rect(margin, margin, pageW - 2 * margin, pageH - 2 * margin);
}

function splitToMaxLines(doc: jsPDF, text: string, maxWidthMm: number, maxLines: number): string[] {
  if (maxLines < 1) return [];
  let t = text.trim();
  if (!t) return [];
  for (let guard = 0; guard < 5000; guard++) {
    const raw = doc.splitTextToSize(t, maxWidthMm);
    if (raw.length <= maxLines) return raw;
    if (t.length <= 1) return raw.slice(0, maxLines);
    t = `${t.slice(0, Math.max(0, t.length - 2)).trimEnd()}…`;
  }
  return doc.splitTextToSize("…", maxWidthMm).slice(0, maxLines);
}

function drawCoverDisclaimer(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidthMm: number,
  lineMm: number,
  fontSize: number,
  maxY: number,
): number {
  doc.setFontSize(fontSize);
  doc.setTextColor(72, 72, 78);
  const lines = doc.splitTextToSize(text, maxWidthMm);
  let cy = y;
  for (const line of lines) {
    if (cy + lineMm > maxY) break;
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

  const margin = 11;
  const gold = { r: 150, g: 124, b: 78 };
  const ink = { r: 28, g: 28, b: 32 };
  const muted = { r: 96, g: 96, b: 102 };

  const colGap = 3;
  const rowGap = 2.5;
  const gridW = pageW - 2 * margin;
  const gridH = pageH - 2 * margin;
  const cardW = (gridW - colGap) / GRID_COLS;
  const cardH = (gridH - (GRID_ROWS - 1) * rowGap) / GRID_ROWS;
  const pad = 2;
  const imgH = Math.min(26, cardH * 0.32);
  const innerW = cardW - 2 * pad;

  const cardImages = await Promise.all(watches.map((w) => resolveCardImage(getPhotoSrc(w), innerW, imgH)));

  const contentW = pageW - 2 * margin - 8;
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

  const disclaimer =
    "Values shown are user-entered estimates and do not represent a formal valuation. " +
    "This personal collection report is for personal archive and supporting documentation only. " +
    "It is not a professional appraisal, an insurance certificate, a market valuation, or proof of ownership by itself.";
  y = drawCoverDisclaimer(doc, disclaimer, margin + 4, y, contentW, 4.2, 8.5, pageH - margin - 18);

  y += 6;
  doc.setTextColor(ink.r, ink.g, ink.b);
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.text("Following pages: compact catalogue grid (six watches per A4 page).", margin + 4, y);

  const drawCataloguePageShell = () => {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageW, pageH, "F");
  };

  const drawWatchCard = (w: Watch, img: CardImage, left: number, top: number) => {
    doc.setDrawColor(gold.r, gold.g, gold.b);
    doc.setLineWidth(0.45);
    doc.roundedRect(left, top, cardW, cardH, 1.2, 1.2, "S");

    const x0 = left + pad;
    let y0 = top + pad;

    if (img.kind === "jpeg") {
      try {
        doc.addImage(img.dataUrl, "JPEG", x0, y0, innerW, imgH);
      } catch {
        doc.setFillColor(243, 243, 244);
        doc.rect(x0, y0, innerW, imgH, "F");
        doc.setFontSize(7);
        doc.setTextColor(muted.r, muted.g, muted.b);
        doc.setFont("helvetica", "italic");
        doc.text("Photo unavailable", x0 + innerW / 2, y0 + imgH / 2, { align: "center" });
      }
    } else {
      doc.setFillColor(243, 243, 244);
      doc.rect(x0, y0, innerW, imgH, "F");
      doc.setDrawColor(210, 200, 185);
      doc.setLineWidth(0.2);
      doc.rect(x0, y0, innerW, imgH, "S");
      doc.setFontSize(7);
      doc.setTextColor(muted.r, muted.g, muted.b);
      doc.setFont("helvetica", "italic");
      const msg =
        img.reason === "remote"
          ? "Remote image (not embedded)"
          : img.reason === "error"
            ? "Photo unavailable"
            : "No photo";
      doc.text(msg, x0 + innerW / 2, y0 + imgH / 2, { align: "center" });
    }

    let ty = y0 + imgH + 2.8;
    const bottom = top + cardH - pad;
    const lineSmall = 3.15;
    const lineBrand = 3.6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(ink.r, ink.g, ink.b);
    const brandLines = splitToMaxLines(doc, w.brand || "—", innerW, 2);
    for (const ln of brandLines) {
      if (ty + lineBrand > bottom) return;
      doc.text(ln, x0, ty);
      ty += lineBrand;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(52, 52, 58);
    const modelLines = splitToMaxLines(doc, w.model || "", innerW, 2);
    for (const ln of modelLines) {
      if (ty + lineSmall > bottom) return;
      doc.text(ln, x0, ty);
      ty += lineSmall;
    }

    doc.setFontSize(6.8);
    doc.setTextColor(68, 68, 76);
    const bits: string[] = [];
    if (w.reference) bits.push(`Ref ${w.reference}`);
    if (w.year) bits.push(`Yr ${w.year}`);
    if (w.serialNumber) bits.push(`S/N ${w.serialNumber}`);
    if (bits.length) {
      const line = splitToMaxLines(doc, bits.join(" · "), innerW, 1)[0] ?? "";
      if (ty + lineSmall <= bottom) {
        doc.text(line, x0, ty);
        ty += lineSmall;
      }
    }

    if (typeof w.estimatedValue === "number") {
      const t = `Est ${formatMoney(w.estimatedValue, collectionCurrency)}`;
      if (ty + lineSmall <= bottom) {
        doc.setFont("helvetica", "bold");
        doc.text(t, x0, ty);
        ty += lineSmall;
        doc.setFont("helvetica", "normal");
      }
    }
    if (typeof w.purchasePrice === "number") {
      const t = `Purchase ${formatMoney(w.purchasePrice, collectionCurrency)}`;
      if (ty + lineSmall <= bottom) {
        doc.text(t, x0, ty);
        ty += lineSmall;
      }
    }
    if (ty + lineSmall <= bottom) {
      doc.setTextColor(80, 80, 88);
      doc.text(`Currency ${collectionCurrency}`, x0, ty);
      ty += lineSmall;
    }

    if (w.condition) {
      const t = CONDITION_LABELS[w.condition];
      if (ty + lineSmall <= bottom) {
        doc.text(`Condition: ${t}`, x0, ty);
        ty += lineSmall;
      }
    }
    if (w.boxPapers) {
      const t = BOXPAPERS_LABELS[w.boxPapers];
      if (ty + lineSmall <= bottom) {
        doc.text(`Box/papers: ${t}`, x0, ty);
        ty += lineSmall;
      }
    }
    if (w.isDemo && ty + lineSmall <= bottom) {
      doc.setFont("helvetica", "italic");
      doc.text("Demo / sample entry", x0, ty);
      ty += lineSmall;
      doc.setFont("helvetica", "normal");
    }

    if (w.serviceHistory?.trim() && ty + lineSmall * 2.5 <= bottom) {
      doc.setFontSize(6.2);
      doc.setTextColor(90, 90, 98);
      doc.setFont("helvetica", "bold");
      doc.text("Service", x0, ty);
      ty += lineSmall * 0.95;
      doc.setFont("helvetica", "normal");
      const lines = splitToMaxLines(doc, w.serviceHistory.trim(), innerW, 2);
      for (const ln of lines) {
        if (ty + lineSmall > bottom) break;
        doc.text(ln, x0, ty);
        ty += lineSmall;
      }
    }

    if (w.notes?.trim() && ty + lineSmall * 2 <= bottom) {
      doc.setFontSize(6.2);
      doc.setTextColor(90, 90, 98);
      doc.setFont("helvetica", "bold");
      doc.text("Notes", x0, ty);
      ty += lineSmall * 0.95;
      doc.setFont("helvetica", "normal");
      const lines = splitToMaxLines(doc, w.notes.trim(), innerW, 2);
      for (const ln of lines) {
        if (ty + lineSmall > bottom) break;
        doc.text(ln, x0, ty);
        ty += lineSmall;
      }
    }
  };

  doc.addPage();
  drawCataloguePageShell();

  for (let i = 0; i < watches.length; i++) {
    if (i > 0 && i % CARDS_PER_PAGE === 0) {
      doc.addPage();
      drawCataloguePageShell();
    }
    const slot = i % CARDS_PER_PAGE;
    const col = slot % GRID_COLS;
    const row = Math.floor(slot / GRID_COLS);
    const left = margin + col * (cardW + colGap);
    const top = margin + row * (cardH + rowGap);
    drawWatchCard(watches[i], cardImages[i], left, top);
  }

  doc.save(`WatchVault-Collection-Report-${reportDateStamp()}.pdf`);
}
