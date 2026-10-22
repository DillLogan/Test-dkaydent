"use client";

import { useMemo, useState } from "react";
import { parseCSV } from "@/lib/csv";
import { groupTransactions, mapHeader, type SyncTxn } from "@/lib/terminalSync";
import { SubmitButton } from "./SubmitButton";

type Product = { id: string; sku: string; name: string; units: { id: string; name: string; factor: number }[] };
type Choice = { product_id: string; unit_id: string; source: "saved" | "sku" | "name" | "picked" };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export function TerminalSyncForm({
  products,
  savedMap,
  openRefs,
  knownTxnIds,
  action,
}: {
  products: Product[];
  savedMap: Record<string, { product_id: string; unit_id: string }>;
  openRefs: string[]; // open invoice + order numbers (upper case)
  knownTxnIds: string[]; // already synced
  action: (fd: FormData) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [txns, setTxns] = useState<SyncTxn[]>([]);
  const [unknownCols, setUnknownCols] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, Choice>>({});
  const [tax, setTax] = useState(0);
  const known = useMemo(() => new Set(knownTxnIds), [knownTxnIds]);
  const refs = useMemo(() => new Set(openRefs), [openRefs]);
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.toLowerCase(), p])), [products]);
  const byName = useMemo(() => new Map(products.map((p) => [p.name.toLowerCase(), p])), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function onFile(file?: File) {
    if (!file) return;
    const [head, ...body] = parseCSV(await file.text());
    if (!head) return;
    const keys = head.map(mapHeader);
    setUnknownCols(head.filter((_, i) => !keys[i]));
    const records = body
      .filter((r) => r.some((c) => c.trim()))
      .map((r) => Object.fromEntries(keys.map((k, i) => [k ?? `_${i}`, (r[i] ?? "").trim()])));
    setTxns(groupTransactions(records));
    setPicked({});
    setFileName(file.name);
  }

  // automatic matches for each distinct item
  const auto = useMemo(() => {
    const m: Record<string, Choice | null> = {};
    for (const t of txns)
      for (const it of t.items) {
        if (it.key in m) continue;
        const saved = savedMap[it.key];
        if (saved) m[it.key] = { ...saved, source: "saved" };
        else {
          const p = (it.sku && bySku.get(it.sku.toLowerCase())) || (it.name && byName.get(it.name.toLowerCase()));
          m[it.key] = p ? { product_id: p.id, unit_id: p.units[0].id, source: it.sku && bySku.has(it.sku.toLowerCase()) ? "sku" : "name" } : null;
        }
      }
    return m;
  }, [txns, savedMap, bySku, byName]);
  const choice = (key: string) => picked[key] ?? auto[key] ?? null;
  const items = useMemo(() => {
    const seen = new Map<string, { key: string; name: string; sku: string; count: number }>();
    for (const t of txns) for (const it of t.items) {
      const x = seen.get(it.key) ?? { key: it.key, name: it.name, sku: it.sku, count: 0 };
      x.count++;
      seen.set(it.key, x);
    }
    return [...seen.values()];
  }, [txns]);

  const plan = txns.map((t) => {
    if (t.skipped) return { t, kind: "skip" as const, why: t.skipped };
    if (known.has(t.txn_id)) return { t, kind: "skip" as const, why: "Already synced" };
    if (t.invoice_ref && refs.has(t.invoice_ref.toUpperCase())) return { t, kind: "payment" as const, why: `Pays ${t.invoice_ref.toUpperCase()}` };
    if (t.items.length === 0)
      return { t, kind: "error" as const, why: t.invoice_ref ? `No open invoice or order ${t.invoice_ref}` : "No items and no invoice number" };
    const missing = t.items.filter((it) => !choice(it.key));
    if (missing.length) return { t, kind: "error" as const, why: `Match ${missing.map((m) => m.name || m.sku).join(", ")} below` };
    return { t, kind: "sale" as const, why: `Sale of ${t.items.length} item${t.items.length === 1 ? "" : "s"}` };
  });
  const ready = plan.filter((p) => p.kind === "payment" || p.kind === "sale");
  const payload = JSON.stringify({
    tax_rate: tax,
    txns: ready.map(({ t, kind }) => ({
      txn_id: t.txn_id,
      amount: t.amount,
      tip: t.tip,
      card_brand: t.card_brand,
      card_last4: t.card_last4,
      auth_code: t.auth_code,
      invoice_ref: kind === "payment" ? t.invoice_ref : null,
      terminal_epi: t.terminal,
      method: t.method,
      received_at: t.received_at,
      lines:
        kind === "sale"
          ? t.items.map((it) => {
              const c = choice(it.key)!;
              return { product_id: c.product_id, unit_id: c.unit_id, qty: it.qty, unit_price: it.price };
            })
          : [],
    })),
    maps: items
      .filter((it) => picked[it.key])
      .map((it) => ({ item_key: it.key, product_id: picked[it.key].product_id, unit_id: picked[it.key].unit_id })),
  });

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn btn-primary cursor-pointer">
            Choose transaction CSV
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
          {fileName && <span className="text-sm text-stone-600">{fileName}</span>}
        </div>
        <p className="text-sm text-stone-600">
          Export transactions from the Valor portal (Reports → Transactions) or your Valor POS, then choose the file. Sales with an invoice or order
          number are applied to it. Itemized sales become counter sales and take stock (oldest lots first). Declined, voided and refunded rows are
          skipped, and transactions already synced are never added twice.
        </p>
        {unknownCols.length > 0 && <p className="text-xs text-stone-500">Ignoring columns: {unknownCols.join(", ")}</p>}
      </div>

      {txns.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">{ready.length} ready</span>
            <span className="rounded-full bg-stone-100 px-3 py-1">{plan.filter((p) => p.kind === "skip").length} skipped</span>
            <span className={`rounded-full px-3 py-1 ${plan.some((p) => p.kind === "error") ? "bg-red-50 text-red-800" : "bg-stone-100"}`}>
              {plan.filter((p) => p.kind === "error").length} need attention
            </span>
          </div>

          {items.length > 0 && (
            <div className="card">
              <h3 className="mb-2 font-semibold">Match terminal items to products</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>On the terminal</th>
                      <th>Product</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const c = choice(it.key);
                      const p = c ? byId.get(c.product_id) : null;
                      return (
                        <tr key={it.key} className={c ? "" : "bg-amber-50/60"}>
                          <td>
                            {it.name || "—"}
                            {it.sku && <div className="text-xs text-stone-500 tabular-nums">{it.sku}</div>}
                            {c && c.source !== "picked" && (
                              <div className="text-[11px] font-medium text-brand-700">
                                {c.source === "saved" ? "remembered" : `matched by ${c.source}`}
                              </div>
                            )}
                          </td>
                          <td>
                            <select
                              className="input"
                              aria-label={`Product for ${it.name || it.sku}`}
                              value={c?.product_id ?? ""}
                              onChange={(e) => {
                                const np = byId.get(e.target.value);
                                if (np) setPicked((x) => ({ ...x, [it.key]: { product_id: np.id, unit_id: np.units[0].id, source: "picked" } }));
                              }}
                            >
                              <option value="">Choose a product…</option>
                              {products.map((pp) => (
                                <option key={pp.id} value={pp.id}>
                                  {pp.name} ({pp.sku})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {p && (
                              <select
                                className="input w-auto"
                                aria-label={`Unit for ${it.name || it.sku}`}
                                value={c!.unit_id}
                                onChange={(e) => setPicked((x) => ({ ...x, [it.key]: { product_id: p.id, unit_id: e.target.value, source: "picked" } }))}
                              >
                                {p.units.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                    {u.factor !== 1 ? ` (${u.factor})` : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-stone-500">Matches you choose are remembered for the next sync.</p>
            </div>
          )}

          <div className="table-wrap max-h-[30rem] overflow-y-auto">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Transaction</th>
                  <th>When</th>
                  <th>Card</th>
                  <th className="num">Amount</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {plan.map(({ t, kind, why }) => (
                  <tr key={t.txn_id} className={kind === "error" ? "bg-red-50/60" : kind === "skip" ? "text-stone-400" : ""}>
                    <td className="font-mono text-xs">{t.txn_id}</td>
                    <td className="text-xs whitespace-nowrap">{t.received_at ? new Date(t.received_at).toLocaleString("en-US") : "—"}</td>
                    <td className="text-xs">
                      {t.method === "card" ? `${t.card_brand ?? "Card"}${t.card_last4 ? ` ••${t.card_last4}` : ""}` : t.method}
                    </td>
                    <td className="num">
                      {money(t.amount)}
                      {t.tip > 0 && <div className="text-xs text-stone-500">+ {money(t.tip)} tip</div>}
                    </td>
                    <td className={`text-sm ${kind === "error" ? "text-red-700" : ""}`}>{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={action} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="payload" value={payload} />
            <label>
              <span className="label">Sales tax % on itemized sales</span>
              <input type="number" min="0" step="0.001" className="input w-28" value={tax} onChange={(e) => setTax(Number(e.target.value))} />
            </label>
            <SubmitButton pendingText="Syncing…">
              Sync {ready.length} transaction{ready.length === 1 ? "" : "s"}
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
