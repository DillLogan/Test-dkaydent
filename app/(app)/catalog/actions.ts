"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";

export async function saveItemPrices(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const customer = str(fd, "customer_id");
  const unit = str(fd, "unit_id");
  const tier = str(fd, "tier_id");
  const path = `/catalog?c=${customer}`;
  if (!customer || !unit) fail("/catalog", "Pick a customer first.");
  if (tier) {
    const p = num(fd, "tier_price");
    const { error } = p === null
      ? await supabase.from("tier_prices").delete().eq("tier_id", tier).eq("product_unit_id", unit)
      : await supabase.from("tier_prices").upsert({ tier_id: tier, product_unit_id: unit, price: p }, { onConflict: "tier_id,product_unit_id" });
    if (error) fail(path, dbMessage(error));
  }
  const sp = num(fd, "special_price");
  const { error } = sp === null
    ? await supabase.from("customer_prices").delete().eq("customer_id", customer).eq("product_unit_id", unit)
    : await supabase.from("customer_prices").upsert({ customer_id: customer, product_unit_id: unit, price: sp, updated_at: new Date().toISOString() }, { onConflict: "customer_id,product_unit_id" });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/catalog");
  redirect(`${path}&message=${encodeURIComponent("Prices saved.")}`);
}

export async function catalogCheckout(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const customer = str(fd, "customer_id");
  const path = `/catalog?c=${customer}`;
  let lines: unknown;
  try {
    lines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    fail(path, "The cart could not be read.");
  }
  const { data, error } = await supabase.rpc("catalog_checkout", { p_customer_id: customer, p_lines: lines, p_notes: String(fd.get("notes") ?? ""), p_payment: String(fd.get("payment") ?? "") || null });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/sales");
  redirect(`/sales/${data}?message=${encodeURIComponent("Draft order created from the cart.")}`);
}
