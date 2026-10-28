"use client";

import { useMemo, useState } from "react";
import { money, qty as fmtQty } from "@/lib/format";

export type CatalogItem = {
  unit_id: string;
  product_id: string;
  sku: string | null;
  name: string;
  kind: string | null;
  category: string | null;
  unit: string;
  factor: number;
  price: number;
  list_price?: number;
  special?: boolean;
  discount_pct?: number;
  available: number | null;
};

type Line = { item: CatalogItem; qty: number };

/** Browse items, build a cart, send it to a server action that works out the real prices. */
export function Cart({
  items,
  action,
  hidden,
  submitLabel,
  showStock = true,
  extra,
}: {
  items: CatalogItem[];
  action: (fd: FormData) => void | Promise<void>;
  hidden?: Record<string, string>;
  submitLabel: string;
  showStock?: boolean;
  extra?: (item: CatalogItem) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).sort(), [items]);
  const shown = items.filter(
    (i) =>
      (!cat || i.category === cat) &&
      (!q || `${i.name} ${i.sku ?? ""} ${i.kind ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  );
  const total = lines.reduce((n, l) => n + l.qty * l.item.price, 0);

  function add(item: CatalogItem) {
    setLines((ls) => {
      const have = ls.find((l) => l.item.unit_id === item.unit_id);
      return have ? ls.map((l) => (l === have ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { item, qty: 1 }];
    });
  }
  function setQty(id: string, n: number) {
    setLines((ls) => (n > 0 ? ls.map((l) => (l.item.unit_id === id ? { ...l, qty: n } : l)) : ls.filter((l) => l.item.unit_id !== id)));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="input min-w-48 flex-1" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" data-testid="cart-search" />
          <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2" data-testid="cart-items">
          {shown.length === 0 && <p className="card text-sm text-stone-500">No items match.</p>}
          {shown.map((i) => (
            <div key={i.unit_id} className="card flex flex-wrap items-center justify-between gap-3" data-item={i.unit_id}>
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-stone-500">
                  {[i.sku, i.kind, i.category].filter(Boolean).join(" · ")} · per {i.unit}
                  {showStock && i.available !== null && <> · {fmtQty(i.available)} available</>}
                </div>
                {extra?.(i)}
              </div>
              <div className="text-right">
                <div className="font-medium">{money(i.price)}</div>
                {i.list_price !== undefined && Number(i.list_price) !== Number(i.price) && (
                  <div className="text-xs text-stone-500">
                    <s>{money(i.list_price)}</s> {i.special ? "your price" : i.discount_pct ? `${i.discount_pct}% off` : ""}
                  </div>
                )}
              </div>
              <button type="button" className="btn" onClick={() => add(i)} disabled={showStock && i.available !== null && i.available <= 0}>
                {showStock && i.available !== null && i.available <= 0 ? "Out of stock" : "Add"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <form action={action} className="card h-fit space-y-3 lg:sticky lg:top-6" data-testid="cart">
        <h2 className="text-lg">Cart</h2>
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ unit_id: l.item.unit_id, qty: l.qty })))} />
        {lines.length === 0 && <p className="text-sm text-stone-500">Nothing yet. Add items from the list.</p>}
        {lines.map((l) => (
          <div key={l.item.unit_id} className="flex items-center gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate">{l.item.name}</div>
              <div className="text-xs text-stone-500">
                {money(l.item.price)} per {l.item.unit}
              </div>
            </div>
            <input
              type="number"
              min="0"
              step="1"
              className="input w-20"
              value={l.qty}
              aria-label={`Quantity of ${l.item.name}`}
              onChange={(e) => setQty(l.item.unit_id, Number(e.target.value))}
            />
          </div>
        ))}
        <div className="flex justify-between border-t border-stone-200 pt-3 text-sm">
          <span>Estimated total</span>
          <span className="font-medium" data-testid="cart-total">{money(total)}</span>
        </div>
        <textarea name="notes" className="input" rows={2} placeholder="Notes (optional)" maxLength={500} />
        <button className="btn-primary w-full" disabled={lines.length === 0}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
