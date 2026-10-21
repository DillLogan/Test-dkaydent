"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { bool, dbMessage, fail, str } from "@/lib/forms";

function vendorFields(fd: FormData) {
  return {
    name: str(fd, "name"),
    kind: str(fd, "kind") ?? "grower",
    contact_name: str(fd, "contact_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    country: str(fd, "country"),
    payment_terms: str(fd, "payment_terms"),
    notes: str(fd, "notes"),
  };
}

export async function createVendor(fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const fields = vendorFields(fd);
  if (!fields.name) fail("/vendors", "Vendor name is required.");
  const { data, error } = await supabase.from("vendors").insert(fields).select("id").single();
  if (error) fail("/vendors", dbMessage(error));
  revalidatePath("/vendors");
  redirect(`/vendors/${data.id}`);
}

export async function updateVendor(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `/vendors/${id}`;
  const fields = vendorFields(fd);
  if (!fields.name) fail(path, "Vendor name is required.");
  const { error } = await supabase.from("vendors").update({ ...fields, active: bool(fd, "active") }).eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Saved.")}`);
}
