import { getSession } from "@/lib/auth";
import { Cart, type CatalogItem, type HistoryOrder } from "@/components/Cart";
import { ErrorBanner, Notice, PageHeader } from "@/components/ui";
import { checkout } from "./actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function ShopPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase } = await getSession();
  const [{ data: me }, { data: catalog }, { data: orders }] = await Promise.all([
    supabase.rpc("portal_me"),
    supabase.rpc("portal_catalog"),
    supabase.rpc("portal_orders"),
  ]);
  const ready = !!(me as any)?.customer_id;
  return (
    <>
      <PageHeader
        title="Shop"
        subtitle={ready ? `Ordering for ${(me as any).name}${(me as any).rep ? ` · your rep is ${(me as any).rep}` : ""}. Orders are sent to us for approval.` : "Your login is waiting to be set up."}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />
      {!ready ? (
        <div className="card text-sm text-stone-600">
          Your account has not been set up and verified yet. Please contact us and we will get you started.
        </div>
      ) : (
        <>
          <Cart
            items={(catalog ?? []) as CatalogItem[]}
            action={checkout}
            submitLabel="Send order"
            payment={{ usual: (me as any).default_payment ?? null, cashPct: Number((me as any).cash_discount_pct ?? 0) }}
            history={(orders ?? []) as HistoryOrder[]}
          />
        </>
      )}
    </>
  );
}
