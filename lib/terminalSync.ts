/**
 * Read a transaction export from the Valor portal (or a Valor POS) and turn it
 * into transactions to sync. Column names vary between reports, so common
 * headings are recognized. Rows that share a transaction id are one sale;
 * rows with item columns become the sale's lines.
 */

export const SYNC_COLUMNS: Record<string, string[]> = {
  txn_id: ["transaction id", "txn id", "trans id", "transaction #", "transaction no", "rrn", "reference number", "ref #", "txn_id"],
  date: ["date", "transaction date", "date/time", "datetime", "date time", "created"],
  time: ["time", "transaction time"],
  amount: ["amount", "total", "sale amount", "approved amount", "transaction amount", "total amount"],
  tip: ["tip", "tip amount", "gratuity"],
  card_brand: ["card type", "card brand", "brand", "card"],
  card_last4: ["card number", "last 4", "last4", "card #", "masked card", "masked pan", "account"],
  auth_code: ["auth code", "approval code", "auth", "authorization code"],
  invoice_ref: ["invoice", "invoice #", "invoice number", "invoicenumber", "invoice no"],
  terminal: ["epi", "terminal", "serial", "serial number", "terminal id", "device", "tid"],
  status: ["status", "result", "response", "transaction status"],
  type: ["type", "transaction type", "tran type", "txn type"],
  method: ["payment method", "tender", "payment type", "tender type"],
  item: ["item", "item name", "product", "description", "product name"],
  sku: ["sku", "item code", "plu", "upc", "item id", "product code"],
  qty: ["qty", "quantity", "item qty"],
  price: ["price", "unit price", "item price"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ");
export function mapHeader(h: string): string | null {
  const n = norm(h);
  for (const [key, names] of Object.entries(SYNC_COLUMNS)) if (key === n || names.includes(n)) return key;
  return null;
}

const toNum = (s: string | undefined) => {
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s.trim());
  const n = Number(s.replace(/[$,()\s]/g, ""));
  return neg ? -n : n;
};

export type ItemRef = { key: string; name: string; sku: string; qty: number; price: number };
export type SyncTxn = {
  txn_id: string;
  rows: number[];
  received_at: string | null;
  amount: number;
  tip: number;
  card_brand: string | null;
  card_last4: string | null;
  auth_code: string | null;
  invoice_ref: string | null;
  terminal: string | null;
  method: "card" | "cash" | "check" | "other";
  items: ItemRef[];
  skipped: string | null; // why it won't be synced
};

export function itemKey(name: string, sku: string) {
  return (sku || name).trim().toLowerCase();
}

export function groupTransactions(records: Record<string, string>[]): SyncTxn[] {
  const byId = new Map<string, SyncTxn>();
  records.forEach((r, i) => {
    const row = i + 2;
    const id = (r.txn_id ?? "").trim();
    if (!id) return;
    let t = byId.get(id);
    if (!t) {
      const status = `${r.status ?? ""} ${r.type ?? ""}`;
      const when = [r.date, r.time].filter(Boolean).join(" ").trim();
      const parsed = when ? new Date(when) : null;
      const last4 = (r.card_last4 ?? "").replace(/\D/g, "").slice(-4);
      const m = (r.method ?? "").toLowerCase();
      const amount = toNum(r.amount);
      t = {
        txn_id: id,
        rows: [],
        received_at: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null,
        amount,
        tip: toNum(r.tip) || 0,
        card_brand: r.card_brand?.trim() || null,
        card_last4: last4.length === 4 ? last4 : null,
        auth_code: r.auth_code?.trim() || null,
        invoice_ref: r.invoice_ref?.trim() || null,
        terminal: r.terminal?.trim() || null,
        method: /cash/.test(m) ? "cash" : /check|cheque/.test(m) ? "check" : /ach|wire|other/.test(m) ? "other" : "card",
        items: [],
        skipped: /declin|void|fail|refund|return|reversal|cancel/i.test(status)
          ? `Not a completed sale (${status.trim()})`
          : !(amount > 0)
            ? "No positive amount"
            : null,
      };
      byId.set(id, t);
    }
    t.rows.push(row);
    const name = (r.item ?? "").trim();
    const sku = (r.sku ?? "").trim();
    if (name || sku) {
      const q = toNum(r.qty);
      const p = toNum(r.price);
      t.items.push({ key: itemKey(name, sku), name, sku, qty: q > 0 ? q : 1, price: p >= 0 ? p : 0 });
    }
  });
  return [...byId.values()];
}
