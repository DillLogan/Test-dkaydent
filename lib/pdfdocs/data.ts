import type { DocData, Row } from "./types";

/** Company details from Customize printouts, in the shape the layouts use. */
export type Business = { name: string; address: string; phone: string; footer: string };
export const businessFields = (b: Business) => ({ ...b, contact: [b.address.replace(/\s*\n\s*/g, ", "), b.phone].filter(Boolean).join(" · ") });

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const pct = (n: number) => `${Math.round(n * 1000) / 1000}%`;
export const printedNow = () => new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
export const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export type PullRowIn = { name: string; sku: string; section?: string | null; shelf?: string | null; lot?: string | null; exp?: string | null; qty: string };
/** Pull ticket: rows grouped by location (with the shop's name first when there are several), then what's short. */
export function pullData(o: {
  business: Business;
  so: { number: string; customer: string; ships: string; lines: number; notes?: string | null; boxes?: number | null; mustCheck: boolean };
  groups: { shop?: string; location: string; rows: PullRowIn[] }[];
  short: PullRowIn[];
}): DocData {
  const rows: Row[] = [];
  for (const g of o.groups) {
    rows.push({ _group: g.shop ? `${g.shop} · ${g.location}` : g.location });
    for (const r of g.rows) rows.push({ item: r.name, sku: r.sku, spot: r.section || "-", shelf: r.section && r.shelf ? `Shelf ${r.shelf}` : "", lot: r.lot || "-", exp: r.exp ? `exp ${r.exp}` : "", qty: r.qty });
  }
  if (o.short.length) {
    rows.push({ _group: "Not in stock", _tone: "warn" });
    for (const r of o.short) rows.push({ item: r.name, sku: r.sku, spot: "", lot: "", qty: `Short ${r.qty}` });
  }
  return {
    fields: { business: businessFields(o.business), so: { ...o.so, printed: printedNow(), notes: o.so.notes || "", boxes: o.so.boxes ?? "" } },
    rows,
  };
}

/** Invoice: both copies, lines, and the totals block (only the lines that apply). */
export function invoiceData(o: {
  business: Business;
  copies: string[];
  inv: { number: string; issued: string; due: string; soNumber: string; customer: string; billTo: string; deliverTo: string; shipsFrom?: string; terms?: string; note?: string; resale?: string | null; orderNotes?: string | null; status: string };
  lines: { sku: string; item: string; qty: string; price: number; amount: number }[];
  totals: { subtotal: number; taxRate: number; tax: number; cardFeeRate: number; cardFee: number; total: number; paid: number };
}): DocData {
  const t = o.totals;
  const pairs: [string, string][] = [["Subtotal", usd(t.subtotal)]];
  if (t.tax || t.taxRate) pairs.push([`Tax (${pct(t.taxRate)})`, usd(t.tax)]);
  if (t.cardFee) pairs.push([`Card processing fee (${pct(t.cardFeeRate)})`, usd(t.cardFee)]);
  pairs.push(["Total", usd(t.total)]);
  if (t.paid) pairs.push(["Paid", usd(t.paid)]);
  const due = Math.max(0, Math.round((t.total - t.paid) * 100) / 100);
  return {
    copies: o.copies,
    fields: {
      business: businessFields(o.business),
      inv: { ...o.inv, resale: o.inv.resale || "", orderNotes: o.inv.orderNotes || "", shipsFrom: o.inv.shipsFrom || "", terms: o.inv.terms || "", note: o.inv.note || "" },
      totals: {
        labels: pairs.map((p) => p[0]).join("\n"),
        values: pairs.map((p) => p[1]).join("\n"),
        dueLabel: t.paid ? (due > 0 ? "Balance due" : "Paid in full") : "Total due",
        due: usd(due),
        subtotal: usd(t.subtotal), tax: usd(t.tax), cardFee: t.cardFee ? usd(t.cardFee) : "", total: usd(t.total), paid: t.paid ? usd(t.paid) : "",
      },
    },
    rows: o.lines.map((l) => ({ sku: l.sku, item: l.item, qty: l.qty, price: usd(l.price), amount: usd(l.amount) })),
  };
}

/** Route sheet: one row per stop, in driving order. */
export function routeData(o: {
  business: Business;
  day: string;
  code?: string | null;
  shop: string;
  driver?: string | null;
  start?: string | null;
  stops: { customer: string; address: string; order: string; phone?: string | null; boxes?: number | null }[];
  showBoxes?: boolean;
}): DocData {
  const boxes = o.stops.reduce((n, s) => n + (s.boxes ?? 0), 0);
  const some = o.stops.some((s) => s.boxes == null);
  return {
    fields: {
      business: businessFields(o.business),
      route: {
        day: o.day, codeText: o.code ? ` · Route ${o.code}` : "", shop: o.shop, driverText: o.driver ? `Driver: ${o.driver}` : "", start: o.start || "",
        summary: `${o.stops.length} stop${o.stops.length === 1 ? "" : "s"}${o.showBoxes === false ? "" : ` · ${boxes} boxes expected${some ? " (some orders have no label count yet)" : ""}`}`,
      },
    },
    rows: o.stops.map((s, i) => ({ n: i + 1, customer: s.customer, address: s.address || "No delivery address", order: s.order, phone: s.phone || "", boxes: s.boxes == null ? "?" : String(s.boxes) })),
  };
}

/** Item / lot / product labels. */
export const itemLabel = (business: Business, l: { title: string; sku: string; code: string; lines: string[] }) => ({ business: businessFields(business), title: l.title, sku: l.sku !== l.code ? l.sku : "", code: l.code, printed: today(), line1: l.lines[0] || "", line2: l.lines[1] || "", line3: l.lines[2] || "" });

/** One box label per box. */
export const boxLabels = (business: Business, o: { customer: string; address: string; route?: string | null; code: string; count: number }) =>
  Array.from({ length: o.count }, (_, i) => ({ business: businessFields(business), customer: o.customer, address: o.address, route: o.route || "", code: o.code, box: `Box ${i + 1} of ${o.count}`, printed: today() }));
