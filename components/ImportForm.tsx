"use client";

import { useState } from "react";
import { parseCSVObjects } from "@/lib/csv";
import { IMPORT_COLUMNS, validate, type Entity, type Validated } from "@/lib/importSpec";
import { SubmitButton } from "./SubmitButton";

export function ImportForm({
  entity,
  existing,
  tiers,
  action,
}: {
  entity: Entity;
  existing: string[];
  tiers: Record<string, string>;
  action: (fd: FormData) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<Validated[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);

  const cols = IMPORT_COLUMNS[entity];
  const known = new Set(cols.map((c) => c.key));
  // Columns that exports include but import ignores
  const ignorable = new Set(["on_hand_base", "avg_cost_base", "value", "id", "created_at"]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const { headers, rows } = parseCSVObjects(text);
    setFileName(file.name);
    setRows(rows);
    setUnknown(headers.filter((h) => !known.has(h) && !ignorable.has(h)));
    setMissing(cols.filter((c) => c.required && !headers.includes(c.key)).map((c) => c.key));
    setResults(validate(entity, rows, new Set(existing), tiers));
  }

  const errorCount = results.filter((r) => r.errors.length).length;
  const creates = results.filter((r) => !r.errors.length && r.action === "create").length;
  const updates = results.filter((r) => !r.errors.length && r.action === "update").length;
  const blocked = !rows.length || errorCount > 0 || missing.length > 0;
  const keyCol = entity === "products" ? "sku" : "name";

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-primary cursor-pointer">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                // Clear so choosing the same (fixed) file again re-reads it
                e.target.value = "";
              }}
            />
          </label>
          <a className="btn" href={`/export/template-${entity}`}>
            Download template
          </a>
          <a className="btn" href={`/export/${entity}`}>
            Export current {entity}
          </a>
          {fileName && <span className="text-sm text-stone-600">{fileName}</span>}
        </div>
        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer">Columns</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {cols.map((c) => (
              <li key={c.key}>
                <code className="font-mono text-xs">{c.key}</code>
                {c.required && <span className="text-red-700">*</span>} {c.help && <span className="text-stone-500">— {c.help}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Rows whose {keyCol} already exists update that record; new ones are created. Nothing is deleted.
            {entity === "products" && " Pack units are added if missing; existing unit sizes are never changed, and a product's base unit can't change after it's created."}
          </p>
        </details>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">{creates} new</span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">{updates} updates</span>
            <span className={`rounded-full px-3 py-1 ${errorCount ? "bg-red-50 text-red-800" : "bg-stone-100 text-stone-600"}`}>
              {errorCount} with errors
            </span>
          </div>
          {missing.length > 0 && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Missing required column{missing.length > 1 ? "s" : ""}: {missing.join(", ")}
            </div>
          )}
          {unknown.length > 0 && (
            <p className="text-sm text-amber-800">Ignoring unrecognized columns: {unknown.join(", ")}</p>
          )}

          <div className="table-wrap max-h-[28rem] overflow-y-auto">
            <table className="table">
              <thead className="sticky top-0">
                <tr>
                  <th>Row</th>
                  <th>Result</th>
                  <th>{keyCol}</th>
                  {entity === "products" && <th>name</th>}
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 500).map((r) => (
                  <tr key={r.row} className={r.errors.length ? "bg-red-50/50" : ""}>
                    <td className="num">{r.row}</td>
                    <td>
                      {r.errors.length ? (
                        <span className="text-red-700">Error</span>
                      ) : r.action === "create" ? (
                        <span className="text-brand-700">New</span>
                      ) : (
                        <span className="text-blue-700">Update</span>
                      )}
                    </td>
                    <td className="font-mono text-xs">{entity === "products" ? r.record.sku : r.record.name}</td>
                    {entity === "products" && <td>{r.record.name}</td>}
                    <td className="text-sm text-red-700">{r.errors.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {results.length > 500 && <p className="text-xs text-stone-500">Showing the first 500 of {results.length} rows.</p>}

          <form action={action} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="rows" value={JSON.stringify(rows)} />
            <SubmitButton pendingText="Importing…">
              Import {creates + updates} {entity}
            </SubmitButton>
            {blocked && <span className="text-sm text-red-700">Fix the errors in your file and choose it again.</span>}
          </form>
        </>
      )}
    </div>
  );
}
