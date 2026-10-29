import Link from "next/link";
import { getSession } from "@/lib/auth";
import { loadShop } from "@/lib/shopData";
import { CartView } from "@/components/shop/Shop";
import { PageHeader } from "@/components/ui";
import { placeOrder, saveCartDetails, setCartQty } from "../actions";

type SP = Promise<Record<string, string | undefined>>;

/** The cart and its live order summary (what the order will come to), saved on the customer's account. */
export default async function CartPage({ searchParams }: { searchParams: SP }) {
  const { error, placed } = await searchParams;
  const { supabase } = await getSession();
  const d = await loadShop(supabase);
  if (!d.me) return <div className="card text-sm text-stone-600">Your account has not been set up and verified yet.</div>;
  return (
    <>
      <PageHeader title="Cart" subtitle="Change amounts, save items for later, and check your order summary before you place the order." back={{ href: "/shop", label: "Shop" }}>
        <Link href="/shop" className="btn">
          Keep shopping
        </Link>
      </PageHeader>
      <CartView me={d.me} catalog={d.catalog} cart={d.cart} payment={d.payment} notes={d.notes} actions={{ setCartQty, saveCartDetails, placeOrder }} placed={placed} error={error} />
    </>
  );
}
