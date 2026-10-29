"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { dbMessage, fail } from "@/lib/forms";

type Result = { error?: string; available?: number };

/** Put an item in the cart, change how many, move it to/from Saved for later, or take it out (qty 0). Saved on the account. */
export async function setCartQty(unitId: string, qty: number, saved?: boolean): Promise<Result> {
  const { supabase } = await getSession();
  const { data, error } = await supabase.rpc("portal_cart_set", { p_unit_id: unitId, p_qty: Math.max(0, Math.floor(Number(qty) || 0)), p_saved: saved ?? null });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/shop");
  return { available: (data as { available?: number } | null)?.available };
}

/** How they'll pay and any notes, kept with the cart. */
export async function saveCartDetails(payment: string | null, notes: string): Promise<Result> {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("portal_cart_details", { p_payment: payment || null, p_notes: notes });
  if (error) return { error: dbMessage(error) };
  return {};
}

/** Place the order from the saved cart; it goes to the rep for approval. */
export async function placeOrder() {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("portal_cart_checkout");
  if (error) fail("/shop/cart", dbMessage(error));
  const { data: orders } = await supabase.rpc("portal_orders");
  const so = (orders as { so_number: string }[] | null)?.[0]?.so_number ?? "";
  revalidatePath("/shop");
  redirect(`/shop/cart?placed=${encodeURIComponent(so)}`);
}

/** Kept for the staff sales catalog's cart, which still sends lines straight to an order. */
export async function checkout(fd: FormData) {
  const { supabase } = await getSession();
  let lines: unknown;
  try {
    lines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    fail("/shop", "The cart could not be read.");
  }
  const { error } = await supabase.rpc("portal_checkout", { p_lines: lines, p_notes: String(fd.get("notes") ?? ""), p_payment: String(fd.get("payment") ?? "") || null });
  if (error) fail("/shop", dbMessage(error));
  revalidatePath("/shop");
  redirect(`/shop?message=${encodeURIComponent("Thanks. Your order was sent to us for approval.")}`);
}
