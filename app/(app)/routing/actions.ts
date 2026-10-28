"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { dbMessage } from "@/lib/forms";

type Result = { ok: true } | { ok: false; error: string };

/** Save the day's stop order for one shop. */
export async function saveRoute(input: {
  date: string;
  layoutId: string;
  stops: string[];
  mode: "manual" | "optimized";
  driver: string | null;
  routeCode?: string;
}): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (!can(profile, "orders_manager", "warehouse")) return { ok: false, error: "Only Delivery/Order Management or warehouse can change routes." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Pick a day." };
  const stops = [...new Set(input.stops)].slice(0, 200);
  const { error } = await supabase.from("route_sheets").upsert(
    {
      route_date: input.date,
      layout_id: input.layoutId,
      route_code: (input.routeCode ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3),
      stops,
      mode: input.mode === "optimized" ? "optimized" : "manual",
      driver: input.driver?.trim().slice(0, 80) || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "route_date,layout_id,route_code" },
  );
  if (error) return { ok: false, error: dbMessage(error) };
  revalidatePath("/routing");
  return { ok: true };
}

/** Cache coordinates the browser looked up with Google Geocoding. */
export async function saveGeocodes(rows: { address: string; lat: number; lng: number; formatted?: string | null }[]): Promise<Result> {
  const { supabase } = await getSession();
  const clean = rows
    .filter((r) => r.address && Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .slice(0, 200)
    .map((r) => ({ address: r.address.slice(0, 500), lat: r.lat, lng: r.lng, formatted: r.formatted ?? null }));
  if (!clean.length) return { ok: true };
  const { error } = await supabase.rpc("save_geocodes", { p_rows: clean });
  if (error) return { ok: false, error: dbMessage(error) };
  return { ok: true };
}

export type ScannedStop = { id: string; number: string; customer: string; address: string; status: string; ships: string | null };

/** Turn a scanned invoice or order number into a route stop. */
export async function scanRouteOrder(raw: string): Promise<{ ok: true; order: ScannedStop } | { ok: false; error: string }> {
  const { supabase, profile } = await getSession();
  if (!can(profile, "orders_manager", "warehouse")) return { ok: false, error: "Only Delivery/Order Management or warehouse can change routes." };
  const code = raw.trim().toUpperCase().slice(0, 40);
  if (!code) return { ok: false, error: "Scan an invoice or order barcode." };
  let soId: string | null = null;
  const { data: inv } = await supabase.from("invoices").select("so_id").eq("invoice_number", code).maybeSingle();
  if (inv) soId = inv.so_id;
  else {
    const { data: so } = await supabase.from("sales_orders").select("id").eq("so_number", code).maybeSingle();
    soId = so?.id ?? null;
  }
  if (!soId) return { ok: false, error: `“${raw.trim()}” isn't an invoice or order number.` };
  const { data: o } = await supabase
    .from("sales_orders")
    .select("id, so_number, status, delivery_address, ship_date, customers(name)")
    .eq("id", soId)
    .maybeSingle();
  if (!o) return { ok: false, error: "Order not found." };
  if (o.status !== "completed" && o.status !== "invoiced") return { ok: false, error: `${o.so_number} is ${o.status}; only completed or invoiced orders go on a route.` };
  return {
    ok: true,
    order: {
      id: o.id,
      number: o.so_number,
      customer: (o.customers as unknown as { name: string } | null)?.name ?? "",
      address: o.delivery_address ?? "",
      status: o.status,
      ships: o.ship_date,
    },
  };
}
