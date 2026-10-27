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
}): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (!can(profile, "orders_manager", "warehouse")) return { ok: false, error: "Only the orders manager or warehouse can change routes." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Pick a day." };
  const stops = [...new Set(input.stops)].slice(0, 200);
  const { error } = await supabase.from("route_sheets").upsert(
    {
      route_date: input.date,
      layout_id: input.layoutId,
      stops,
      mode: input.mode === "optimized" ? "optimized" : "manual",
      driver: input.driver?.trim().slice(0, 80) || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "route_date,layout_id" },
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
