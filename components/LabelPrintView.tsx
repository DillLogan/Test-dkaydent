"use client";

import { useEffect, useState } from "react";
import { PAPERS, readPrintSettings, type PrintSettings } from "@/lib/printSettings";
import { LabelSizeFields, ModeSwitch } from "./PrintSettingsForm";

export type PrintLabel = { key: string; code: string; title: string; sku: string; lines: string[]; svg: string | null; short?: string };

const MARGIN = 0.25; // regular-printer page margin, inches

/** One label drawn at its real size; text and barcode scale with the label. */
function LabelBox({ l, w, h, cut }: { l: PrintLabel; w: number; h: number; cut: boolean }) {
  const base = Math.min(h, w * 0.55);
  const pad = Math.max(0.04, Math.min(0.12, h * 0.06));
  const tall = h >= 1.6;
  const lines = h < 1.05 ? [] : tall ? l.lines : h < 1.4 && l.short ? [l.short] : l.lines.slice(0, h < 1.4 ? 1 : 2);
  const barH = Math.min(tall ? h * 0.3 : h * (lines.length ? 0.34 : 0.42), 1.4);
  return (
    <div
      className={`dk-label flex flex-col overflow-hidden bg-[#ffffff] text-[#111111] ${cut ? "outline-dashed outline-[0.5pt] outline-[#9ca3af]" : "rounded-sm border border-[#d6d3d1] print:rounded-none print:border-0"}`}
      style={{ width: `${w}in`, height: `${h}in`, padding: `${pad}in`, gap: `${pad * 0.5}in` }}
    >
      <div className="flex items-baseline justify-between gap-2" style={{ lineHeight: 1.1 }}>
        <span
          className="font-semibold"
          style={{
            fontSize: `${base * (l.title.length > 22 ? 0.125 : 0.15)}in`,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: h < 1.05 ? 1 : 2,
            overflow: "hidden",
          }}
        >
          {l.title}
        </span>
        {w >= 1.8 && l.sku !== l.code && (
          <span className="shrink-0 font-mono text-[#555555]" style={{ fontSize: `${base * 0.09}in` }}>
            {l.sku}
          </span>
        )}
      </div>
      {l.svg ? (
        <span className="block w-full" style={{ height: `${barH}in` }} aria-label={`Barcode ${l.code}`} dangerouslySetInnerHTML={{ __html: l.svg }} />
      ) : (
        <span className="text-[#b91c1c]" style={{ fontSize: `${base * 0.1}in` }}>
          Can&apos;t encode {l.code}
        </span>
      )}
      <div className="text-center font-mono font-bold tracking-wider" style={{ fontSize: `${base * 0.12}in`, lineHeight: 1 }}>
        {l.code}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="truncate text-[#444444]" style={{ fontSize: `${base * 0.095}in`, lineHeight: 1.15 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

export function LabelPrintView({ labels, initialCopies, hideCopies }: { labels: PrintLabel[]; initialCopies: number; hideCopies?: boolean }) {
  const [s, setS] = useState<PrintSettings | null>(null);
  const [copies, setCopies] = useState(initialCopies);
  useEffect(() => setS(readPrintSettings()), []);
  if (!s) return <div className="h-64" aria-busy="true" />;

  const all = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.key}-${i}` })));
  const paper = PAPERS[s.paper];
  const fitsPaper = s.w <= paper.w - 2 * MARGIN && s.h <= paper.h - 2 * MARGIN;
  const pageCss =
    s.mode === "label"
      ? `@page { size: ${s.w}in ${s.h}in; margin: 0; } @media print { html, body, .min-h-screen { min-height: 0 !important; height: auto !important; } main, main > div { padding: 0 !important; margin: 0 !important; } .dk-sheet { display: block !important; line-height: 0; } .dk-label { line-height: normal; break-after: page; page-break-after: always; } .dk-label:last-child { break-after: auto; page-break-after: auto; } }`
      : `@page { size: ${s.paper === "a4" ? "A4" : "letter"}; margin: ${MARGIN}in; } @media print { .dk-sheet { gap: 0 !important; } }`;
  const perRow = Math.max(1, Math.floor((paper.w - 2 * MARGIN) / s.w));
  const perCol = Math.max(1, Math.floor((paper.h - 2 * MARGIN) / s.h));

  return (
    <>
      <style>{`${pageCss} @media print { html, body { background: #fff !important; } .page-in, .dk-sheet, .dk-label { animation: none !important; transform: none !important; } }`}</style>
      <div className="card mb-4 space-y-3 print:hidden">
        <ModeSwitch value={s} onChange={setS} />
        <div className="flex flex-wrap items-end gap-3">
          <LabelSizeFields value={s} onChange={setS} />
          {s.mode === "regular" && (
            <label className="block">
              <span className="label">Paper</span>
              <select className="input w-auto" value={s.paper} onChange={(e) => setS({ ...s, paper: e.target.value === "a4" ? "a4" : "letter" })}>
                <option value="letter">Letter</option>
                <option value="a4">A4</option>
              </select>
            </label>
          )}
          {!hideCopies && (<label className="block">
            <span className="label">Copies each</span>
            <select className="input w-24" value={copies} onChange={(e) => setCopies(Number(e.target.value))} aria-label="Copies each">
              {[1, 2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>)}
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!all.length || (s.mode === "regular" && !fitsPaper)}>
            Print {all.length} label{all.length === 1 ? "" : "s"}
          </button>
        </div>
        <p className="text-xs text-stone-500" data-testid="print-summary">
          {s.mode === "label"
            ? `Label printer: ${all.length} page${all.length === 1 ? "" : "s"} of ${s.w} × ${s.h} in, no margins. In the print dialog choose ${s.labelPrinter ? `“${s.labelPrinter}”` : "your label printer"} and the same label size.`
            : fitsPaper
              ? `Regular printer: ${perRow * perCol} labels per ${s.paper === "a4" ? "A4" : "letter"} page (${perRow} across × ${perCol} down), cut along the dashed lines.${s.regularPrinter ? ` In the print dialog choose “${s.regularPrinter}”.` : ""} ${Math.ceil(all.length / (perRow * perCol))} page${Math.ceil(all.length / (perRow * perCol)) === 1 ? "" : "s"}.`
              : `A ${s.w} × ${s.h} in label doesn't fit on ${s.paper === "a4" ? "A4" : "letter"} paper. Choose a smaller size.`}{" "}
          Changes here apply to this print only; set defaults in Settings → Printing.
        </p>
      </div>

      {s.mode === "regular" ? (
        <div className="overflow-x-auto print:overflow-visible">
          <div
            className="mx-auto bg-[#ffffff] shadow-sm print:mx-0 print:shadow-none"
            style={{ width: `${paper.w}in`, padding: `${MARGIN}in` }}
            data-testid="paper-preview"
          >
            <div className="dk-sheet flex flex-wrap content-start" style={{ width: `${perRow * s.w}in` }}>
              {all.map((l) => (
                <LabelBox key={l.key} l={l} w={s.w} h={s.h} cut />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="dk-sheet flex flex-wrap gap-3 print:gap-0">
          {all.map((l) => (
            <LabelBox key={l.key} l={l} w={s.w} h={s.h} cut={false} />
          ))}
        </div>
      )}
    </>
  );
}
