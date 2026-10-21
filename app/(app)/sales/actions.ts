"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";
import { today } from "@/lib/format";

export async function createSO(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const customer_id = str(fd, "customer_id");
  if (!customer_id) fail("/sales", "Choose a customer.");
  const { data, error } = await supabase
    .from("sales_orders")
    .insert({ customer_id, ship_date: str(fd, "ship_date") })
    .select("id")
    .single();
  if (error) fail("/sales", dbMessage(error));
  revalidatePath("/sales");
  redirect(`/sales/${data.id}`);
}

export async function updateSO(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `/sales/${id}`;
  const { error } = await supabase
    .from("sales_orders")
    .update({ ship_date: str(fd, "ship_date"), notes: str(fd, "notes") })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Saved.")}`);
}

export async function addSOLine(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `/sales/${id}`;
  const product_id = str(fd, "product_id");
  const unit_id = str(fd, "unit_id");
  const qty = num(fd, "qty");
  const unit_price = num(fd, "unit_price");
  if (!product_id || !unit_id || !qty || qty <= 0 || unit_price === null || unit_price < 0) {
    fail(path, "Choose a product and unit, and enter a quantity and price.");
  }
  const { error } = await supabase.from("sales_order_lines").insert({ so_id: id, product_id, unit_id, qty, unit_price });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}

export async function removeSOLine(id: string, lineId: string) {
  const { supabase } = await requireRole("sales");
  const path = `/sales/${id}`;
  const { error } = await supabase.from("sales_order_lines").delete().eq("id", lineId);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(path);
}

export async function setSOStatus(id: string, status: "draft" | "confirmed" | "cancelled") {
  const { supabase } = await requireRole("sales");
  const path = `/sales/${id}`;
  if (status === "confirmed") {
    const { count } = await supabase
      .from("sales_order_lines")
      .select("id", { count: "exact", head: true })
      .eq("so_id", id);
    if (!count) fail(path, "Add at least one line before confirming.");
  }
  const { error } = await supabase.from("sales_orders").update({ status }).eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/sales");
  redirect(path);
}

export async function deleteSO(id: string) {
  const { supabase } = await requireRole("sales");
  const { error, count } = await supabase.from("sales_orders").delete({ count: "exact" }).eq("id", id);
  if (error) fail(`/sales/${id}`, dbMessage(error));
  if (!count) fail(`/sales/${id}`, "Only draft orders can be deleted.");
  revalidatePath("/sales");
  redirect("/sales");
}

export async function fulfillSO(id: string) {
  const { supabase } = await requireRole("sales", "warehouse");
  const path = `/sales/${id}`;
  const { error } = await supabase.rpc("fulfill_sales_order", { p_so_id: id });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/inventory");
  redirect(`${path}?message=${encodeURIComponent("Stock pulled (oldest lots first). Ready to invoice.")}`);
}

export async function invoiceSO(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `/sales/${id}`;
  const { data, error } = await supabase.rpc("create_invoice", { p_so_id: id, p_tax_rate: num(fd, "tax_rate") ?? 0 });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/invoices");
  redirect(`/invoices/${data}`);
}

export async function setInvoiceStatus(id: string, status: "paid" | "void" | "open") {
  const { supabase } = await requireRole("sales");
  const path = `/invoices/${id}`;
  const { error } = await supabase
    .from("invoices")
    .update({ status, paid_at: status === "paid" ? today() : null })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/invoices");
  redirect(path);
}
