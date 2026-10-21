import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Resolve a scanned or typed code to the right page. */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("code") ?? "").trim();
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url));
  if (!raw) return go("/scan");
  const code = raw.toUpperCase();
  const db = await createClient();

  const tries: [string, string, string, (id: string) => string][] = [
    ["lots", "lot_code", raw, (id) => `/inventory/lots/${id}`],
    ["products", "sku", code, (id) => `/products/${id}`],
    ["purchase_orders", "po_number", code, (id) => `/purchasing/${id}`],
    ["sales_orders", "so_number", code, (id) => `/sales/${id}`],
    ["invoices", "invoice_number", code, (id) => `/invoices/${id}`],
  ];
  for (const [table, col, value, path] of tries) {
    const { data } = await db.from(table).select("id").ilike(col, value.replace(/[%_\\]/g, "\\$&")).limit(1);
    if (data?.[0]) return go(path(data[0].id));
  }
  const { data: ret } = await db.from("returns").select("so_id").ilike("return_number", code).limit(1);
  if (ret?.[0]) return go(`/sales/${ret[0].so_id}`);

  return go(`/scan?error=${encodeURIComponent(`Nothing matches “${raw}”. Scan a lot label, product SKU, or an order/invoice number.`)}&code=${encodeURIComponent(raw)}`);
}
