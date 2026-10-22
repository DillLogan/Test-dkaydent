"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";
import { DEFAULT_MAP, MAP_FIELDS, mapInventory, mapOrders, pullFromWebsite, withDefaults } from "@/lib/webstore";

const PATH = "/settings/web-store";
const done = (msg: string) => {
  revalidatePath(PATH);
  redirect(`${PATH}?message=${encodeURIComponent(msg)}`);
};
function url(fd: FormData, key: string, label: string) {
  const v = str(fd, key);
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    fail(PATH, `${label} isn't a full web address (https://…)`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) fail(PATH, `${label} must start with https://`);
  return u.toString();
}

export async function saveConnection(fd: FormData) {
  const { supabase } = await requireRole();
  const patch: Record<string, unknown> = {
    enabled: fd.get("enabled") === "on",
    inventory_url: url(fd, "inventory_url", "Inventory address"),
    orders_url: url(fd, "orders_url", "Orders address"),
    stock_location_id: str(fd, "stock_location_id"),
    web_customer_id: str(fd, "web_customer_id"),
    updated_at: new Date().toISOString(),
  };
  const key = str(fd, "api_key");
  if (key) patch.api_key = key;
  if (fd.get("clear_api_key") === "on") patch.api_key = null;
  const { error } = await supabase.from("web_store_settings").update(patch).eq("id", 1);
  if (error) fail(PATH, dbMessage(error));
  done("Connection saved.");
}

export async function newWebhookSecret() {
  const { supabase } = await requireRole();
  const { error } = await supabase
    .from("web_store_settings")
    .update({ webhook_secret: randomBytes(24).toString("hex"), updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) fail(PATH, dbMessage(error));
  done("New webhook secret made. Put it in the website's webhook settings; the old one stops working now.");
}

export async function saveFieldMap(fd: FormData) {
  const { supabase } = await requireRole();
  const map: Record<string, string> = {};
  for (const f of MAP_FIELDS) {
    const v = String(fd.get(f.key) ?? "").trim();
    if (v !== DEFAULT_MAP[f.key]) map[f.key] = v;
  }
  const { error } = await supabase.from("web_store_settings").update({ field_map: map, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) fail(PATH, dbMessage(error));
  done("Field names saved.");
}

export async function resetFieldMap() {
  const { supabase } = await requireRole();
  const { error } = await supabase.from("web_store_settings").update({ field_map: {} }).eq("id", 1);
  if (error) fail(PATH, dbMessage(error));
  done("Field names reset to the defaults.");
}

export async function syncNow() {
  const { supabase } = await requireRole();
  let results;
  try {
    results = await pullFromWebsite(supabase, "manual");
  } catch (e: any) {
    fail(PATH, e.message);
  }
  if (!results.length) fail(PATH, "Add the website's inventory or orders address first.");
  const bad = results.filter((r) => !r.ok);
  if (bad.length) fail(PATH, bad.map((r) => `${r.kind === "inventory" ? "Inventory" : "Orders"}: ${r.error}`).join(" · "));
  done(
    results
      .map((r) =>
        r.kind === "inventory"
          ? `Inventory: ${r.summary.updated} updated, ${r.summary.unchanged} unchanged${r.summary.unmatched?.length ? `, ${r.summary.unmatched.length} SKUs to link` : ""}`
          : `Orders: ${r.summary.created ?? 0} new${r.summary.needs_review ? `, ${r.summary.needs_review} to review` : ""}${r.summary.cancelled ? `, ${r.summary.cancelled} cancelled` : ""}`,
      )
      .join(" · "),
  );
}

/** Try the field names on a pasted sample, without changing anything. */
export async function previewMapping(kind: "inventory" | "orders", sample: string) {
  const { supabase } = await requireRole();
  let json: unknown;
  try {
    json = JSON.parse(sample);
  } catch {
    return { error: "That isn't valid JSON. Paste exactly what the website sends." };
  }
  const { data } = await supabase.from("web_store_settings").select("field_map").eq("id", 1).single();
  const m = withDefaults(data?.field_map);
  return kind === "inventory" ? { inventory: mapInventory(json, m) } : { orders: mapOrders(json, m) };
}

export async function linkSku(fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const sku = str(fd, "sku");
  const [pid, uid] = String(fd.get("product_unit") ?? "").split(":");
  if (!sku || !pid || !uid) fail(PATH, "Choose the item and unit for that website SKU.");
  const { error } = await supabase.rpc("web_link_sku", { p_sku: sku, p_product_id: pid, p_unit_id: uid });
  if (error) fail(PATH, dbMessage(error));
  done(`Linked ${sku}. It'll match from the next sync.`);
}

export async function unlinkSku(sku: string) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const { error } = await supabase.from("web_sku_links").delete().eq("external_sku", sku);
  if (error) fail(PATH, dbMessage(error));
  done(`Removed the link for ${sku}.`);
}

export async function dismissUnmatched(sku: string) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const { error } = await supabase.from("web_unmatched_skus").delete().eq("external_sku", sku);
  if (error) fail(PATH, dbMessage(error));
  done(`Dismissed ${sku}. It'll come back if the website sends it again.`);
}
