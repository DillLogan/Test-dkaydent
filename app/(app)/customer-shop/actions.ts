"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail } from "@/lib/forms";

/** A rep's saved cart for one customer (bound to the customer on the page). */
export async function repSetCartQty(customerId: string, unitId: string, qty: number, saved?: boolean) {
  const { supabase } = await requireRole("sales");
  const { data, error } = await supabase.rpc("rep_cart_set", { p_customer_id: customerId, p_unit_id: unitId, p_qty: Math.max(0, Math.floor(Number(qty) || 0)), p_saved: saved ?? null });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/customer-shop");
  return { available: (data as { available?: number } | null)?.available };
}

export async function repSaveCartDetails(customerId: string, payment: string | null, notes: string) {
  const { supabase } = await requireRole("sales");
  const { error } = await supabase.rpc("rep_cart_details", { p_customer_id: customerId, p_payment: payment || null, p_notes: notes });
  return error ? { error: dbMessage(error) } : {};
}

export async function repPullOnline(customerId: string) {
  const { supabase } = await requireRole("sales");
  const { error } = await supabase.rpc("rep_cart_pull_online", { p_customer_id: customerId });
  revalidatePath("/customer-shop");
  return error ? { error: dbMessage(error) } : {};
}

/** Place the order for the customer, already approved (Ready to pull). */
export async function repPlaceOrder(customerId: string) {
  const { supabase } = await requireRole("sales");
  const back = `/customer-shop/cart?c=${customerId}`;
  const { data: id, error } = await supabase.rpc("rep_cart_checkout", { p_customer_id: customerId });
  if (error) fail(back, dbMessage(error));
  const { data: so } = await supabase.from("sales_orders").select("so_number").eq("id", id as string).single();
  revalidatePath("/customer-shop");
  revalidatePath("/sales");
  redirect(`${back}&placed=${encodeURIComponent(so?.so_number ?? "")}&so=${encodeURIComponent(String(id))}`);
}
