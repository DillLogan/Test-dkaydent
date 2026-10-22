import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { dateTime, money, qty, sum } from "@/lib/format";
import { setCreditStatus } from "../sales/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, PageHeader, StatusBadge, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function ReturnsPage({ searchParams }: { searchParams: SP }) {
  const { status = "open", error } = await searchParams;
  const { supabase, profile } = await getSession();

  let q = supabase
    .from("returns")
    .select("*, customers(id, name), sales_orders(id, so_number), return_lines(qty, qty_base, restock, products(name, base_unit))")
    .order("created_at", { ascending: false })
    .limit(300);
  if (["open", "applied", "refunded"].includes(status)) q = q.eq("credit_status", status);
  const { data: returns } = await q;
  const canEdit = can(profile, "sales");
  const back = `/returns?status=${status}`;

  return (
    <>
      <PageHeader
        title="Returns & credits"
        subtitle={`${returns?.length ?? 0} shown · ${money(sum(returns, (r) => r.total))} in credits. Record a return from a fulfilled or invoiced sales order.`}
      >
        <a href="/export/returns" className="btn">
          Export CSV
        </a>
      </PageHeader>
      <ErrorBanner error={error} />
      <Tabs
        current={status}
        items={["open", "applied", "refunded", "all"].map((k) => ({
          key: k,
          href: `/returns?status=${k}`,
          label: k[0].toUpperCase() + k.slice(1),
        }))}
      />
      {!returns?.length ? (
        <Empty>No returns here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Return</th>
                <th>Customer</th>
                <th>Order</th>
                <th>When</th>
                <th>Items</th>
                <th className="num">Credit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r: any) => (
                <tr key={r.id}>
                  <td className="font-medium whitespace-nowrap">{r.return_number}</td>
                  <td>
                    <Link href={`/customers/${r.customers?.id}`} className="link">
                      {r.customers?.name}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/sales/${r.sales_orders?.id}`} className="link whitespace-nowrap">
                      {r.sales_orders?.so_number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{dateTime(r.created_at)}</td>
                  <td>
                    {r.return_lines.map((l: any, i: number) => (
                      <div key={i} className="text-sm">
                        {qty(l.qty_base)} {l.products?.base_unit} {l.products?.name}{" "}
                        <span className={l.restock ? "text-brand-700" : "text-red-700"}>
                          ({l.restock ? "restocked" : "written off"})
                        </span>
                      </div>
                    ))}
                    {r.reason && <div className="text-xs text-stone-500">{r.reason}</div>}
                  </td>
                  <td className="num">{money(r.total)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={r.credit_status} />
                      {canEdit && r.credit_status === "open" && (
                        <>
                          <form action={setCreditStatus.bind(null, r.id, "applied", back)}>
                            <SubmitButton className="btn btn-sm" pendingText="…">
                              Applied
                            </SubmitButton>
                          </form>
                          <form action={setCreditStatus.bind(null, r.id, "refunded", back)}>
                            <SubmitButton className="btn btn-sm" pendingText="…">
                              Refunded
                            </SubmitButton>
                          </form>
                        </>
                      )}
                    </div>
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
