import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, date, today } from "@/lib/format";
import { CADENCE_LABEL } from "@/lib/receiving";
import { createRecurringSale } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  Empty,
  ErrorBanner,
  Field,
  Notice,
  PageHeader,
  Section,
} from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function RecurringSalesPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const { error, message, customer } = await searchParams;
  const { supabase, profile } = await getSession();
  const canSell = can(profile, "sales");
  const now = today();

  // Keep the next 12 months planned and drafts at current prices.
  if (canSell) await supabase.rpc("generate_recurring_sales");

  let list = supabase
    .from("recurring_sales")
    .select(
      "id, name, cadence, start_date, end_date, active, customer_id, customers(name), recurring_sale_lines(id)",
    )
    .order("active", { ascending: false })
    .order("name");
  if (customer) list = list.eq("customer_id", customer);
  const [{ data: rows }, { data: customers }, { data: upcoming }] =
    await Promise.all([
      list,
      supabase
        .from("customers")
        .select("id, name")
        .eq("active", true)
        .neq("name", "Walk-in")
        .order("name"),
      supabase
        .from("sales_orders")
        .select("recurring_id, occurrence_date")
        .not("recurring_id", "is", null)
        .in("status", ["draft", "confirmed"])
        .gte("occurrence_date", now)
        .order("occurrence_date"),
    ]);
  const next = new Map<string, { date: string; count: number }>();
  for (const u of upcoming ?? []) {
    const x = next.get(u.recurring_id);
    next.set(
      u.recurring_id,
      x ? { ...x, count: x.count + 1 } : { date: u.occurrence_date, count: 1 },
    );
  }
  const forCustomer = customer
    ? customers?.find((c) => c.id === customer)
    : null;

  return (
    <>
      <PageHeader
        title="Recurring orders"
        subtitle="Repeat customer orders that plan their own draft sales orders 12 months ahead, priced at the customer's current tier price."
        back={
          forCustomer
            ? { href: `/customers/${customer}`, label: forCustomer.name }
            : { href: "/sales", label: "Sales orders" }
        }
      >
        {customer && (
          <Link href="/sales/recurring" className="btn">
            All customers
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section
        title={
          forCustomer
            ? `${forCustomer.name}'s recurring orders`
            : "Recurring orders"
        }
      >
        {!rows?.length ? (
          <Empty>No recurring orders yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Customer</th>
                  <th>Schedule</th>
                  <th className="num">Items</th>
                  <th>Next ship date</th>
                  <th className="num">Planned</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => {
                  const n = next.get(r.id);
                  const ended = !r.active && r.end_date && r.end_date <= now;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link
                          href={`/sales/recurring/${r.id}`}
                          className="link"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td>{r.customers?.name}</td>
                      <td>
                        {CADENCE_LABEL[r.cadence]}
                        <div className="text-xs text-stone-500">
                          from {date(r.start_date)}
                          {r.end_date && ` to ${date(r.end_date)}`}
                        </div>
                      </td>
                      <td className="num">
                        {r.recurring_sale_lines?.length ?? 0}
                      </td>
                      <td>{n ? date(n.date) : "—"}</td>
                      <td className="num">{n?.count ?? 0}</td>
                      <td>
                        {r.active ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                            {ended ? "Ended" : "Paused"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {canSell && (
        <Section title="New recurring order">
          <form
            action={createRecurringSale}
            className="card grid gap-4 sm:grid-cols-3"
          >
            <Field label="Customer">
              <select
                name="customer_id"
                className="input"
                required
                defaultValue={customer ?? ""}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input
                name="name"
                className="input"
                placeholder="Weekly shop flowers"
                required
              />
            </Field>
            <Field label="Repeats">
              <select name="cadence" className="input" defaultValue="weekly">
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
            <Field label="First ship / pickup date">
              <input
                name="start_date"
                type="date"
                className="input"
                min={now}
                defaultValue={addDays(now, 1)}
                required
              />
            </Field>
            <Field label="Last date (optional)">
              <input name="end_date" type="date" className="input" min={now} />
            </Field>
            <Field label="Notes">
              <input name="notes" className="input" />
            </Field>
            <div className="sm:col-span-3">
              <SubmitButton>Create and add items</SubmitButton>
            </div>
          </form>
        </Section>
      )}
    </>
  );
}
