"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { bool, dbMessage, fail, int, num, str } from "@/lib/forms";

function customerFields(fd: FormData) {
  return {
    name: str(fd, "name"),
    contact_name: str(fd, "contact_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    address: str(fd, "address"),
    delivery_address: str(fd, "delivery_address"),
    price_tier_id: str(fd, "price_tier_id"),
    discount_pct: Math.min(100, Math.max(0, num(fd, "discount_pct") ?? 0)),
    cash_discount_pct: Math.min(100, Math.max(0, num(fd, "cash_discount_pct") ?? 0)),
    route_code: (str(fd, "route_code") ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || null,
    rep_id: str(fd, "rep_id"),
    default_payment: ["cash", "card", "check"].includes(str(fd, "default_payment") ?? "") ? str(fd, "default_payment") : null,
    payment_terms_days: int(fd, "payment_terms_days") ?? 30,
    resale_certificate: str(fd, "resale_certificate"),
    notes: str(fd, "notes"),
  };
}

export async function createCustomer(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const fields = customerFields(fd);
  if (!fields.name) fail("/customers", "Business name is required.");
  const { data, error } = await supabase.from("customers").insert(fields).select("id").single();
  if (error) fail("/customers", dbMessage(error));
  revalidatePath("/customers");
  redirect(`/customers/${data.id}`);
}

export async function updateCustomer(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `/customers/${id}`;
  const fields = customerFields(fd);
  if (!fields.name) fail(path, "Business name is required.");
  const { error } = await supabase.from("customers").update({ ...fields, active: bool(fd, "active") }).eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Saved.")}`);
}

export async function createTier(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const name = str(fd, "name");
  const markup = num(fd, "markup_pct");
  if (!name || markup === null) fail("/customers/tiers", "Enter a tier name and markup.");
  const { error } = await supabase.from("price_tiers").insert({ name, markup_pct: markup });
  if (error) fail("/customers/tiers", dbMessage(error));
  revalidatePath("/customers/tiers");
  redirect("/customers/tiers");
}

export async function updateTier(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const name = str(fd, "name");
  const markup = num(fd, "markup_pct");
  if (!name || markup === null) fail("/customers/tiers", "Enter a tier name and markup.");
  const { error } = await supabase.from("price_tiers").update({ name, markup_pct: markup }).eq("id", id);
  if (error) fail("/customers/tiers", dbMessage(error));
  revalidatePath("/customers/tiers");
  redirect("/customers/tiers?message=" + encodeURIComponent("Tier updated."));
}
