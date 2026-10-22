"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";
import { today } from "@/lib/format";

export async function createPO(fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const vendor_id = str(fd, "vendor_id");
  if (!vendor_id) fail("/purchasing", "Choose a vendor.");
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({ vendor_id, expected_date: str(fd, "expected_date"), notes: str(fd, "notes") })
    .select("id")
    .single();
  if (error) fail("/purchasing", dbMessage(error));
  revalidatePath("/purchasing");
  redirect(`/purchasing/${data.id}`);
}

export async function updatePO(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `/purchasing/${id}`;
  const { error } = await supabase
    .from("purchase_orders")
    .update({
      order_date: str(fd, "order_date"),
      expected_date: str(fd, "expected_date"),
      freight_cost: num(fd, "freight_cost") ?? 0,
      other_cost: num(fd, "other_cost") ?? 0,
      notes: str(fd, "notes"),
    })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Saved.")}`);
}

export async function addPOLine(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `/purchasing/${id}`;
  const product_id = str(fd, "product_id");
  const unit_id = str(fd, "unit_id");
  const qty = num(fd, "qty");
  const unit_cost = num(fd, "unit_cost");
  if (!product_id || !unit_id || !qty || qty <= 0 || unit_cost === null || unit_cost < 0) {
    fail(path, "Choose a product and unit, and enter a quantity and cost.");
  }
  const { error } = await supabase.from("purchase_order_lines").insert({ po_id: id, product_id, unit_id, qty, unit_cost });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}

export async function removePOLine(id: string, lineId: string) {
  const { supabase } = await requireRole("buyer");
  const path = `/purchasing/${id}`;
  const { error } = await supabase.from("purchase_order_lines").delete().eq("id", lineId);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}

export async function setPOStatus(id: string, status: "draft" | "ordered" | "cancelled") {
  const { supabase } = await requireRole("buyer");
  const path = `/purchasing/${id}`;
  if (status === "ordered") {
    const { count } = await supabase
      .from("purchase_order_lines")
      .select("id", { count: "exact", head: true })
      .eq("po_id", id);
    if (!count) fail(path, "Add at least one line before marking the PO as ordered.");
    const { data: po } = await supabase.from("purchase_orders").select("order_date").eq("id", id).single();
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status, order_date: po?.order_date ?? today() })
      .eq("id", id);
    if (error) fail(path, dbMessage(error));
  } else {
    const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
    if (error) fail(path, dbMessage(error));
  }
  revalidatePath(path);
  revalidatePath("/purchasing");
  redirect(path);
}

export async function deletePO(id: string) {
  const { supabase } = await requireRole("buyer");
  const { error, count } = await supabase.from("purchase_orders").delete({ count: "exact" }).eq("id", id);
  if (error) fail(`/purchasing/${id}`, dbMessage(error));
  if (!count) fail(`/purchasing/${id}`, "Only draft purchase orders can be deleted.");
  revalidatePath("/purchasing");
  redirect("/purchasing");
}

export async function closePO(id: string) {
  const { supabase } = await requireRole("buyer");
  const path = `/purchasing/${id}`;
  const { error } = await supabase.rpc("close_po", { p_po_id: id });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("PO closed. Remaining quantities will not be received.")}`);
}

export async function receivePO(id: string, lineIds: string[], fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `/purchasing/${id}`;
  const defaultLocation = str(fd, "default_location");
  const lines = lineIds
    .map((lineId) => ({
      line_id: lineId,
      qty: num(fd, `qty_${lineId}`) ?? 0,
      location_id: str(fd, `loc_${lineId}`) ?? defaultLocation,
      expires_at: str(fd, `exp_${lineId}`),
      lot_code: str(fd, `lot_${lineId}`),
    }))
    .filter((l) => l.qty > 0);
  if (lines.length === 0) fail(path, "Enter a received quantity for at least one line.");
  const { error } = await supabase.rpc("receive_po", { p_po_id: id, p_lines: lines });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/inventory");
  redirect(`${path}?message=${encodeURIComponent("Received into inventory.")}`);
}
