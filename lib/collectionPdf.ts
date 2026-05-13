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

/** Print-friendly catalogue tones */
const palette = {
  gold: { r: 168, g: 138, b: 88 },
  goldSoft: { r: 198, g: 172, b: 128 },
  coverBg: { r: 22, g: 21, b: 24 },
  coverCream: { r: 238, g: 232, b: 222 },
  coverMuted: { r: 188, g: 180, b: 168 },
  pageWarm: { r: 242, g: 237, b: 230 },
  cardCream: { r: 254, g: 250, b: 244 },
  charcoal: { r: 38, g: 36, b: 42 },
  ink: { r: 26, g: 24, b: 28 },
  inkSoft: { r: 58, g: 54, b: 62 },
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

/** object-fit: contain in mm — max box respects optional inset for cream breathing room. */
function containedSizeMm(
  iw: number,
  ih: number,
  maxWmm: number,
  maxHmm: number,
  inset: number,
): { wMm: number; hMm: number } {
  const mw = maxWmm * inset;
  const mh = maxHmm * inset;
  const aspect = iw / ih;
  let wMm = mw;
  let hMm = wMm / aspect;
  if (hMm > mh) {
    hMm = mh;
    wMm = hMm * aspect;
  }
  return { wMm, hMm };
}

/**
 * Full image, contain scaling, no letterboxing in the raster — dimensions match draw size on the PDF.
 */
function imageContainedJpeg(
  img: HTMLImageElement,
  maxWmm: number,
  maxHmm: number,
  quality: number,
  inset: number,
): { dataUrl: string; widthMm: number; heightMm: number } {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const { wMm, hMm } = containedSizeMm(iw, ih, maxWmm, maxHmm, inset);

  const scalePx = 2.75;
  const pxW = Math.max(48, Math.round(((wMm * 96) / 25.4) * scalePx));
  const pxH = Math.max(48, Math.round(((hMm * 96) / 25.4) * scalePx));

  const canvas = document.createElement("canvas");
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image for PDF.");
  ctx.drawImage(img, 0, 0, iw, ih, 0, 0, pxW, pxH);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), widthMm: wMm, heightMm: hMm };
}

type CardImage =
  | { kind: "jpeg"; dataUrl: string; widthMm: number; heightMm: number }
  | { kind: "placeholder"; reason: "none" | "remote" | "error" };

async function resolveCardImage(src: string | undefined, boxWmm: number, boxHmm: number): Promise<CardImage> {
  if (!src) return { kind: "placeholder", reason: "none" };
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return { kind: "placeholder", reason: "remote" };
  }
  try {
    const el = await loadImageElement(src);
    const inset = 0.9;
    const { dataUrl, widthMm, heightMm } = imageContainedJpeg(el, boxWmm, boxHmm, 0.82, inset);
    return { kind: "jpeg", dataUrl, widthMm, heightMm };
  } catch {
    return { kind: "placeholder", reason: "error" };
  }
}

function drawCoverGoldFrame(doc: jsPDF, margin: number, pageW: number, pageH: number) {
  doc.setDrawColor(palette.gold.r, palette.gold.g, palette.gold.b);
  doc.setLineWidth(0.55);
  doc.rect(margin, margin, pageW - 2 * margin, pageH - 2 * margin);
  doc.setLineWidth(0.2);
  doc.setDrawColor(palette.goldSoft.r, palette.goldSoft.g, palette.goldSoft.b);
  doc.rect(margin + 1.2, margin + 1.2, pageW - 2 * margin - 2.4, pageH - 2 * margin - 2.4);
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
  rgb: { r: number; g: number; b: number },
): number {
  doc.setFontSize(fontSize);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  const lines = doc.splitTextToSize(text, maxWidthMm);
  let cy = y;
  for (const line of lines) {
    if (cy + lineMm > maxY) break;
    doc.text(line, x, cy);
    cy += lineMm;
  }
  return cy;
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
export async function downloadWristfolioCollectionPdf(options: CollectionPdfOptions): Promise<void> {
  const { watches, collectionCurrency, getPhotoSrc } = options;
  if (watches.length === 0) {
    throw new Error("Add at least one watch before exporting a PDF report.");
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 11;
  const colGap = 3;
  const rowGap = 2.5;
  const gridW = pageW - 2 * margin;
  const gridH = pageH - 2 * margin;
  const cardW = (gridW - colGap) / GRID_COLS;
  const cardH = (gridH - (GRID_ROWS - 1) * rowGap) / GRID_ROWS;
  const pad = 2.2;
  /** Photo strip: contain-fit full watch; height balanced so text block still fits in ~90mm cards */
  const imgH = Math.min(38, Math.max(30, cardH * 0.385));
  const innerW = cardW - 2 * pad;

  const cardImages = await Promise.all(watches.map((w) => resolveCardImage(getPhotoSrc(w), innerW, imgH)));

  const contentW = pageW - 2 * margin - 8;
  const totalEstimated = watches.reduce((sum, w) => sum + (typeof w.estimatedValue === "number" ? w.estimatedValue : 0), 0);

  // —— Cover (dark, premium; print-friendly ink on one page only) ——
  doc.setFillColor(palette.coverBg.r, palette.coverBg.g, palette.coverBg.b);
  doc.rect(0, 0, pageW, pageH, "F");
  drawCoverGoldFrame(doc, margin, pageW, pageH);

  let y = margin + 12;
  doc.setTextColor(palette.goldSoft.r, palette.goldSoft.g, palette.goldSoft.b);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(27);
  doc.text("Wristfolio", margin + 4, y);
  y += 13;

  doc.setTextColor(palette.coverCream.r, palette.coverCream.g, palette.coverCream.b);
  doc.setFontSize(15.5);
  const titleLines = doc.splitTextToSize("Wristfolio Collection Report", contentW);
  doc.text(titleLines, margin + 4, y);
  y += titleLines.length * 6.2 + 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin + 4, y);
  y += 6.2;
  doc.text(`Display currency: ${collectionCurrency} (user-entered amounts, not converted)`, margin + 4, y);
  y += 6.2;
  doc.text(`Watches in this report: ${watches.length}`, margin + 4, y);
  y += 6.2;
  doc.text(`Total estimated value: ${formatMoney(totalEstimated, collectionCurrency)}`, margin + 4, y);
  y += 11;

  const disclaimer =
    "Values shown are user-entered estimates and do not represent a formal valuation. " +
    "This personal collection report is for personal archive and supporting documentation only. " +
    "It is not a professional appraisal, an insurance certificate, a market valuation, or proof of ownership by itself.";
  y = drawCoverDisclaimer(doc, disclaimer, margin + 4, y, contentW, 4.35, 8.5, pageH - margin - 20, palette.coverMuted);

  y += 7;
  doc.setTextColor(palette.gold.r, palette.gold.g, palette.gold.b);
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.text("Following pages: warm catalogue grid — six watches per A4 page.", margin + 4, y);

  const drawCataloguePageShell = () => {
    doc.setFillColor(palette.pageWarm.r, palette.pageWarm.g, palette.pageWarm.b);
    doc.rect(0, 0, pageW, pageH, "F");
  };

  const drawWatchCard = (w: Watch, img: CardImage, left: number, top: number) => {
    doc.setDrawColor(palette.gold.r, palette.gold.g, palette.gold.b);
    doc.setLineWidth(0.5);
    doc.roundedRect(left, top, cardW, cardH, 1.4, 1.4, "S");

    const innerLeft = left + pad;
    const innerTop = top + pad;
    const innerCardW = cardW - 2 * pad;
    const innerCardH = cardH - 2 * pad;

    doc.setFillColor(palette.cardCream.r, palette.cardCream.g, palette.cardCream.b);
    doc.roundedRect(innerLeft, innerTop, innerCardW, innerCardH, 0.9, 0.9, "F");

    const x0 = innerLeft + 1.4;
    const yPhoto = innerTop + 1.4;
    const photoInnerW = innerCardW - 2.8;

    /* Photo strip: cream field (no full-width charcoal band); image sits on a small centred charcoal pad */
    doc.setFillColor(palette.cardCream.r, palette.cardCream.g, palette.cardCream.b);
    doc.rect(x0, yPhoto, photoInnerW, imgH, "F");
    doc.setDrawColor(palette.goldSoft.r, palette.goldSoft.g, palette.goldSoft.b);
    doc.setLineWidth(0.12);
    doc.rect(x0, yPhoto, photoInnerW, imgH, "S");

    if (img.kind === "jpeg") {
      try {
        const ix = x0 + (photoInnerW - img.widthMm) / 2;
        const iy = yPhoto + (imgH - img.heightMm) / 2;
        doc.setFillColor(palette.charcoal.r, palette.charcoal.g, palette.charcoal.b);
        doc.rect(ix, iy, img.widthMm, img.heightMm, "F");
        doc.setDrawColor(palette.gold.r, palette.gold.g, palette.gold.b);
        doc.setLineWidth(0.12);
        doc.rect(ix, iy, img.widthMm, img.heightMm, "S");
        doc.addImage(img.dataUrl, "JPEG", ix, iy, img.widthMm, img.heightMm);
      } catch {
        doc.setFontSize(7.5);
        doc.setTextColor(palette.coverMuted.r, palette.coverMuted.g, palette.coverMuted.b);
        doc.setFont("helvetica", "italic");
        doc.text("Photo unavailable", x0 + photoInnerW / 2, yPhoto + imgH / 2, { align: "center" });
      }
    } else {
      doc.setFontSize(7.5);
      doc.setTextColor(palette.coverMuted.r, palette.coverMuted.g, palette.coverMuted.b);
      doc.setFont("helvetica", "italic");
      const msg =
        img.reason === "remote"
          ? "Remote image (not embedded)"
          : img.reason === "error"
            ? "Photo unavailable"
            : "No photo";
      doc.text(msg, x0 + photoInnerW / 2, yPhoto + imgH / 2, { align: "center" });
    }

    let ty = yPhoto + imgH + 3.2;
    const bottom = innerTop + innerCardH - 1.6;
    const lineMeta = 3.45;
    const lineBrand = 4.1;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    doc.setTextColor(palette.ink.r, palette.ink.g, palette.ink.b);
    const brandLines = splitToMaxLines(doc, w.brand || "—", photoInnerW, 2);
    for (const ln of brandLines) {
      if (ty + lineBrand > bottom) return;
      doc.text(ln, x0, ty);
      ty += lineBrand;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.1);
    doc.setTextColor(palette.inkSoft.r, palette.inkSoft.g, palette.inkSoft.b);
    const modelLines = splitToMaxLines(doc, w.model || "", photoInnerW, 2);
    for (const ln of modelLines) {
      if (ty + lineMeta > bottom) return;
      doc.text(ln, x0, ty);
      ty += lineMeta;
    }

    ty += 0.6;
    doc.setFontSize(7.2);
    doc.setTextColor(palette.inkSoft.r, palette.inkSoft.g, palette.inkSoft.b);
    const bits: string[] = [];
    if (w.reference) bits.push(`Ref ${w.reference}`);
    if (w.year) bits.push(`Year ${w.year}`);
    if (w.serialNumber) bits.push(`Serial ${w.serialNumber}`);
    if (w.caseSize) bits.push(`${w.caseSize}`);
    if (w.movement) bits.push(`${w.movement}`);
    if (bits.length) {
      const line = splitToMaxLines(doc, bits.join(" · "), photoInnerW, 1)[0] ?? "";
      if (ty + lineMeta <= bottom) {
        doc.text(line, x0, ty);
        ty += lineMeta;
      }
    }

    if (typeof w.estimatedValue === "number") {
      const t = `Est. ${formatMoney(w.estimatedValue, collectionCurrency)}`;
      if (ty + lineMeta <= bottom) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(palette.ink.r, palette.ink.g, palette.ink.b);
        doc.text(t, x0, ty);
        ty += lineMeta;
        doc.setFont("helvetica", "normal");
      }
    }
    if (typeof w.purchasePrice === "number") {
      const t = `Purchase ${formatMoney(w.purchasePrice, collectionCurrency)}`;
      if (ty + lineMeta <= bottom) {
        doc.setTextColor(palette.inkSoft.r, palette.inkSoft.g, palette.inkSoft.b);
        doc.text(t, x0, ty);
        ty += lineMeta;
      }
    }
    if (ty + lineMeta <= bottom) {
      doc.setTextColor(palette.inkSoft.r, palette.inkSoft.g, palette.inkSoft.b);
      doc.text(`Currency ${collectionCurrency}`, x0, ty);
      ty += lineMeta;
    }

    if (w.condition) {
      const t = CONDITION_LABELS[w.condition];
      if (ty + lineMeta <= bottom) {
        doc.text(`Condition: ${t}`, x0, ty);
        ty += lineMeta;
      }
    }
    if (w.boxPapers) {
      const t = BOXPAPERS_LABELS[w.boxPapers];
      if (ty + lineMeta <= bottom) {
        doc.text(`Box / papers: ${t}`, x0, ty);
        ty += lineMeta;
      }
    }
    if (w.isDemo && ty + lineMeta <= bottom) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(palette.gold.r, palette.gold.g, palette.gold.b);
      doc.text("Demo / sample entry", x0, ty);
      ty += lineMeta;
      doc.setFont("helvetica", "normal");
    }

    if (w.serviceHistory?.trim() && ty + lineMeta * 2.4 <= bottom) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(palette.gold.r, palette.gold.g, palette.gold.b);
      doc.text("Service history", x0, ty);
      ty += lineMeta * 0.9;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(palette.inkSoft.r, palette.inkSoft.g, palette.inkSoft.b);
      const lines = splitToMaxLines(doc, w.serviceHistory.trim(), photoInnerW, 2);
      for (const ln of lines) {
        if (ty + lineMeta > bottom) break;
        doc.text(ln, x0, ty);
        ty += lineMeta;
      }
    }

    if (w.notes?.trim() && ty + lineMeta * 2.2 <= bottom) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(palette.gold.r, palette.gold.g, palette.gold.b);
      doc.text("Notes", x0, ty);
      ty += lineMeta * 0.9;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(palette.inkSoft.r, palette.inkSoft.g, palette.inkSoft.b);
      const lines = splitToMaxLines(doc, w.notes.trim(), photoInnerW, 2);
      for (const ln of lines) {
        if (ty + lineMeta > bottom) break;
        doc.text(ln, x0, ty);
        ty += lineMeta;
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

  doc.save(`Wristfolio-Collection-Report-${reportDateStamp()}.pdf`);
}
