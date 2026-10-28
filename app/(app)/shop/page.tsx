import { getSession } from "@/lib/auth";
import { date, money } from "@/lib/format";
import { Cart, type CatalogItem } from "@/components/Cart";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
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
        subtitle={ready ? `Ordering for ${(me as any).name}. Orders are sent to us for approval.` : "Your login is waiting to be set up."}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />
      {!ready ? (
        <div className="card text-sm text-stone-600">
          Your account has not been set up and verified yet. Please contact us and we will get you started.
        </div>
      ) : (
        <>
          <Cart items={(catalog ?? []) as CatalogItem[]} action={checkout} submitLabel="Send order" />
          <Section title="Your recent orders">
            <div className="space-y-2">
              {((orders ?? []) as any[]).length === 0 && <p className="text-sm text-stone-500">No orders yet.</p>}
              {((orders ?? []) as any[]).map((o) => (
                <div key={o.so_number} className="card flex justify-between text-sm">
                  <span>
                    {date(o.order_date)} · {o.status === "draft" ? "Waiting for approval" : o.status}
                  </span>
                  <span className="font-medium">{money(o.total)}</span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </>
  );
}
