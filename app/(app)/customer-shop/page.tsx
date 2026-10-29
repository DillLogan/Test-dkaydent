import { requireRole } from "@/lib/auth";
import { loadRepShop } from "@/lib/repShopData";
import { ShopBrowser } from "@/components/shop/Shop";
import { ErrorBanner, PageHeader } from "@/components/ui";
import { CustomerPicker } from "./CustomerPicker";
import { repPlaceOrder, repPullOnline, repSaveCartDetails, repSetCartQty } from "./actions";

type SP = Promise<Record<string, string | undefined>>;

/** A rep's customer page: shop for a customer who calls or walks in, at their prices, with the same cart they'd see. */
export default async function CustomerShopPage({ searchParams }: { searchParams: SP }) {
  const { c, error } = await searchParams;
  const { supabase, profile } = await requireRole("sales");
  const { data: customers } = await supabase.from("customers").select("id, name, rep_id, route_code, phone").eq("active", true).neq("name", "Walk-in").order("name");
  const d = c ? await loadRepShop(supabase, profile.id, c) : null;
  return (
    <>
      <PageHeader title="Customer page" subtitle="Shop for a customer who calls or walks in. You see their prices and stock, build their cart, and place an approved order." />
      <ErrorBanner error={error} />
      <CustomerPicker customers={customers ?? []} me={profile.id} current={c} base="/customer-shop" />
      {d && (
        <ShopBrowser
          key={c}
          me={d.me}
          catalog={d.catalog}
          orders={d.orders}
          cart={d.cart}
          payment={d.payment}
          actions={{ setCartQty: repSetCartQty.bind(null, c!), saveCartDetails: repSaveCartDetails.bind(null, c!), placeOrder: repPlaceOrder.bind(null, c!) }}
          mode={{ shopHref: `/customer-shop?c=${c}`, cartHref: `/customer-shop/cart?c=${c}`, rep: { onlineCount: d.onlineCount, pullOnline: repPullOnline.bind(null, c!) } }}
        />
      )}
    </>
  );
}
