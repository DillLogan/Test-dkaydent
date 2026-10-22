"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { bool, dbMessage, fail, int, num, str } from "@/lib/forms";

function productFields(fd: FormData) {
  return {
    sku: str(fd, "sku")?.toUpperCase(),
    name: str(fd, "name"),
    kind: str(fd, "kind"),
    category: str(fd, "category"),
    variety: str(fd, "variety"),
    color: str(fd, "color"),
    grade: str(fd, "grade"),
    stem_length_cm: int(fd, "stem_length_cm"),
    shelf_life_days: int(fd, "shelf_life_days"),
    reorder_point_base: num(fd, "reorder_point_base") ?? 0,
    notes: str(fd, "notes"),
  };
}

export async function createProduct(fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const fields = productFields(fd);
  const base_unit = str(fd, "base_unit")?.toLowerCase();
  if (!fields.sku || !fields.name || !fields.kind || !base_unit) {
    fail("/products/new", "SKU, name, type and base unit are required.");
  }
  const { data, error } = await supabase
    .from("products")
    .insert({ ...fields, base_unit })
    .select("id")
    .single();
  if (error) fail("/products/new", dbMessage(error));

  // Optional first pack unit, e.g. "bunch" = 25
  const packName = str(fd, "pack_name")?.toLowerCase();
  const packFactor = num(fd, "pack_factor");
  if (packName && packFactor && packFactor > 0 && packName !== base_unit) {
    await supabase.from("product_units").insert({ product_id: data.id, name: packName, factor: packFactor });
  }
  revalidatePath("/products");
  redirect(`/products/${data.id}?message=${encodeURIComponent("Product created.")}`);
}

export async function updateProduct(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `/products/${id}`;
  const fields = productFields(fd);
  if (!fields.sku || !fields.name || !fields.kind) fail(path, "SKU, name and type are required.");
  const { error } = await supabase
    .from("products")
    .update({ ...fields, active: bool(fd, "active") })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Saved.")}`);
}

export async function addUnit(productId: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `/products/${productId}`;
  const name = str(fd, "name")?.toLowerCase();
  const factor = num(fd, "factor");
  if (!name || !factor || factor <= 0) fail(path, "Enter a unit name and how many base units it holds.");
  const { error } = await supabase.from("product_units").insert({ product_id: productId, name, factor });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}

export async function deleteUnit(productId: string, unitId: string) {
  const { supabase } = await requireRole("buyer");
  const path = `/products/${productId}`;
  const { error, count } = await supabase
    .from("product_units")
    .delete({ count: "exact" })
    .eq("id", unitId);
  if (error) fail(path, dbMessage(error));
  if (!count) fail(path, "The base unit can't be removed.");
  revalidatePath(path);
  redirect(path);
}

export async function setTierPrice(productId: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `/products/${productId}`;
  const tier_id = str(fd, "tier_id");
  const product_unit_id = str(fd, "product_unit_id");
  const price = num(fd, "price");
  if (!tier_id || !product_unit_id || price === null || price < 0) fail(path, "Choose a tier and unit and enter a price.");
  const { error } = await supabase
    .from("tier_prices")
    .upsert({ tier_id, product_unit_id, price }, { onConflict: "tier_id,product_unit_id" });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}

export async function deleteTierPrice(productId: string, tierPriceId: string) {
  const { supabase } = await requireRole("sales");
  const path = `/products/${productId}`;
  const { error } = await supabase.from("tier_prices").delete().eq("id", tierPriceId);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}
