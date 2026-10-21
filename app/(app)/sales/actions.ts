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

export async function setInvoiceStatus(id: string, status: "paid" | "open") {
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

export async function voidInvoice(id: string, soId: string) {
  const { supabase } = await requireRole("sales");
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: id });
  if (error) fail(`/invoices/${id}`, dbMessage(error));
  revalidatePath("/invoices");
  redirect(`/sales/${soId}?message=${encodeURIComponent("Invoice voided. Correct the order if needed, then invoice again.")}`);
}

/** Fulfill using hand-picked lots. `picks` is JSON from the pick form. */
export async function fulfillSOPicked(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales", "warehouse");
  const path = `/sales/${id}`;
  let picks: { so_line_id: string; lot_id: string; qty_base: number }[] = [];
  try {
    picks = JSON.parse(String(fd.get("picks") ?? "[]"));
  } catch {
    picks = [];
  }
  picks = picks.filter((p) => p && p.lot_id && Number(p.qty_base) > 0);
  if (picks.length === 0) fail(path, "Enter quantities to pick, or use Fulfill oldest-first.");
  const { error } = await supabase.rpc("fulfill_sales_order", { p_so_id: id, p_picks: picks });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/inventory");
  redirect(`${path}?message=${encodeURIComponent("Stock pulled from the lots you picked. Ready to invoice.")}`);
}

export async function createReturn(id: string, lineIds: string[], fd: FormData) {
  const { supabase } = await requireRole("sales", "warehouse");
  const path = `/sales/${id}`;
  const lines = lineIds
    .map((lineId) => ({ so_line_id: lineId, qty: num(fd, `rqty_${lineId}`) ?? 0, restock: fd.get(`restock_${lineId}`) === "on" }))
    .filter((l) => l.qty > 0);
  if (lines.length === 0) fail(path, "Enter a quantity to return on at least one line.");
  const { data, error } = await supabase.rpc("create_return", { p_so_id: id, p_lines: lines, p_reason: str(fd, "reason") });
  if (error) fail(path, dbMessage(error));
  const { data: r } = await supabase.from("returns").select("return_number, total").eq("id", data).single();
  revalidatePath(path);
  revalidatePath("/inventory");
  revalidatePath("/returns");
  redirect(`${path}?message=${encodeURIComponent(`${r?.return_number ?? "Return"} recorded. Customer credit $${Number(r?.total ?? 0).toFixed(2)}.`)}`);
}

export async function setCreditStatus(returnId: string, status: "open" | "applied" | "refunded", back: string) {
  const { supabase } = await requireRole("sales");
  const { error } = await supabase.from("returns").update({ credit_status: status }).eq("id", returnId);
  if (error) fail(back, dbMessage(error));
  revalidatePath(back);
  revalidatePath("/returns");
  redirect(back);
}
