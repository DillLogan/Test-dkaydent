import { getSession } from "@/lib/auth";
import { loadShop } from "@/lib/shopData";
import { ShopBrowser } from "@/components/shop/Shop";
import { ErrorBanner, Notice, PageHeader } from "@/components/ui";
import { placeOrder, saveCartDetails, setCartQty } from "./actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function ShopPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase } = await getSession();
  const d = await loadShop(supabase);
  const me = d.me;
  return (
    <>
      <PageHeader
        title="Shop"
        subtitle={me ? `Ordering for ${me.name}${me.rep ? ` · your rep is ${me.rep}` : ""}. Your cart is saved on your account; orders are sent to us for approval.` : "Your login is waiting to be set up."}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />
      {!me ? (
        <div className="card text-sm text-stone-600">Your account has not been set up and verified yet. Please contact us and we will get you started.</div>
      ) : (
        <ShopBrowser me={me} catalog={d.catalog} orders={d.orders} cart={d.cart} payment={d.payment} actions={{ setCartQty, saveCartDetails, placeOrder }} />
      )}
    </>
  );
}
