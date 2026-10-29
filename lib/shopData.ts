import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogItem, HistoryOrder } from "@/components/Cart";

export type CartRow = { unit_id: string; qty: number; saved: boolean; added_at: string };
export type ShopMe = { customer_id: string; name: string; rep: string | null; default_payment: string | null; cash_discount_pct: number; card_fee_pct?: number };

/** Everything the customer's shop pages need: who they are, what they can buy at their prices, their saved cart and past orders. */
export async function loadShop(supabase: SupabaseClient) {
  const [{ data: me }, { data: catalog }, { data: orders }, { data: items }, { data: cart }] = await Promise.all([
    supabase.rpc("portal_me"),
    supabase.rpc("portal_catalog"),
    supabase.rpc("portal_orders"),
    supabase.from("portal_cart_items").select("unit_id, qty, saved_for_later, added_at").order("added_at"),
    supabase.from("portal_carts").select("payment, notes").maybeSingle(),
  ]);
  const { data: fee } = await supabase.rpc("card_fee_pct");
  return {
    me: me ? { ...(me as ShopMe), card_fee_pct: Number(fee ?? 0) } : null,
    catalog: ((catalog ?? []) as CatalogItem[]).map((c) => ({ ...c, price: Number(c.price), available: c.available === null ? null : Number(c.available) })),
    orders: (orders ?? []) as HistoryOrder[],
    cart: ((items ?? []) as { unit_id: string; qty: number; saved_for_later: boolean; added_at: string }[]).map((r): CartRow => ({ unit_id: r.unit_id, qty: Number(r.qty), saved: r.saved_for_later, added_at: r.added_at })),
    payment: (cart?.payment as string | null) ?? null,
    notes: (cart?.notes as string | null) ?? "",
  };
}
