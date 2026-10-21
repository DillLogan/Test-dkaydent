import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCSV, type Column } from "@/lib/csv";
import { addDays, today } from "@/lib/format";
import { searchTerm } from "@/lib/forms";

type Supa = Awaited<ReturnType<typeof createClient>>;
type R = Record<string, any>;
type Spec = (db: Supa, p: URLSearchParams) => Promise<{ rows: R[]; columns: Column<R>[] }>;

const range = (p: URLSearchParams) => {
  const to = p.get("to") || today();
  const from = p.get("from") || addDays(to, -29);
  return { from, toExclusive: addDays(to, 1) };
};

const PRODUCT_COLS: Column<R>[] = [
  { key: "sku" },
  { key: "name" },
  { key: "kind" },
  { key: "category" },
  { key: "variety" },
  { key: "color" },
  { key: "grade" },
  { key: "stem_length_cm" },
  { key: "base_unit" },
  { key: "units" },
  { key: "shelf_life_days" },
  { key: "reorder_point_base" },
  { key: "active" },
  { key: "notes" },
];
const VENDOR_COLS: Column<R>[] = ["name", "kind", "contact_name", "email", "phone", "country", "payment_terms", "notes", "active"].map((key) => ({ key }));
const CUSTOMER_COLS: Column<R>[] = [
  { key: "name" },
  { key: "price_tier", get: (r) => r.price_tiers?.name ?? r.price_tier ?? "" },
  ...["contact_name", "email", "phone", "address", "payment_terms_days", "resale_certificate", "notes", "active"].map((key) => ({ key })),
];

const SPECS: Record<string, Spec> = {
  products: async (db) => {
    const [{ data: products }, { data: units }, { data: stock }] = await Promise.all([
      db.from("products").select("*").order("sku"),
      db.from("product_units").select("product_id, name, factor").order("factor"),
      db.from("v_product_stock").select("product_id, qty_on_hand_base, avg_cost_base, value"),
    ]);
    const st = new Map((stock ?? []).map((s) => [s.product_id, s]));
    const rows = (products ?? []).map((p) => ({
      ...p,
      units: (units ?? [])
        .filter((u) => u.product_id === p.id && u.name !== p.base_unit)
        .map((u) => `${u.name}=${Number(u.factor)}`)
        .join("; "),
      on_hand_base: st.get(p.id)?.qty_on_hand_base ?? 0,
      avg_cost_base: st.get(p.id)?.avg_cost_base ?? "",
      value: Number(st.get(p.id)?.value ?? 0).toFixed(2),
    }));
    return { rows, columns: [...PRODUCT_COLS, { key: "on_hand_base" }, { key: "avg_cost_base" }, { key: "value" }] };
  },

  vendors: async (db) => {
    const { data } = await db.from("vendors").select("*").order("name");
    return { rows: data ?? [], columns: VENDOR_COLS };
  },

  customers: async (db) => {
    const { data } = await db.from("customers").select("*, price_tiers(name)").order("name");
    return { rows: data ?? [], columns: CUSTOMER_COLS };
  },

  lots: async (db, p) => {
    let q = db.from("v_lot_aging").select("*").order("received_at");
    const term = searchTerm(p.get("q") ?? undefined);
    if (term) q = q.or(`sku.ilike.%${term}%,product_name.ilike.%${term}%,lot_code.ilike.%${term}%`);
    if (p.get("location")) q = q.eq("location_id", p.get("location")!);
    if (p.get("product")) q = q.eq("product_id", p.get("product")!);
    const kind = p.get("kind");
    if (kind === "flower" || kind === "hard_good") q = q.eq("kind", kind);
    const { data } = await q.limit(20000);
    return {
      rows: data ?? [],
      columns: [
        { key: "lot_code" },
        { key: "sku" },
        { key: "product_name", label: "product" },
        { key: "kind" },
        { key: "location_name", label: "location" },
        { key: "received_at" },
        { key: "expires_at" },
        { key: "age_days" },
        { key: "days_to_expiry" },
        { key: "qty_on_hand_base", label: "qty_on_hand" },
        { key: "base_unit" },
        { key: "unit_cost_base", label: "landed_cost_per_unit" },
        { key: "value", get: (r) => Number(r.value).toFixed(2) },
      ],
    };
  },

  movements: async (db, p) => {
    let q = db
      .from("stock_movements")
      .select("*, lots(lot_code), products(sku, name, base_unit), locations(name), profiles(full_name)")
      .order("created_at", { ascending: false });
    if (p.get("kind")) q = q.eq("kind", p.get("kind")!);
    if (p.get("from") || p.get("to")) {
      const { from, toExclusive } = range(p);
      q = q.gte("created_at", from).lt("created_at", toExclusive);
    }
    const { data } = await q.limit(20000);
    return {
      rows: data ?? [],
      columns: [
        { key: "created_at" },
        { key: "kind" },
        { key: "sku", get: (r) => r.products?.sku },
        { key: "product", get: (r) => r.products?.name },
        { key: "lot_code", get: (r) => r.lots?.lot_code },
        { key: "location", get: (r) => r.locations?.name },
        { key: "qty_base" },
        { key: "base_unit", get: (r) => r.products?.base_unit },
        { key: "reference" },
        { key: "reason" },
        { key: "by", get: (r) => r.profiles?.full_name },
      ],
    };
  },

  "purchase-orders": async (db) => {
    const { data } = await db
      .from("purchase_order_lines")
      .select("*, purchase_orders(po_number, status, order_date, expected_date, freight_cost, other_cost, vendors(name)), products(sku, name, base_unit), product_units(name, factor)")
      .order("created_at", { ascending: false })
      .limit(20000);
    return {
      rows: data ?? [],
      columns: [
        { key: "po_number", get: (r) => r.purchase_orders?.po_number },
        { key: "vendor", get: (r) => r.purchase_orders?.vendors?.name },
        { key: "status", get: (r) => r.purchase_orders?.status },
        { key: "order_date", get: (r) => r.purchase_orders?.order_date },
        { key: "expected_date", get: (r) => r.purchase_orders?.expected_date },
        { key: "sku", get: (r) => r.products?.sku },
        { key: "product", get: (r) => r.products?.name },
        { key: "qty" },
        { key: "unit", get: (r) => r.product_units?.name },
        { key: "unit_cost" },
        { key: "extended", get: (r) => (Number(r.qty) * Number(r.unit_cost)).toFixed(2) },
        { key: "received_base", get: (r) => r.qty_received_base },
        { key: "base_unit", get: (r) => r.products?.base_unit },
        { key: "po_freight", get: (r) => r.purchase_orders?.freight_cost },
        { key: "po_other_charges", get: (r) => r.purchase_orders?.other_cost },
      ],
    };
  },

  "sales-orders": async (db) => {
    const { data } = await db
      .from("sales_order_lines")
      .select("*, sales_orders(so_number, status, order_date, ship_date, customers(name)), products(sku, name), product_units(name)")
      .order("created_at", { ascending: false })
      .limit(20000);
    return {
      rows: data ?? [],
      columns: [
        { key: "so_number", get: (r) => r.sales_orders?.so_number },
        { key: "customer", get: (r) => r.sales_orders?.customers?.name },
        { key: "status", get: (r) => r.sales_orders?.status },
        { key: "order_date", get: (r) => r.sales_orders?.order_date },
        { key: "ship_date", get: (r) => r.sales_orders?.ship_date },
        { key: "sku", get: (r) => r.products?.sku },
        { key: "product", get: (r) => r.products?.name },
        { key: "qty" },
        { key: "unit", get: (r) => r.product_units?.name },
        { key: "unit_price" },
        { key: "extended", get: (r) => (Number(r.qty) * Number(r.unit_price)).toFixed(2) },
        { key: "fifo_cost", get: (r) => (r.cost_total === null ? "" : Number(r.cost_total).toFixed(2)) },
        { key: "margin", get: (r) => (r.cost_total === null ? "" : (Number(r.qty) * Number(r.unit_price) - Number(r.cost_total)).toFixed(2)) },
      ],
    };
  },

  invoices: async (db) => {
    const { data } = await db
      .from("invoices")
      .select("*, customers(name), sales_orders(so_number)")
      .order("issued_at", { ascending: false })
      .limit(20000);
    const t = today();
    return {
      rows: data ?? [],
      columns: [
        { key: "invoice_number" },
        { key: "customer", get: (r) => r.customers?.name },
        { key: "so_number", get: (r) => r.sales_orders?.so_number },
        { key: "status", get: (r) => (r.status === "open" && r.due_at < t ? "overdue" : r.status) },
        { key: "issued_at" },
        { key: "due_at" },
        { key: "subtotal" },
        { key: "tax_rate" },
        { key: "tax" },
        { key: "total" },
        { key: "paid_at" },
      ],
    };
  },

  returns: async (db) => {
    const { data } = await db
      .from("return_lines")
      .select("*, returns(return_number, created_at, reason, credit_status, customers(name), sales_orders(so_number)), products(sku, name, base_unit)")
      .limit(20000);
    return {
      rows: (data ?? []).sort((a, b) => String(b.returns?.created_at).localeCompare(String(a.returns?.created_at))),
      columns: [
        { key: "return_number", get: (r) => r.returns?.return_number },
        { key: "created_at", get: (r) => r.returns?.created_at },
        { key: "customer", get: (r) => r.returns?.customers?.name },
        { key: "so_number", get: (r) => r.returns?.sales_orders?.so_number },
        { key: "sku", get: (r) => r.products?.sku },
        { key: "product", get: (r) => r.products?.name },
        { key: "qty_base" },
        { key: "base_unit", get: (r) => r.products?.base_unit },
        { key: "restocked", get: (r) => r.restock },
        { key: "credit" },
        { key: "cost", get: (r) => Number(r.cost_total).toFixed(2) },
        { key: "reason", get: (r) => r.returns?.reason },
        { key: "credit_status", get: (r) => r.returns?.credit_status },
      ],
    };
  },

  "sales-lines": async (db, p) => {
    const { from, toExclusive } = range(p);
    const { data } = await db
      .from("v_sales_lines")
      .select("*")
      .gte("fulfilled_at", from)
      .lt("fulfilled_at", toExclusive)
      .order("fulfilled_at")
      .limit(20000);
    return {
      rows: data ?? [],
      columns: [
        { key: "fulfilled_at" },
        { key: "so_number" },
        { key: "customer_name", label: "customer" },
        { key: "sku" },
        { key: "product_name", label: "product" },
        { key: "kind" },
        { key: "qty_base" },
        { key: "base_unit" },
        { key: "revenue" },
        { key: "cost", get: (r) => Number(r.cost).toFixed(2) },
        { key: "margin", get: (r) => Number(r.margin).toFixed(2) },
      ],
    };
  },

  shrink: async (db, p) => {
    const { from, toExclusive } = range(p);
    const [{ data }, { data: locs }] = await Promise.all([
      db.from("v_shrink").select("*").gte("created_at", from).lt("created_at", toExclusive).order("created_at").limit(20000),
      db.from("locations").select("id, name"),
    ]);
    const lotIds = [...new Set((data ?? []).map((r) => r.lot_id))];
    const { data: lots } = lotIds.length ? await db.from("lots").select("id, lot_code").in("id", lotIds) : { data: [] as R[] };
    const lotCode = new Map((lots ?? []).map((l) => [l.id, l.lot_code]));
    const locName = new Map((locs ?? []).map((l) => [l.id, l.name]));
    return {
      rows: (data ?? []).map((r) => ({ ...r, lots: { lot_code: lotCode.get(r.lot_id) }, locations: { name: locName.get(r.location_id) } })),
      columns: [
        { key: "created_at" },
        { key: "sku" },
        { key: "product_name", label: "product" },
        { key: "lot_code", get: (r) => r.lots?.lot_code },
        { key: "location", get: (r) => r.locations?.name },
        { key: "qty_base" },
        { key: "base_unit" },
        { key: "value", get: (r) => Number(r.value).toFixed(2) },
        { key: "reason" },
      ],
    };
  },

  // Import templates: headers plus example rows
  "template-products": async () => ({
    columns: PRODUCT_COLS,
    rows: [
      { sku: "RO-EXP-50", name: "Rose Explorer 50cm", kind: "flower", category: "Roses", variety: "Explorer", color: "Red", grade: "Select", stem_length_cm: 50, base_unit: "stem", units: "bunch=25; box=300", shelf_life_days: 10, reorder_point_base: 300, active: true, notes: "" },
      { sku: "HG-CUBE-4", name: "Glass Cube 4in", kind: "hard_good", category: "Vases", base_unit: "each", units: "case=24", reorder_point_base: 48, active: true },
    ],
  }),
  "template-vendors": async () => ({
    columns: VENDOR_COLS,
    rows: [{ name: "Example Farms", kind: "grower", contact_name: "Ana", email: "orders@example.com", country: "Colombia", payment_terms: "Net 15", active: true }],
  }),
  "template-customers": async () => ({
    columns: CUSTOMER_COLS,
    rows: [{ name: "Example Florist", price_tier: "Retail Florist", contact_name: "Jamie", email: "jamie@example.com", payment_terms_days: 30, active: true }],
  }),
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const spec = SPECS[entity];
  if (!spec) return NextResponse.json({ error: "Unknown export" }, { status: 404 });

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const { rows, columns } = await spec(db, p);
  const csv = "﻿" + toCSV(rows, columns); // BOM so Excel reads UTF-8
  const suffix = entity.startsWith("template-") ? "" : `-${today()}`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dkaydent-${entity}${suffix}.csv"`,
      "cache-control": "no-store",
    },
  });
}
