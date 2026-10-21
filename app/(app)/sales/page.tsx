import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, money, sum, today } from "@/lib/format";
import { createSO } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, PageHeader, Section, StatusBadge, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

const FILTERS: Record<string, string[] | null> = {
  open: ["draft", "confirmed"],
  draft: ["draft"],
  confirmed: ["confirmed"],
  fulfilled: ["fulfilled"],
  invoiced: ["invoiced"],
  cancelled: ["cancelled"],
  all: null,
};

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const { status = "open", customer, error } = await searchParams;
  const { supabase, profile } = await getSession();

  let query = supabase
    .from("sales_orders")
    .select("id, so_number, status, order_date, ship_date, customers(name), sales_order_lines(qty, unit_price)")
    .order("created_at", { ascending: false })
    .limit(200);
  const statuses = FILTERS[status] ?? null;
  if (statuses) query = query.in("status", statuses);
  const [{ data: orders }, { data: customers }] = await Promise.all([
    query,
    supabase.from("customers").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader title="Sales orders" subtitle="Draft → confirmed → fulfilled (stock pulled) → invoiced" />
      <ErrorBanner error={error} />

      {can(profile, "sales") && (
        <Section title="New sales order">
          {!customers?.length ? (
            <Empty>
              Add a <Link href="/customers" className="link">customer</Link> first.
            </Empty>
          ) : (
            <form action={createSO} className="card flex flex-wrap items-end gap-3">
              <label className="min-w-56 flex-1">
                <span className="label">Customer</span>
                <select name="customer_id" className="input" defaultValue={customer ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Ship / pickup date</span>
                <input name="ship_date" type="date" className="input" defaultValue={today()} />
              </label>
              <SubmitButton>Create draft order</SubmitButton>
            </form>
          )}
        </Section>
      )}

      <Tabs
        current={status}
        items={Object.keys(FILTERS).map((k) => ({
          key: k,
          href: `/sales?status=${k}`,
          label: k[0].toUpperCase() + k.slice(1),
        }))}
      />

      {!orders?.length ? (
        <Empty>No orders here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Ordered</th>
                <th>Ships</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/sales/${o.id}`} className="link font-medium whitespace-nowrap">
                      {o.so_number}
                    </Link>
                  </td>
                  <td>{o.customers?.name}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{date(o.order_date)}</td>
                  <td>{date(o.ship_date)}</td>
                  <td className="num">{money(sum(o.sales_order_lines, (l: any) => l.qty * l.unit_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
