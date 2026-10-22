"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PRINT, LABEL_SIZES, PAPERS, readPrintSettings, savePrintSettings, withSize, type PrintSettings } from "@/lib/printSettings";

/** Size picker shared by Settings and the print screen. */
export function LabelSizeFields({ value, onChange }: { value: PrintSettings; onChange: (s: PrintSettings) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="label">Label size</span>
        <select className="input w-auto" value={value.size} onChange={(e) => onChange(withSize(value, e.target.value))} aria-label="Label size">
          {LABEL_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value="custom">Custom size…</option>
        </select>
      </label>
      {value.size === "custom" && (
        <>
          <label className="block">
            <span className="label">Width (in)</span>
            <input
              type="number"
              min="0.5"
              max="8"
              step="0.05"
              className="input w-24"
              value={value.w}
              onChange={(e) => onChange(withSize(value, "custom", Number(e.target.value), value.h))}
              aria-label="Label width in inches"
            />
          </label>
          <label className="block">
            <span className="label">Height (in)</span>
            <input
              type="number"
              min="0.5"
              max="8"
              step="0.05"
              className="input w-24"
              value={value.h}
              onChange={(e) => onChange(withSize(value, "custom", value.w, Number(e.target.value)))}
              aria-label="Label height in inches"
            />
          </label>
        </>
      )}
    </div>
  );
}

export function ModeSwitch({ value, onChange }: { value: PrintSettings; onChange: (s: PrintSettings) => void }) {
  const opt = (mode: "label" | "regular", title: string, help: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value.mode === mode}
      onClick={() => onChange({ ...value, mode })}
      className={`lift rounded-lg border p-3 text-left ${value.mode === mode ? "border-brand-700 bg-brand-50" : "border-stone-200 bg-white"}`}
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs text-stone-500">{help}</div>
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Print mode" className="grid gap-2 sm:grid-cols-2">
      {opt("label", "Label printer", "One label per page at the label's exact size (Zebra, Rollo, DYMO, Brother…)")}
      {opt("regular", "Regular printer", "Labels laid out on letter or A4 paper with cut lines, for a desktop printer")}
    </div>
  );
}

export function PrintSettingsForm() {
  const [s, setS] = useState<PrintSettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setS(readPrintSettings()), []);
  if (!s) return <div className="h-40" />;
  const update = (next: PrintSettings) => {
    setS(next);
    savePrintSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="card space-y-4">
      <div>
        <div className="label">Default print mode</div>
        <ModeSwitch value={s} onChange={update} />
      </div>
      <div>
        <LabelSizeFields value={s} onChange={update} />
        <p className="mt-1 text-xs text-stone-500">Set this to the labels loaded in your label printer. You can change it for any single print job.</p>
      </div>
      <label className="block">
        <span className="label">Regular printer paper</span>
        <select className="input w-auto" value={s.paper} onChange={(e) => update({ ...s, paper: e.target.value === "a4" ? "a4" : "letter" })}>
          {Object.entries(PAPERS).map(([k, p]) => (
            <option key={k} value={k}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <a href="/labels?test=1" className="btn">
          Print a test label
        </a>
        <button type="button" className="btn" onClick={() => update(DEFAULT_PRINT)}>
          Reset to defaults
        </button>
        <span className="text-sm text-brand-700" aria-live="polite">
          {saved ? "Saved on this computer" : ""}
        </span>
      </div>
      <p className="text-xs text-stone-500">
        Printing uses your computer&apos;s print dialog, so any installed printer works. For a label printer, pick it in the dialog and choose the
        same label size in its settings (on Mac, Paper Size; on Windows, the printer&apos;s Preferences). Set margins to None if asked.
      </p>
    </div>
  );
}
