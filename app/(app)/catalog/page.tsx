import { requireRole } from "@/lib/auth";
import { CatalogCart, type StaffItem } from "@/components/CatalogCart";
import { ErrorBanner, Notice, PageHeader } from "@/components/ui";
import { catalogCheckout, saveItemPrices } from "./actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function CatalogPage({ searchParams }: { searchParams: SP }) {
  const { error, message, c } = await searchParams;
  const { supabase } = await requireRole("sales");
  const { data: customers } = await supabase.from("customers").select("id, name, price_tier_id, discount_pct, cash_discount_pct, default_payment").eq("active", true).order("name");
  const cust = (customers ?? []).find((x) => x.id === c);
  let items: StaffItem[] = [];
  let tierName: string | null = null;
  let err = error;
  if (cust) {
    const [{ data, error: e }, { data: tier }] = await Promise.all([
      supabase.rpc("catalog_staff", { p_customer_id: cust.id }),
      cust.price_tier_id ? supabase.from("price_tiers").select("name").eq("id", cust.price_tier_id).single() : Promise.resolve({ data: null }),
    ]);
    if (e) err = e.message;
    items = (data ?? []) as StaffItem[];
    tierName = (tier as any)?.name ?? null;
  }
  return (
    <>
      <PageHeader
        title="Sales catalog"
        subtitle="Pick a customer, add items to a cart for them and create a draft order. Prices can be changed on each item."
      />
      <ErrorBanner error={err} />
      <Notice message={message} />
      <form className="card mb-6 flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1">
          <span className="label">Customer</span>
          <select name="c" className="input" defaultValue={cust?.id ?? ""} required>
            <option value="">Choose a customer</option>
            {(customers ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn">Open</button>
        {cust && (
          <span className="pb-2 text-sm text-stone-500">
            {tierName ? `${tierName} tier` : "No tier"} · {Number(cust.discount_pct)}% discount. Change the discount on the customer page.
          </span>
        )}
      </form>
      {cust && (
        <CatalogCart
          key={cust.id}
          items={items}
          customerId={cust.id}
          tierId={cust.price_tier_id}
          tierName={tierName}
          payment={{ usual: cust.default_payment, cashPct: Number(cust.cash_discount_pct ?? 0) }}
          checkoutAction={catalogCheckout}
          priceAction={saveItemPrices}
        />
      )}
    </>
  );
}
