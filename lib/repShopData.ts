import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogItem, HistoryOrder } from "@/components/Cart";
import type { CartRow, ShopMe } from "./shopData";

/** The customer page for a rep: the customer's prices, the rep's saved cart for them, their online cart and past orders. */
export async function loadRepShop(supabase: SupabaseClient, repId: string, customerId: string) {
  const [{ data: c }, { data: catalog }, { data: items }, { data: cart }, { data: online }, { data: orders }] = await Promise.all([
    supabase.from("customers").select("id, name, default_payment, cash_discount_pct, profiles:rep_id(full_name, email)").eq("id", customerId).eq("active", true).maybeSingle(),
    supabase.rpc("catalog_staff", { p_customer_id: customerId }),
    supabase.from("rep_cart_items").select("unit_id, qty, saved_for_later, added_at").eq("rep_id", repId).eq("customer_id", customerId).order("added_at"),
    supabase.from("rep_carts").select("payment, notes").eq("rep_id", repId).eq("customer_id", customerId).maybeSingle(),
    supabase.rpc("rep_customer_online_cart", { p_customer_id: customerId }),
    supabase
      .from("sales_orders")
      .select("so_number, status, order_date, payment_type, denied_reason, sales_order_lines(unit_id, qty, unit_price, products(name), product_units(name))")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (!c) return null;
  const rep = (c.profiles as unknown as { full_name: string | null; email: string | null } | null) ?? null;
  const me: ShopMe = { customer_id: c.id, name: c.name, rep: rep?.full_name || rep?.email || null, default_payment: c.default_payment, cash_discount_pct: Number(c.cash_discount_pct ?? 0), card_fee_pct: Number((await supabase.rpc("card_fee_pct")).data ?? 0) };
  const hist: HistoryOrder[] = (orders ?? []).map((o: any) => ({
    so_number: o.so_number,
    status: o.status,
    order_date: o.order_date,
    payment_type: o.payment_type,
    denied_reason: o.denied_reason,
    total: (o.sales_order_lines ?? []).reduce((n: number, l: any) => n + Number(l.qty) * Number(l.unit_price), 0),
    lines: (o.sales_order_lines ?? []).map((l: any) => ({ unit_id: l.unit_id, name: l.products?.name ?? "", unit: l.product_units?.name ?? "", qty: Number(l.qty), unit_price: Number(l.unit_price) })),
  }));
  return {
    me,
    catalog: ((catalog ?? []) as CatalogItem[]).map((x) => ({ ...x, price: Number(x.price), available: x.available === null ? null : Number(x.available) })),
    cart: ((items ?? []) as any[]).map((r): CartRow => ({ unit_id: r.unit_id, qty: Number(r.qty), saved: r.saved_for_later, added_at: r.added_at })),
    payment: (cart?.payment as string | null) ?? null,
    notes: (cart?.notes as string | null) ?? "",
    onlineCount: ((online ?? []) as unknown[]).length,
    orders: hist,
  };
}
