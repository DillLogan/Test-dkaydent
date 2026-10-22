"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { parseCSV } from "@/lib/csv";
import { normalizeHeader, STOCK_COLUMNS, validateStockRows, type KnownItem } from "@/lib/stockBatch";
import type { CategoryRule } from "@/lib/categorize";
import { SubmitButton } from "./SubmitButton";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export function StockBatchForm({
  items,
  locations,
  rules,
  canCreate,
  defaultReference,
  action,
}: {
  items: KnownItem[];
  locations: string[];
  rules: CategoryRule[];
  canCreate: boolean;
  defaultReference: string;
  action: (fd: FormData) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [defaultLocation, setDefaultLocation] = useState(locations.find((l) => /receiv|dock/i.test(l)) ?? locations[0] ?? "");
  const [reference, setReference] = useState(defaultReference);

  const results = useMemo(
    () => validateStockRows(raw, { items, locations, rules, defaultLocation, canCreate }),
    [raw, items, locations, rules, defaultLocation, canCreate],
  );
  const errors = results.filter((r) => r.errors.length).length;
  const newItems = new Set(results.filter((r) => r.isNew).map((r) => r.sku)).size;
  const value = results.reduce((t, r) => t + (r.errors.length ? 0 : r.qty * r.unitCost), 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, { n: number; auto: number }>();
    for (const r of results) {
      const k = r.category ?? "Uncategorized";
      const x = m.get(k) ?? { n: 0, auto: 0 };
      x.n++;
      if (r.categorySource === "rules") x.auto++;
      m.set(k, x);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [results]);

  async function onFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    const [head, ...body] = parseCSV(text);
    if (!head) return;
    const headers = head.map(normalizeHeader);
    const known = new Set(STOCK_COLUMNS.map((c) => c.key));
    setUnknown(headers.filter((h) => h && !known.has(h)));
    setRaw(body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))));
    setFileName(file.name);
  }

  const missing = raw.length ? STOCK_COLUMNS.filter((c) => c.required && !(c.key in (raw[0] ?? {}))).map((c) => c.key) : [];

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <span className="label">Default location</span>
            <select className="input" value={defaultLocation} onChange={(e) => setDefaultLocation(e.target.value)}>
              {locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">Used for rows with no location</span>
          </label>
          <label className="sm:col-span-2">
            <span className="label">Batch reference</span>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
            <span className="mt-1 block text-xs text-stone-500">Shown in the movement log for every lot in this batch</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn btn-primary cursor-pointer">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <a className="btn" href="/export/template-stock">
            Download template
          </a>
          <Link className="btn" href="/products/categories">
            Category rules
          </Link>
          {fileName && <span className="text-sm text-stone-600">{fileName}</span>}
        </div>
        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer">Columns</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {STOCK_COLUMNS.map((c) => (
              <li key={c.key}>
                <code className="font-mono text-xs">{c.key}</code>
                {c.required && <span className="text-red-700">*</span>} <span className="text-stone-500">— {c.help}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Common headings like Quantity, Cost, Item and Expiry are recognized too. Each row becomes its own lot. The whole batch is saved together,
            or not at all.
          </p>
        </details>
      </div>

      {raw.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">{results.length - errors} lots ready</span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">{newItems} new items</span>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-700">{money(value)} at cost</span>
            <span className={`rounded-full px-3 py-1 ${errors ? "bg-red-50 text-red-800" : "bg-stone-100 text-stone-600"}`}>{errors} with errors</span>
          </div>
          {missing.length > 0 && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Missing required column{missing.length > 1 ? "s" : ""}: {missing.join(", ")}
            </div>
          )}
          {unknown.length > 0 && <p className="text-sm text-amber-800">Ignoring unrecognized columns: {unknown.join(", ")}</p>}

          <div className="card">
            <div className="label">Sorted into categories</div>
            <div className="flex flex-wrap gap-2">
              {byCategory.map(([c, x]) => (
                <span key={c} className={`rounded-full border px-2.5 py-0.5 text-xs ${c === "Uncategorized" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-200"}`}>
                  {c} · {x.n}
                  {x.auto > 0 && <span className="text-stone-500"> ({x.auto} auto)</span>}
                </span>
              ))}
            </div>
          </div>

          <div className="table-wrap max-h-[30rem] overflow-y-auto">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Row</th>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num">Qty</th>
                  <th className="num">Cost</th>
                  <th>Location</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 500).map((r) => (
                  <tr key={r.row} className={r.errors.length ? "bg-red-50/60" : ""}>
                    <td className="num">{r.row}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span>{r.name || "—"}</span>
                        {r.isNew && <span className="rounded-full bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">NEW</span>}
                      </div>
                      <div className="text-xs text-stone-500 tabular-nums">{r.sku}</div>
                    </td>
                    <td>
                      {r.category ?? <span className="text-amber-700">Uncategorized</span>}
                      {r.categorySource === "rules" && <span className="ml-1 rounded-full bg-brand-50 px-1.5 text-[11px] font-medium text-brand-700">auto</span>}
                    </td>
                    <td className="num">
                      {r.qty || "—"} {r.unit}
                    </td>
                    <td className="num">{Number.isFinite(r.unitCost) ? money(r.unitCost) : "—"}</td>
                    <td>{r.location || "—"}</td>
                    <td className="text-sm text-red-700">{r.errors.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={action} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="rows" value={JSON.stringify(raw)} />
            <input type="hidden" name="default_location" value={defaultLocation} />
            <input type="hidden" name="reference" value={reference} />
            <SubmitButton pendingText="Receiving…">
              Receive {results.length} lots into inventory
            </SubmitButton>
            {(errors > 0 || missing.length > 0) && <span className="text-sm text-red-700">Fix the errors in your file and choose it again.</span>}
          </form>
        </>
      )}
    </div>
  );
}
