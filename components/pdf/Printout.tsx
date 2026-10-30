"use client";

import { useEffect, useState } from "react";
import { renderDoc, renderLabels } from "@/lib/pdfdocs/render";
import type { DocData, Template } from "@/lib/pdfdocs/types";
import { readPrintSettings, type PrintSettings } from "@/lib/printSettings";
import { LabelSizeFields, ModeSwitch } from "../PrintSettingsForm";
import { PdfViewer } from "./PdfViewer";

/** A pull ticket, invoice or route sheet as a real PDF. */
export function DocPdf({ template, data, filename, title }: { template: Template; data: DocData; filename: string; title: string }) {
  return <PdfViewer build={() => renderDoc(template, data, { title })} buildKey={filename + JSON.stringify(data).length} filename={filename} />;
}

/** Labels as a PDF, sized for this computer's label printer (or laid out on paper), with the size and copies to hand. */
export function LabelsPdf({ template, labels, filename, initialCopies = 1, hideCopies, workerSrc }: { template: Template; labels: Record<string, unknown>[]; filename: string; initialCopies?: number; hideCopies?: boolean; workerSrc?: string }) {
  const [s, setS] = useState<PrintSettings | null>(null);
  const [copies, setCopies] = useState(initialCopies);
  useEffect(() => setS(readPrintSettings()), []);
  if (!s) return <div className="h-64" aria-busy="true" />;
  const all = labels.flatMap((l) => Array.from({ length: copies }, () => l));
  const key = `${s.mode}:${s.w}x${s.h}:${s.paper}:${copies}:${labels.length}`;
  return (
    <PdfViewer build={() => renderLabels(template, all, { mode: s.mode, w: s.w, h: s.h, paper: s.paper }, { title: filename })} buildKey={key} filename={filename} workerSrc={workerSrc}>
      <div className="space-y-3 border-t border-stone-200 pt-3">
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
          {!hideCopies && (
            <label className="block">
              <span className="label">Copies each</span>
              <select className="input w-24" value={copies} onChange={(e) => setCopies(Number(e.target.value))} aria-label="Copies each">
                {[1, 2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="text-xs text-stone-500" data-testid="print-summary">
          {s.mode === "label"
            ? `${all.length} label${all.length === 1 ? "" : "s"}, one per page at ${s.w} × ${s.h} in. Print on ${s.labelPrinter ? `“${s.labelPrinter}”` : "your label printer"} with the same label size and no scaling.`
            : `${all.length} label${all.length === 1 ? "" : "s"} on ${s.paper === "a4" ? "A4" : "letter"} paper; cut along the dashed lines. Print at 100% (no fit to page).`}{" "}
          Set defaults in Settings → Printing.
        </p>
      </div>
    </PdfViewer>
  );
}
