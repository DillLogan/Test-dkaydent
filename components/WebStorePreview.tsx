"use client";

import { useState, useTransition } from "react";

type Res = { error?: string; inventory?: { rows: { sku: string; qty: number }[]; problems: string[] }; orders?: { orders: any[]; problems: string[] } };

/** Paste a sample of what the website sends and see how it will be read. Changes nothing. */
export function WebStorePreview({ preview }: { preview: (kind: "inventory" | "orders", sample: string) => Promise<Res> }) {
  const [kind, setKind] = useState<"inventory" | "orders">("inventory");
  const [sample, setSample] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [pending, start] = useTransition();
  const problems = res?.inventory?.problems ?? res?.orders?.problems ?? [];
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="label">Sample of</span>
          <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="inventory">Inventory</option>
            <option value="orders">Orders</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={!sample.trim() || pending} onClick={() => start(async () => setRes(await preview(kind, sample)))}>
          {pending ? "Reading…" : "Preview"}
        </button>
      </div>
      <label className="block">
        <span className="label">Paste the website&apos;s JSON</span>
        <textarea
          className="input min-h-36 font-mono text-xs"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder='{"items":[{"sku":"RO-FRE-60","quantity":250}]}'
          spellCheck={false}
        />
      </label>
      {res?.error && (
        <p role="alert" className="text-sm text-red-700">
          {res.error}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-800">
          {problems.slice(0, 8).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {res?.inventory && res.inventory.rows.length > 0 && (
        <div className="table-wrap" data-testid="preview-result">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">In stock on the website</th>
              </tr>
            </thead>
            <tbody>
              {res.inventory.rows.slice(0, 50).map((r, i) => (
                <tr key={i}>
                  <td>{r.sku}</td>
                  <td className="num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res?.orders && res.orders.orders.length > 0 && (
        <div className="space-y-2" data-testid="preview-result">
          {res.orders.orders.slice(0, 10).map((o) => (
            <div key={o.external_id} className="rounded-xl border border-stone-200 p-3 text-sm">
              <div className="font-medium">
                Order {o.number || o.external_id}
                {o.cancelled && <span className="ml-2 text-red-700">cancelled</span>}
              </div>
              <div className="text-xs text-stone-500">
                {[o.name, o.email, o.phone].filter(Boolean).join(" · ") || "No customer details"}
                {o.ship_date ? ` · for ${o.ship_date}` : ""}
              </div>
              <ul className="mt-1 text-sm">
                {o.lines.map((l: any, i: number) => (
                  <li key={i}>
                    {l.qty} × {l.sku}
                    {l.price !== undefined ? ` at ${l.price}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
