"use client";

import { useEffect, useMemo, useState } from "react";
import { ScanInput } from "./ScanInput";
import { SubmitButton } from "./SubmitButton";
import { ItemThumb } from "./ItemThumb";

export type CounterProduct = {
  id: string;
  sku: string;
  name: string;
  base_unit: string;
  image_path: string | null;
  category: string | null;
  onHand: number;
  avgCost: number | null;
  units: { id: string; name: string; factor: number }[];
};
type Customer = { id: string; name: string; tier_id: string | null };
type Tier = { id: string; markup_pct: number };
type Line = { key: string; product_id: string; unit_id: string; qty: number; unit_price: number; priceEdited: boolean };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function CounterRegister({
  products,
  lotCodes,
  customers,
  tiers,
  tierPrices,
  terminals,
  defaultMarkup,
  cardFee,
  action,
}: {
  products: CounterProduct[];
  lotCodes: Record<string, string>; // LOT CODE -> product id
  customers: Customer[];
  tiers: Tier[];
  tierPrices: Record<string, Record<string, number>>; // tier id -> unit id -> price
  terminals: { id: string; name: string; model: string }[];
  defaultMarkup: number;
  /** card processing fee %, added when paying by card */
  cardFee: number;
  action: (fd: FormData) => void;
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.toUpperCase(), p])), [products]);
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [tax, setTax] = useState(0);
  const [tendered, setTendered] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [browse, setBrowse] = useState(false);

  const tierOf = (cid: string) => {
    const c = customers.find((x) => x.id === cid);
    return c?.tier_id ? tiers.find((t) => t.id === c.tier_id) ?? null : null;
  };
  const priceFor = (p: CounterProduct, unitId: string, cid: string) => {
    const u = p.units.find((x) => x.id === unitId)!;
    const tier = tierOf(cid);
    const fixed = tier ? tierPrices[tier.id]?.[unitId] : undefined;
    if (fixed !== undefined) return fixed;
    const markup = tier ? Number(tier.markup_pct) : defaultMarkup;
    return p.avgCost !== null ? round2(p.avgCost * u.factor * (1 + markup / 100)) : 0;
  };

  const add = (p: CounterProduct, unitId?: string) => {
    setNote(null);
    setLines((ls) => {
      const unit = p.units.find((u) => u.id === unitId) ?? p.units[0];
      const i = ls.findIndex((l) => l.product_id === p.id && l.unit_id === unit.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: `${p.id}-${Date.now()}`, product_id: p.id, unit_id: unit.id, qty: 1, unit_price: priceFor(p, unit.id, customerId), priceEdited: false }];
    });
    setSearch("");
  };
  const onCode = (code: string) => {
    const c = code.trim().toUpperCase();
    const p = bySku.get(c) ?? (lotCodes[c] ? byId.get(lotCodes[c]) : undefined);
    if (p) add(p);
    else setNote(`Nothing matches “${code}”. Scan a product SKU or lot label.`);
  };
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const changeCustomer = (cid: string) => {
    setCustomerId(cid);
    setLines((ls) => ls.map((l) => (l.priceEdited ? l : { ...l, unit_price: priceFor(byId.get(l.product_id)!, l.unit_id, cid) })));
  };

  const matches = useMemo(() => {
    const f = search.trim().toLowerCase();
    if (!f) return [];
    return products.filter((p) => p.name.toLowerCase().includes(f) || p.sku.toLowerCase().includes(f)).slice(0, 8);
  }, [search, products]);

  const subtotal = round2(lines.reduce((t, l) => t + l.qty * l.unit_price, 0));
  const taxAmt = round2(subtotal * ((tax || 0) / 100));
  const total = round2(subtotal + taxAmt);
  // paying by card adds the processing fee on subtotal + tax (same rounding as the invoice)
  const feeAmt = round2(total * ((cardFee || 0) / 100));
  const cardTotal = round2(total + feeAmt);
  const change = tendered ? round2(Number(tendered) - total) : null;
  const shortages = lines.filter((l) => {
    const p = byId.get(l.product_id)!;
    const need = lines.filter((x) => x.product_id === l.product_id).reduce((t, x) => t + x.qty * (p.units.find((u) => u.id === x.unit_id)?.factor ?? 1), 0);
    return need > p.onHand;
  });
  const cart = JSON.stringify(lines.map(({ product_id, unit_id, qty, unit_price }) => ({ product_id, unit_id, qty, unit_price })));
  const ready = lines.length > 0 && lines.every((l) => l.qty > 0) && shortages.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <div className="card space-y-3">
          <ScanInput onCode={onCode} label="Scan" placeholder="Scan a SKU or lot label, then Enter" autoFocus />
          <div className="relative">
            <input
              className="input"
              placeholder="Or search items by name or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search items"
            />
            {matches.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => add(p)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50">
                      <ItemThumb name={p.name} path={p.image_path} size={28} />
                      <span className="flex-1">{p.name}</span>
                      <span className={`text-xs ${p.onHand > 0 ? "text-stone-500" : "text-red-700"}`}>
                        {p.onHand} {p.base_unit}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="btn w-full" onClick={() => setBrowse(true)} data-testid="open-inventory" aria-haspopup="dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Inventory
          </button>
          {note && <p className="text-sm text-amber-800">{note}</p>}
        </div>
        <InventoryBrowser
          open={browse}
          onClose={() => setBrowse(false)}
          products={products}
          lines={lines}
          priceOf={(p, unitId) => priceFor(p, unitId, customerId)}
          onAdd={add}
        />

        {lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-10 text-center text-sm text-stone-500">
            Scan, search or open Inventory to add items.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = byId.get(l.product_id)!;
                  const short = shortages.some((s) => s.key === l.key);
                  return (
                    <tr key={l.key} className={short ? "bg-red-50/60" : ""}>
                      <td>
                        <div className="flex items-center gap-2">
                          <ItemThumb name={p.name} path={p.image_path} size={32} />
                          <div>
                            {p.name}
                            <div className={`text-xs ${short ? "text-red-700" : "text-stone-500"}`}>
                              {short ? `Only ${p.onHand} ${p.base_unit} on hand` : p.sku}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          className="input w-auto"
                          value={l.unit_id}
                          aria-label={`Unit for ${p.name}`}
                          onChange={(e) => update(l.key, { unit_id: e.target.value, unit_price: l.priceEdited ? l.unit_price : priceFor(p, e.target.value, customerId) })}
                        >
                          {p.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                              {u.factor !== 1 ? ` (${u.factor})` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="input w-20 text-right"
                          value={l.qty}
                          aria-label={`Quantity of ${p.name}`}
                          onChange={(e) => update(l.key, { qty: Number(e.target.value) })}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input w-24 text-right"
                          value={l.unit_price}
                          aria-label={`Price of ${p.name}`}
                          onChange={(e) => update(l.key, { unit_price: Number(e.target.value), priceEdited: true })}
                        />
                      </td>
                      <td className="num">{money(l.qty * l.unit_price)}</td>
                      <td className="text-right">
                        <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${p.name}`}>
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form action={action} className="card h-fit space-y-4 lg:sticky lg:top-4">
        <input type="hidden" name="cart" value={cart} />
        <label className="block">
          <span className="label">Customer</span>
          <select name="customer_id" className="input" value={customerId} onChange={(e) => changeCustomer(e.target.value)}>
            <option value="">Walk-in</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Sales tax %</span>
          <input name="tax_rate" type="number" min="0" step="0.001" className="input" value={tax} onChange={(e) => setTax(Number(e.target.value))} />
        </label>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Subtotal</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Tax</dt>
            <dd className="tabular-nums">{money(taxAmt)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-lg font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums" data-testid="counter-total">
              {money(total)}
            </dd>
          </div>
          {cardFee > 0 && terminals.length > 0 && (
            <div className="space-y-0.5 rounded-md bg-stone-50 px-2 py-1.5 text-xs text-stone-600" data-testid="counter-card-fee">
              <div className="flex justify-between">
                <dt>Card processing fee ({cardFee}%)</dt>
                <dd className="tabular-nums">{money(feeAmt)}</dd>
              </div>
              <div className="flex justify-between font-medium text-stone-800">
                <dt>Total by card</dt>
                <dd className="tabular-nums">{money(cardTotal)}</dd>
              </div>
            </div>
          )}
        </dl>

        <fieldset disabled={!ready} className="space-y-3">
          {terminals.length > 0 && (
            <div className="space-y-2 rounded-lg border border-stone-200 p-3">
              <select name="terminal_id" className="input" aria-label="Terminal">
                {terminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.model})
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="tip_entry" /> Ask for a tip
              </label>
              <SubmitButton name="method" value="terminal" className="btn btn-primary w-full" pendingText="Sending to terminal…">
                Charge {money(cardTotal)} on terminal
              </SubmitButton>
            </div>
          )}
          <div className="space-y-2 rounded-lg border border-stone-200 p-3">
            <div className="flex items-center gap-2">
              <input
                name="tendered"
                type="number"
                min="0"
                step="0.01"
                className="input"
                placeholder="Cash given"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                aria-label="Cash given"
              />
              <SubmitButton name="method" value="cash" className="btn whitespace-nowrap" pendingText="…">
                Cash
              </SubmitButton>
            </div>
            {change !== null && change >= 0 && <p className="text-sm">Change: <b>{money(change)}</b></p>}
            {change !== null && change < 0 && <p className="text-sm text-red-700">{money(-change)} short</p>}
          </div>
          <div className="flex items-center gap-2">
            <input name="reference" className="input" placeholder="Check # / note" aria-label="Reference" />
            <SubmitButton name="method" value="check" className="btn" pendingText="…">
              Check
            </SubmitButton>
            <SubmitButton name="method" value="other" className="btn" pendingText="…">
              Other
            </SubmitButton>
          </div>
        </fieldset>
        {shortages.length > 0 && <p className="text-sm text-red-700">Not enough stock for a line. Lower the quantity to continue.</p>}
        <p className="text-xs text-stone-500">Stock is taken (oldest lots first) only once the payment goes through.</p>
      </form>
    </div>
  );
}

/** Shop the stock without typing: category tabs, item tiles, a button per unit. Stays open so several things can be added. */
function InventoryBrowser({
  open,
  onClose,
  products,
  lines,
  priceOf,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  products: CounterProduct[];
  lines: Line[];
  priceOf: (p: CounterProduct, unitId: string) => number;
  onAdd: (p: CounterProduct, unitId: string) => void;
}) {
  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.category || "Other"))).sort((a, b) => a.localeCompare(b)), [products]);
  const [cat, setCat] = useState<string>("");
  const tab = cat && cats.includes(cat) ? cat : cats[0] ?? "";
  const shown = products.filter((p) => (p.category || "Other") === tab).sort((a, b) => Number(b.onHand > 0) - Number(a.onHand > 0) || a.name.localeCompare(b.name));
  const inSale = (p: CounterProduct) => lines.filter((l) => l.product_id === p.id).reduce((t, l) => t + l.qty * (p.units.find((u) => u.id === l.unit_id)?.factor ?? 1), 0);
  const count = lines.reduce((t, l) => t + (l.qty > 0 ? 1 : 0), 0);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="Inventory"
        aria-hidden={!open}
        inert={!open}
        data-testid="inventory-browser"
        className={`fixed top-0 right-0 bottom-0 z-50 flex w-[min(760px,100vw)] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <span className="font-semibold">Inventory</span>
          <span className="flex-1 text-sm text-stone-500">{count ? `${count} line${count === 1 ? "" : "s"} in this sale` : "Tap a unit to add it to the sale"}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose} data-testid="inventory-done">
            Done
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-b border-stone-200 px-4 py-2" role="tablist" aria-label="Categories">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === tab}
              onClick={() => setCat(c)}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap ${c === tab ? "border-brand-700 bg-brand-700 text-white" : "border-stone-200 bg-white hover:bg-stone-50"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 overflow-y-auto p-4" role="tabpanel">
          {shown.map((p) => {
            const out = p.onHand <= 0;
            const have = inSale(p);
            const left = p.onHand - have;
            return (
              <div key={p.id} className={`card space-y-2 p-3 ${out ? "opacity-50" : ""}`} data-inv-item={p.id} aria-disabled={out}>
                <div className="flex items-start gap-2">
                  <ItemThumb name={p.name} path={p.image_path} size={44} />
                  <div className="min-w-0">
                    <div className="text-sm leading-tight font-medium">{p.name}</div>
                    <div className={`text-xs ${out ? "text-red-700" : "text-stone-500"}`}>
                      {out ? "Out of stock" : `${left} ${p.base_unit} left${have ? ` · ${have} in sale` : ""}`}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.units.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="btn btn-sm"
                      disabled={out || u.factor > left}
                      onClick={() => onAdd(p, u.id)}
                      data-testid="inv-add"
                      aria-label={`Add 1 ${u.name} of ${p.name}`}
                    >
                      + {u.name} <span className="tabular-nums text-stone-500">{money(priceOf(p, u.id))}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
