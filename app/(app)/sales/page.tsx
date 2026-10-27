import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, date, money, sum, today } from "@/lib/format";
import { createSO } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  Empty,
  ErrorBanner,
  PageHeader,
  Section,
  STATUS_LABELS,
  StatusBadge,
  Tabs,
} from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

const FILTERS: Record<string, string[] | null> = {
  open: ["draft", "confirmed", "fulfilled", "completed"],
  draft: ["draft"],
  confirmed: ["confirmed"],
  fulfilled: ["fulfilled"],
  completed: ["completed"],
  invoiced: ["invoiced"],
  cancelled: ["cancelled"],
  recurring: ["draft"],
  all: null,
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const { status = "open", customer, error } = await searchParams;
  const { supabase, profile } = await getSession();

  let query = supabase
    .from("sales_orders")
    .select(
      "id, so_number, status, order_date, ship_date, must_check, source, customers(name), sales_order_lines(qty, unit_price)",
    )
    .order(status === "recurring" ? "ship_date" : "created_at", {
      ascending: status === "recurring",
    })
    .limit(200);
  const statuses = FILTERS[status] ?? null;
  if (statuses) query = query.in("status", statuses);
  // Planned recurring drafts wait under "Recurring (planned)" until a week before they ship.
  const soon = addDays(today(), 7);
  if (status === "recurring") query = query.not("recurring_id", "is", null);
  else if (status === "open" || status === "draft")
    query = query.or(
      `recurring_id.is.null,status.neq.draft,customized.eq.true,ship_date.lte.${soon}`,
    );
  const [{ data: orders }, { data: customers }] = await Promise.all([
    query,
    supabase
      .from("customers")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ]);

  return (
    <>
      <PageHeader
        title="Sales orders"
        subtitle="Draft → Ready to pull → Pulled → Completed → Invoiced"
      >
        <Link href="/sales/recurring" className="btn">
          Recurring orders
        </Link>
        <a href="/export/sales-orders" className="btn">
          Export CSV
        </a>
      </PageHeader>
      <ErrorBanner error={error} />

      {can(profile, "sales") && (
        <Section title="New sales order">
          {!customers?.length ? (
            <Empty>
              Add a{" "}
              <Link href="/customers" className="link">
                customer
              </Link>{" "}
              first.
            </Empty>
          ) : (
            <form
              action={createSO}
              className="card flex flex-wrap items-end gap-3"
            >
              <label className="min-w-56 flex-1">
                <span className="label">Customer</span>
                <select
                  name="customer_id"
                  className="input"
                  defaultValue={customer ?? ""}
                  required
                >
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
                <input
                  name="ship_date"
                  type="date"
                  className="input"
                  defaultValue={today()}
                />
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
          label:
            k === "recurring"
              ? "Recurring (planned)"
              : STATUS_LABELS[k] ?? k[0].toUpperCase() + k.slice(1),
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
                    <Link
                      href={`/sales/${o.id}`}
                      className="link font-medium whitespace-nowrap"
                    >
                      {o.so_number}
                    </Link>
                    {o.source === "web" && (
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">Web</span>
                    )}
                    {o.must_check && (
                      <span className="ml-2 rounded border border-red-600 px-1 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap text-red-600">
                        MUST CHECK
                      </span>
                    )}
                  </td>
                  <td>{o.customers?.name}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>{date(o.order_date)}</td>
                  <td>{date(o.ship_date)}</td>
                  <td className="num">
                    {money(
                      sum(
                        o.sales_order_lines,
                        (l: any) => l.qty * l.unit_price,
                      ),
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
