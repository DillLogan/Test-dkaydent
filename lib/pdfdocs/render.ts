import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { code128 } from "./code128";
import type { Column, DocData, El, LabelSheet, Row, Template } from "./types";

/* ------------------------------------------------------------------ helpers */

/** The standard PDF fonts only know Windows-1252 characters; swap or drop the rest so text never fails. */
const WIN = new Set<number>([
  ...Array.from({ length: 95 }, (_, i) => 32 + i),
  ...Array.from({ length: 96 }, (_, i) => 160 + i),
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
const SWAP: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "✓": "v", "✕": "x", "−": "-", " ": " ", "\t": " " };
export function winAnsi(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    if (ch === "\n") { out += ch; continue; }
    const c = ch.codePointAt(0)!;
    out += WIN.has(c) ? ch : SWAP[ch] ?? (c < 32 ? "" : "?");
  }
  return out;
}

export function getField(fields: Record<string, unknown>, path: string): unknown {
  let v: unknown = fields;
  for (const k of path.split(".")) {
    if (v && typeof v === "object" && k in (v as Record<string, unknown>)) v = (v as Record<string, unknown>)[k];
    else return undefined;
  }
  return v;
}
const shown = (v: unknown) => !(v === undefined || v === null || v === false || v === "" || v === 0 || (Array.isArray(v) && !v.length));
export function fill(text: string, fields: Record<string, unknown>, extra: Record<string, string> = {}): string {
  return String(text ?? "").replace(/\{([\w.]+)\}/g, (_, k: string) => {
    if (k in extra) return extra[k];
    const v = getField(fields, k);
    return v === undefined || v === null || v === false ? "" : v === true ? "Yes" : String(v);
  });
}

function hex(c: string | undefined, d = "#111111") {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || d) || /^#?([0-9a-f]{6})$/i.exec(d)!;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type Fonts = { reg: PDFFont; bold: PDFFont; ital: PDFFont; mono: PDFFont; monoBold: PDFFont };
const pick = (f: Fonts, o: { bold?: boolean; mono?: boolean; italic?: boolean }) => (o.mono ? (o.bold ? f.monoBold : f.mono) : o.bold ? f.bold : o.italic ? f.ital : f.reg);

/** Break text into lines that fit the width (long words are cut). */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text).split("\n")) {
    const words = para.split(/ +/);
    let line = "";
    for (let w of words) {
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        // a word longer than the line: cut it
        let n = w.length;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= width || !line) line = t;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/* ------------------------------------------------------------------ drawing */

type Ctx = { doc: PDFDocument; f: Fonts; sx: number; sy: number; fs: number; H: number; images: Map<string, PDFImage> };

function drawText(ctx: Ctx, page: PDFPage, text: string, x: number, y: number, w: number, h: number, o: { size?: number; bold?: boolean; mono?: boolean; italic?: boolean; upper?: boolean; align?: string; color?: string }, clip = true) {
  const size = (o.size || 10) * ctx.fs;
  const font = pick(ctx.f, o);
  const lh = size * 1.18;
  let lines = wrap(o.upper ? text.toUpperCase() : text, font, size, Math.max(4, w));
  if (clip) lines = lines.slice(0, Math.max(1, Math.floor((h + size * 0.2) / lh)));
  lines.forEach((ln, i) => {
    const tw = font.widthOfTextAtSize(ln, size);
    const tx = o.align === "right" ? x + w - tw : o.align === "center" ? x + (w - tw) / 2 : x;
    page.drawText(ln, { x: tx, y: ctx.H - (y + size * 0.86 + i * lh), size, font, color: hex(o.color) });
  });
  return lines.length * lh;
}

function drawBarcode(ctx: Ctx, page: PDFPage, value: string, x: number, y: number, w: number, h: number, color?: string) {
  const mods = code128(winAnsi(value).trim());
  if (!mods) return;
  const quiet = 10;
  const total = mods.reduce((a, b) => a + b, 0) + quiet * 2;
  const m = w / total;
  let cx = x + quiet * m;
  mods.forEach((n, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: cx, y: ctx.H - y - h, width: n * m, height: h, color: hex(color) });
    cx += n * m;
  });
}

async function imageOf(ctx: Ctx, src: string) {
  if (ctx.images.has(src)) return ctx.images.get(src)!;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(src);
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  try {
    const img = m[1].toLowerCase() === "png" ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes);
    ctx.images.set(src, img);
    return img;
  } catch {
    return null;
  }
}

/** One element (not the table) at a page position (already scaled). */
async function drawEl(ctx: Ctx, page: PDFPage, el: El, fields: Record<string, unknown>, x: number, y: number, extra: Record<string, string>) {
  const w = el.w * ctx.sx, h = el.h * ctx.sy;
  const color = el.color;
  switch (el.type) {
    case "text":
    case "pagenum": {
      const t = fill(el.text || "", fields, extra);
      if (t.trim()) drawText(ctx, page, t, x, y, w, h, el);
      break;
    }
    case "barcode":
      drawBarcode(ctx, page, fill(el.text || "", fields, extra), x, y, w, h, color);
      break;
    case "line":
      if (h > w) page.drawLine({ start: { x: x + w / 2, y: ctx.H - y }, end: { x: x + w / 2, y: ctx.H - y - h }, thickness: (el.stroke ?? 1) * ctx.fs, color: hex(color) });
      else page.drawLine({ start: { x, y: ctx.H - y - h / 2 }, end: { x: x + w, y: ctx.H - y - h / 2 }, thickness: (el.stroke ?? 1) * ctx.fs, color: hex(color) });
      break;
    case "box":
      page.drawRectangle({ x, y: ctx.H - y - h, width: w, height: h, borderColor: el.stroke ? hex(color) : undefined, borderWidth: (el.stroke ?? 0) * ctx.fs, color: el.fill ? hex(el.fill) : undefined });
      if (el.text) drawText(ctx, page, fill(el.text, fields, extra), x + 6 * ctx.fs, y + 4 * ctx.fs, w - 12 * ctx.fs, h - 8 * ctx.fs, { ...el, color: el.color });
      break;
    case "image": {
      const img = el.src ? await imageOf(ctx, el.src) : null;
      if (!img) break;
      const r = Math.min(w / img.width, h / img.height);
      const iw = img.width * r, ih = img.height * r;
      const ix = el.align === "right" ? x + w - iw : el.align === "center" ? x + (w - iw) / 2 : x;
      page.drawImage(img, { x: ix, y: ctx.H - y - ih, width: iw, height: ih });
      break;
    }
    case "mustcheck": {
      const red = el.color || "#c62828";
      page.drawRectangle({ x, y: ctx.H - y - h, width: w, height: h, borderColor: hex(red), borderWidth: 2 * ctx.fs });
      drawText(ctx, page, el.text || "MUST CHECK", x, y + h * 0.1, w, h * 0.4, { size: el.size || 20, bold: true, align: "center", color: red });
      page.drawLine({ start: { x: x + 10 * ctx.fs, y: ctx.H - y - h * 0.72 }, end: { x: x + w - 10 * ctx.fs, y: ctx.H - y - h * 0.72 }, thickness: 1.2 * ctx.fs, color: hex(red) });
      drawText(ctx, page, "SIGNATURE", x + 10 * ctx.fs, y + h * 0.76, w, h * 0.2, { size: 7, bold: true, color: red });
      break;
    }
    case "signature":
      page.drawLine({ start: { x, y: ctx.H - y - h + 12 * ctx.fs }, end: { x: x + w, y: ctx.H - y - h + 12 * ctx.fs }, thickness: 0.8 * ctx.fs, color: hex("#111111") });
      drawText(ctx, page, fill(el.text || "", fields, extra), x, y + h - 9 * ctx.fs, w, 10 * ctx.fs, { size: el.size || 8, bold: true, color: el.color || "#57534e" });
      break;
  }
}

const visible = (el: El, fields: Record<string, unknown>) => !el.hidden && (!el.when || shown(getField(fields, el.when)));

/* ------------------------------------------------------------------ tables */

function colsOf(el: El, W: number) {
  const cols = (el.columns || []).filter((c) => !c.hidden);
  const sum = cols.reduce((a, c) => a + c.w, 0) || 1;
  let x = 0;
  return cols.map((c) => { const w = (c.w / sum) * W; const o = { c, x, w }; x += w; return o; });
}

function rowHeight(ctx: Ctx, cols: ReturnType<typeof colsOf>, row: Row, size: number) {
  const pad = 4 * ctx.fs;
  let h = size * 1.18;
  for (const { c, w } of cols) {
    if (c.kind === "check" || c.kind === "blank") continue;
    const font = pick(ctx.f, { bold: c.bold, mono: c.kind === "mono" });
    const n = wrap(String(row[c.key] ?? ""), font, size, w - 6 * ctx.fs).length;
    let ch = n * size * 1.18;
    if (c.sub && row[c.sub]) ch += wrap(String(row[c.sub]), ctx.f.reg, size * 0.82, w - 6 * ctx.fs).length * size * 0.82 * 1.18;
    h = Math.max(h, ch);
  }
  return h + pad * 2;
}

function drawHeader(ctx: Ctx, page: PDFPage, cols: ReturnType<typeof colsOf>, x: number, y: number, W: number, size: number) {
  const hs = size * 0.86;
  for (const { c, x: cx, w } of cols) if (c.label) drawText(ctx, page, c.label, x + cx + 3 * ctx.fs, y + 3 * ctx.fs, w - 6 * ctx.fs, hs * 1.3, { size: hs / ctx.fs, bold: true, align: c.align, color: "#57534e" });
  const hh = hs * 1.3 + 6 * ctx.fs;
  page.drawLine({ start: { x, y: ctx.H - y - hh }, end: { x: x + W, y: ctx.H - y - hh }, thickness: 0.9 * ctx.fs, color: hex("#a8a29e") });
  return hh;
}

function drawRow(ctx: Ctx, page: PDFPage, cols: ReturnType<typeof colsOf>, row: Row, x: number, y: number, W: number, size: number, h: number) {
  const pad = 4 * ctx.fs;
  for (const { c, x: cx, w } of cols) {
    const left = x + cx + 3 * ctx.fs, cw = w - 6 * ctx.fs;
    if (c.kind === "check") {
      const s = Math.min(10 * ctx.fs, size * 1.05);
      page.drawRectangle({ x: left, y: ctx.H - y - pad - s, width: s, height: s, borderColor: hex("#111111"), borderWidth: 1.1 * ctx.fs });
      continue;
    }
    if (c.kind === "blank") {
      page.drawLine({ start: { x: left, y: ctx.H - y - h + pad }, end: { x: left + cw, y: ctx.H - y - h + pad }, thickness: 0.7 * ctx.fs, color: hex("#57534e") });
      continue;
    }
    const used = drawText(ctx, page, String(row[c.key] ?? ""), left, y + pad, cw, h, { size: size / ctx.fs, bold: c.bold, mono: c.kind === "mono", align: c.align }, false);
    if (c.sub && row[c.sub]) drawText(ctx, page, String(row[c.sub]), left, y + pad + used, cw, h, { size: (size * 0.82) / ctx.fs, align: c.align, color: "#57534e", mono: false }, false);
  }
  page.drawLine({ start: { x, y: ctx.H - y - h }, end: { x: x + W, y: ctx.H - y - h }, thickness: 0.5 * ctx.fs, color: hex("#e7e5e4") });
}

/* ------------------------------------------------------------------ documents */

async function fonts(doc: PDFDocument): Promise<Fonts> {
  const [reg, bold, ital, mono, monoBold] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
    doc.embedFont(StandardFonts.Courier),
    doc.embedFont(StandardFonts.CourierBold),
  ]);
  return { reg, bold, ital, mono, monoBold };
}

/** Lay out one copy of a document into doc (adds pages). Returns the pages it made. */
async function layoutCopy(doc: PDFDocument, f: Fonts, t: Template, data: DocData, extra: Record<string, string>, size?: { w: number; h: number }) {
  const W = size?.w ?? t.page.w, H = size?.h ?? t.page.h;
  const ctx: Ctx = { doc, f, sx: W / t.page.w, sy: H / t.page.h, fs: Math.min(W / t.page.w, H / t.page.h), H, images: new Map() };
  const fields = { ...data.fields, ...extra };
  const els = t.elements.filter((e) => visible(e, fields));
  const pages: PDFPage[] = [];
  const pageEls = (first: boolean) => els.filter((e) => e.type !== "table" && e.type !== "pagenum" && (e.flow ?? "page") === "page" && ((e.pages ?? "first") === "all" || (e.pages ?? "first") === (first ? "first" : "rest")));
  const newPage = async () => {
    const p = doc.addPage([W, H]);
    const first = pages.length === 0;
    pages.push(p);
    for (const e of pageEls(first)) await drawEl(ctx, p, e, fields, e.x * ctx.sx, e.y * ctx.sy, extra);
    return p;
  };
  let page = await newPage();
  const table = els.find((e) => e.type === "table");
  const limit = H - t.bottom * ctx.sy;
  let end = 0;
  if (table) {
    const X = table.x * ctx.sx, TW = table.w * ctx.sx, size = (table.rowSize || 9.5) * ctx.fs;
    const cols = colsOf(table, TW);
    let y = table.y * ctx.sy;
    y += drawHeader(ctx, page, cols, X, y, TW, size);
    const rows = data.rows ?? [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r._group !== undefined) {
        const bh = size * 1.7;
        const next = rows[i + 1] && rows[i + 1]._group === undefined ? rowHeight(ctx, cols, rows[i + 1], size) : 0;
        if (y + bh + next > limit) { page = await newPage(); y = t.contTop * ctx.sy; y += drawHeader(ctx, page, cols, X, y, TW, size); }
        page.drawRectangle({ x: X, y: ctx.H - y - bh, width: TW, height: bh, color: hex(r._tone === "warn" ? "#fef3c7" : "#f0efed") });
        drawText(ctx, page, String(r._group), X + 6 * ctx.fs, y + (bh - size) / 2, TW - 12 * ctx.fs, bh, { size: size / ctx.fs, bold: true, upper: true });
        y += bh + 2 * ctx.fs;
        continue;
      }
      const rh = rowHeight(ctx, cols, r, size);
      if (y + rh > limit) { page = await newPage(); y = t.contTop * ctx.sy; y += drawHeader(ctx, page, cols, X, y, TW, size); }
      drawRow(ctx, page, cols, r, X, y, TW, size, rh);
      y += rh;
    }
    if (!rows.length) { drawText(ctx, page, "No lines.", X + 3, y + 6, TW, 20, { size: 9, color: "#57534e" }); y += 22 * ctx.fs; }
    end = y + 12 * ctx.sy;
  } else {
    end = 0;
  }
  // things placed after the table (totals, signatures…): move to a new page if they don't fit
  const after = els.filter((e) => e.type !== "table" && e.type !== "pagenum" && e.flow === "after");
  if (after.length) {
    const need = Math.max(...after.map((e) => (e.y + e.h) * ctx.sy));
    if (end + need > limit && end > t.contTop * ctx.sy + 1) { page = await newPage(); end = t.contTop * ctx.sy; }
    const ax = table ? table.x * ctx.sx : 0; // "after" items are placed relative to the table's left edge
    for (const e of after) await drawEl(ctx, page, e, fields, ax + e.x * ctx.sx, end + e.y * ctx.sy, extra);
  }
  // page numbers, once the count is known
  const nums = els.filter((e) => e.type === "pagenum");
  for (let i = 0; i < pages.length; i++)
    for (const e of nums) {
      const which = e.pages ?? "all";
      if (which === "first" && i > 0) continue;
      if (which === "rest" && i === 0) continue;
      await drawEl(ctx, pages[i], e, fields, e.x * ctx.sx, e.y * ctx.sy, { ...extra, page: String(i + 1), pages: String(pages.length) });
    }
  return pages;
}

/** A full document: one copy per entry in data.copies (e.g. Customer copy, Office copy), or one. */
export async function renderDoc(t: Template, data: DocData, meta: { title?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc);
  const copies = data.copies?.length ? data.copies : [""];
  for (const copy of copies) await layoutCopy(doc, f, t, data, { copy });
  if (meta.title) doc.setTitle(winAnsi(meta.title));
  doc.setCreator("DKaydent Wholesale");
  doc.setProducer("DKaydent Wholesale");
  return doc.save();
}

/** Labels: one page per label at the label's size, or laid out on letter/A4 paper with cut lines. */
export async function renderLabels(t: Template, labels: Record<string, unknown>[], sheet: LabelSheet, meta: { title?: string } = {}): Promise<Uint8Array> {
  const W = sheet.w * 72, H = sheet.h * 72;
  const one = await PDFDocument.create();
  const f = await fonts(one);
  for (const l of labels) await layoutCopy(one, f, t, { fields: l }, {}, { w: W, h: H });
  if (sheet.mode === "label" || !labels.length) {
    if (meta.title) one.setTitle(winAnsi(meta.title));
    return one.save();
  }
  const out = await PDFDocument.create();
  const paper = sheet.paper === "a4" ? { w: 595.28, h: 841.89 } : { w: 612, h: 792 };
  const M = 18;
  const across = Math.max(1, Math.floor((paper.w - 2 * M) / W)), down = Math.max(1, Math.floor((paper.h - 2 * M) / H));
  const embedded = await out.embedPdf(await one.save(), one.getPageIndices());
  let page: PDFPage | null = null;
  embedded.forEach((e, i) => {
    const k = i % (across * down);
    if (k === 0) page = out.addPage([paper.w, paper.h]);
    const cx = M + (k % across) * W, cy = paper.h - M - (Math.floor(k / across) + 1) * H;
    page!.drawPage(e, { x: cx, y: cy, width: W, height: H });
    page!.drawRectangle({ x: cx, y: cy, width: W, height: H, borderColor: rgb(0.62, 0.64, 0.68), borderWidth: 0.4, borderDashArray: [3, 3] });
  });
  if (meta.title) out.setTitle(winAnsi(meta.title));
  return out.save();
}

export type { Column };
