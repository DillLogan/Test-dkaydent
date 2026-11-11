import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, dateTime, qty } from "@/lib/format";
import { setStockDue } from "../../sales/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

// Backorders the reps have confirmed: purchasing sets when the stock is due
export default async function BackordersPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const { data: rows } = await supabase
    .from("sales_orders")
    .select(
      "id, so_number, created_at, bo_confirmed_at, stock_due, backorder_of, customers(name), sales_order_lines(qty, products(name), product_units(name))",
    )
    .eq("status", "backorder")
    .order("created_at");
  const list = rows ?? [];
  const parentIds = [...new Set(list.map((r) => r.backorder_of).filter(Boolean))] as string[];
  const { data: parents } = parentIds.length
    ? await supabase.from("sales_orders").select("id, so_number").in("id", parentIds)
    : { data: [] as { id: string; so_number: string }[] };
  const parentNum = new Map((parents ?? []).map((p) => [p.id, p.so_number]));
  const suggested = new Map<string, string | null>();
  await Promise.all(
    list.map(async (r) => {
      const { data } = await supabase.rpc("backorder_suggested_due", { p_so: r.id });
      suggested.set(r.id, (data as string | null) ?? null);
    }),
  );
  const canBuy = can(profile, "buyer");
  const min = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Backorders"
        subtitle="Items that came off tickets when stock ran short. Set when the stock is due once the rep has confirmed."
        back={{ href: "/purchasing", label: "Purchasing" }}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />
      {!list.length ? (
        <Empty>No open backorders.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="backorders">
            <thead>
              <tr>
                <th>Backorder</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Rep</th>
                <th>Order date (stock due)</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r: any) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/sales/${r.id}`} className="link font-medium">
                      {r.so_number}
                    </Link>
                    {r.backorder_of && parentNum.get(r.backorder_of) && (
                      <div className="text-xs text-stone-500">from {parentNum.get(r.backorder_of)}</div>
                    )}
                  </td>
                  <td>{r.customers?.name}</td>
                  <td className="text-sm">
                    {r.sales_order_lines.map((l: any, i: number) => (
                      <div key={i}>
                        {qty(l.qty)} {l.product_units?.name} {l.products?.name}
                      </div>
                    ))}
                  </td>
                  <td className="text-sm whitespace-nowrap">
                    {r.bo_confirmed_at ? `confirmed ${dateTime(r.bo_confirmed_at)}` : <span className="text-amber-800">waiting for OK</span>}
                  </td>
                  <td>
                    {canBuy && r.bo_confirmed_at ? (
                      <form action={setStockDue.bind(null, r.id, "/purchasing/backorders")} className="flex flex-wrap items-center gap-2">
                        <input
                          name="stock_due"
                          type="date"
                          className="input w-40"
                          min={min}
                          defaultValue={r.stock_due ?? suggested.get(r.id) ?? ""}
                          aria-label={`Stock due for ${r.so_number}`}
                          required
                        />
                        <SubmitButton className="btn btn-sm" pendingText="…">
                          {r.stock_due ? "Change" : "Set"}
                        </SubmitButton>
                        <span className="w-full text-xs text-stone-500">
                          {r.stock_due
                            ? `set to ${date(r.stock_due)}`
                            : suggested.get(r.id)
                              ? `suggested from the next incoming delivery`
                              : "nothing on order for this yet"}
                        </span>
                      </form>
                    ) : r.stock_due ? (
                      date(r.stock_due)
                    ) : (
                      <span className="text-stone-500">not set</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
