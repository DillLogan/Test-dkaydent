import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { loadRepShop } from "@/lib/repShopData";
import { CartView } from "@/components/shop/Shop";
import { PageHeader } from "@/components/ui";
import { repPlaceOrder, repPullOnline, repSaveCartDetails, repSetCartQty } from "../actions";

type SP = Promise<Record<string, string | undefined>>;

/** The rep's cart for a customer, with the live order summary to read back to them or print. */
export default async function CustomerCartPage({ searchParams }: { searchParams: SP }) {
  const { c, error, placed, so } = await searchParams;
  if (!c) redirect("/customer-shop");
  const { supabase, profile } = await requireRole("sales");
  const d = await loadRepShop(supabase, profile.id, c);
  if (!d) redirect("/customer-shop");
  return (
    <>
      <PageHeader title={`Cart for ${d.me.name}`} subtitle="Check the order summary with the customer, then place the order. It is approved and ready to pull." back={{ href: `/customer-shop?c=${c}`, label: d.me.name }}>
        <Link href={`/customer-shop?c=${c}`} className="btn">
          Keep shopping
        </Link>
      </PageHeader>
      <CartView
        me={d.me}
        catalog={d.catalog}
        cart={d.cart}
        payment={d.payment}
        notes={d.notes}
        placed={placed}
        placedId={so}
        error={error}
        actions={{ setCartQty: repSetCartQty.bind(null, c), saveCartDetails: repSaveCartDetails.bind(null, c), placeOrder: repPlaceOrder.bind(null, c) }}
        mode={{ shopHref: `/customer-shop?c=${c}`, cartHref: `/customer-shop/cart?c=${c}`, rep: { onlineCount: d.onlineCount, pullOnline: repPullOnline.bind(null, c) } }}
      />
    </>
  );
}
