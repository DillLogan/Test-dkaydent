import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Web store connection: turns the shop's own website JSON into the shapes the
 * database functions take (web_store_apply_inventory / web_store_upsert_order).
 *
 * Every field is a dot path into the website's JSON (e.g. "customer.email",
 * "line_items"). An empty list path means the response itself is the list.
 */
export type FieldMap = {
  inventory_list: string;
  inventory_sku: string;
  inventory_qty: string;
  orders_list: string;
  order_id: string;
  order_number: string;
  order_email: string;
  order_name: string;
  order_phone: string;
  order_date: string;
  order_ship_date: string;
  order_notes: string;
  order_status: string;
  cancelled_values: string; // comma separated statuses that mean cancelled
  order_lines: string;
  line_sku: string;
  line_qty: string;
  line_price: string;
  since_param: string; // query parameter for "orders changed since"
};

export const DEFAULT_MAP: FieldMap = {
  inventory_list: "items",
  inventory_sku: "sku",
  inventory_qty: "quantity",
  orders_list: "orders",
  order_id: "id",
  order_number: "number",
  order_email: "customer.email",
  order_name: "customer.name",
  order_phone: "customer.phone",
  order_date: "created_at",
  order_ship_date: "delivery_date",
  order_notes: "note",
  order_status: "status",
  cancelled_values: "cancelled, canceled, refunded, voided",
  order_lines: "line_items",
  line_sku: "sku",
  line_qty: "quantity",
  line_price: "price",
  since_param: "since",
};

export const MAP_FIELDS: { key: keyof FieldMap; label: string; group: "Inventory" | "Orders" | "Order lines" }[] = [
  { key: "inventory_list", label: "List of items", group: "Inventory" },
  { key: "inventory_sku", label: "SKU", group: "Inventory" },
  { key: "inventory_qty", label: "Quantity in stock", group: "Inventory" },
  { key: "orders_list", label: "List of orders", group: "Orders" },
  { key: "order_id", label: "Order id", group: "Orders" },
  { key: "order_number", label: "Order number", group: "Orders" },
  { key: "order_email", label: "Customer email", group: "Orders" },
  { key: "order_name", label: "Customer name", group: "Orders" },
  { key: "order_phone", label: "Customer phone", group: "Orders" },
  { key: "order_date", label: "Ordered at", group: "Orders" },
  { key: "order_ship_date", label: "Delivery / pickup date", group: "Orders" },
  { key: "order_notes", label: "Order note", group: "Orders" },
  { key: "order_status", label: "Status", group: "Orders" },
  { key: "cancelled_values", label: "Statuses that mean cancelled", group: "Orders" },
  { key: "since_param", label: "“Changed since” URL parameter", group: "Orders" },
  { key: "order_lines", label: "List of items in the order", group: "Order lines" },
  { key: "line_sku", label: "SKU", group: "Order lines" },
  { key: "line_qty", label: "Quantity", group: "Order lines" },
  { key: "line_price", label: "Price each", group: "Order lines" },
];

export const withDefaults = (m: unknown): FieldMap => ({ ...DEFAULT_MAP, ...((m && typeof m === "object" ? m : {}) as Partial<FieldMap>) });

export function get(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: any = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
function list(json: unknown, path: string): unknown[] {
  const v = get(json, path);
  if (Array.isArray(v)) return v;
  if (Array.isArray(json)) return json;
  return [];
}

export type InventoryRow = { sku: string; qty: number };
export type WebOrder = {
  external_id: string;
  number?: string;
  email?: string;
  name?: string;
  phone?: string;
  ordered_at?: string;
  ship_date?: string;
  notes?: string;
  cancelled?: boolean;
  lines: { sku: string; qty: number; price?: number }[];
};

export function mapInventory(json: unknown, m: FieldMap): { rows: InventoryRow[]; problems: string[] } {
  const rows: InventoryRow[] = [];
  const problems: string[] = [];
  const items = list(json, m.inventory_list);
  if (!items.length) problems.push(`No items found at "${m.inventory_list || "(the response itself)"}".`);
  items.forEach((it, i) => {
    const sku = text(get(it, m.inventory_sku));
    const qty = num(get(it, m.inventory_qty));
    if (!sku) return problems.push(`Item ${i + 1}: no SKU at "${m.inventory_sku}".`);
    if (!Number.isFinite(qty)) return problems.push(`${sku}: quantity at "${m.inventory_qty}" isn't a number.`);
    rows.push({ sku, qty });
  });
  return { rows, problems };
}

const dateOnly = (v: unknown) => {
  const s = text(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : d.toISOString().slice(0, 10);
};
const isoTime = (v: unknown) => {
  const s = text(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export function mapOrders(json: unknown, m: FieldMap): { orders: WebOrder[]; problems: string[] } {
  // a single order object, or a list of them
  const one = !Array.isArray(json) && get(json, m.order_id) !== undefined && get(json, m.orders_list) === undefined;
  const raw = one ? [json] : list(json, m.orders_list);
  const cancelled = new Set(m.cancelled_values.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const orders: WebOrder[] = [];
  const problems: string[] = [];
  if (!raw.length) problems.push(`No orders found at "${m.orders_list || "(the response itself)"}".`);
  raw.forEach((o, i) => {
    const id = text(get(o, m.order_id));
    if (!id) return problems.push(`Order ${i + 1}: no id at "${m.order_id}".`);
    const lines = (Array.isArray(get(o, m.order_lines)) ? (get(o, m.order_lines) as unknown[]) : []).flatMap((l, j) => {
      const sku = text(get(l, m.line_sku));
      const qty = num(get(l, m.line_qty));
      if (!sku || !Number.isFinite(qty)) {
        problems.push(`Order ${id}, item ${j + 1}: missing SKU or quantity.`);
        return [];
      }
      const price = num(get(l, m.line_price));
      return [{ sku, qty, ...(Number.isFinite(price) && text(get(l, m.line_price)) !== "" ? { price } : {}) }];
    });
    orders.push({
      external_id: id,
      number: text(get(o, m.order_number)) || undefined,
      email: text(get(o, m.order_email)) || undefined,
      name: text(get(o, m.order_name)) || undefined,
      phone: text(get(o, m.order_phone)) || undefined,
      ordered_at: isoTime(get(o, m.order_date)),
      ship_date: dateOnly(get(o, m.order_ship_date)),
      notes: text(get(o, m.order_notes)) || undefined,
      cancelled: cancelled.has(text(get(o, m.order_status)).toLowerCase()),
      lines,
    });
  });
  return { orders, problems };
}

/**
 * The website signs each webhook body with the shared secret:
 * header "X-Signature: sha256=<hex HMAC-SHA256 of the raw body>" (hex or base64 accepted).
 */
export function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const given = header.trim().replace(/^sha256=/i, "");
  const mac = createHmac("sha256", secret).update(raw, "utf8").digest();
  for (const expected of [mac.toString("hex"), mac.toString("base64")]) {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export type SyncResult = { kind: "inventory" | "orders"; ok: boolean; summary?: any; error?: string };

/** Apply mapped data through the database functions, logging failures to the sync history. */
export async function applyInventory(db: SupabaseClient, rows: InventoryRow[], source: "webhook" | "pull" | "manual"): Promise<SyncResult> {
  const { data, error } = await db.rpc("web_store_apply_inventory", { p_items: rows, p_source: source });
  if (error) {
    await db.rpc("web_store_log", { p_kind: "inventory", p_source: source, p_ok: false, p_summary: null, p_error: error.message });
    return { kind: "inventory", ok: false, error: error.message };
  }
  return { kind: "inventory", ok: true, summary: data };
}

export async function applyOrders(db: SupabaseClient, orders: WebOrder[], source: "webhook" | "pull" | "manual"): Promise<SyncResult> {
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  for (const o of orders) {
    const { data, error } = await db.rpc("web_store_upsert_order", { p_order: o });
    if (error) errors.push(`${o.number || o.external_id}: ${error.message}`);
    else counts[(data as any).result] = (counts[(data as any).result] ?? 0) + 1;
  }
  const summary = { orders: orders.length, ...counts, ...(errors.length ? { errors } : {}) };
  await db.rpc("web_store_log", { p_kind: "orders", p_source: source, p_ok: errors.length === 0, p_summary: summary, p_error: errors.join("\n") || null });
  return { kind: "orders", ok: errors.length === 0, summary, error: errors.join("\n") || undefined };
}

async function fetchJson(url: string, apiKey: string | null) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`The website answered ${res.status} ${res.statusText} for ${new URL(url).pathname}`);
    return await res.json();
  } catch (e: any) {
    throw new Error(e?.name === "AbortError" ? "The website took longer than 20 seconds to answer." : e?.message || "Couldn't reach the website.");
  } finally {
    clearTimeout(t);
  }
}

/** Pull inventory and new orders from the website's URLs. */
export async function pullFromWebsite(db: SupabaseClient, source: "pull" | "manual"): Promise<SyncResult[]> {
  const { data: cfg, error } = await db.rpc("web_store_config");
  if (error || !cfg) throw new Error(error?.message || "Web store isn't set up.");
  const m = withDefaults(cfg.field_map);
  const out: SyncResult[] = [];
  if (cfg.inventory_url) {
    try {
      const { rows, problems } = mapInventory(await fetchJson(cfg.inventory_url, cfg.api_key), m);
      if (!rows.length) throw new Error(problems[0] || "No inventory items in the response.");
      out.push(await applyInventory(db, rows, source));
    } catch (e: any) {
      await db.rpc("web_store_log", { p_kind: "inventory", p_source: source, p_ok: false, p_summary: null, p_error: e.message });
      out.push({ kind: "inventory", ok: false, error: e.message });
    }
  }
  if (cfg.orders_url) {
    try {
      const url = new URL(cfg.orders_url);
      if (cfg.last_order_sync && m.since_param) {
        // look back an extra hour so nothing slips between runs (duplicates are ignored)
        url.searchParams.set(m.since_param, new Date(new Date(cfg.last_order_sync).getTime() - 3600_000).toISOString());
      }
      const json = await fetchJson(url.toString(), cfg.api_key);
      const { orders, problems } = mapOrders(json, m);
      if (!orders.length && problems.length && !(Array.isArray(get(json, m.orders_list)) || Array.isArray(json))) throw new Error(problems[0]);
      out.push(await applyOrders(db, orders, source));
    } catch (e: any) {
      await db.rpc("web_store_log", { p_kind: "orders", p_source: source, p_ok: false, p_summary: null, p_error: e.message });
      out.push({ kind: "orders", ok: false, error: e.message });
    }
  }
  return out;
}
