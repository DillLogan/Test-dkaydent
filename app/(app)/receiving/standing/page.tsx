import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, date, money, today, oneYearFrom } from "@/lib/format";
import { createStandingOrder } from "../actions";
import { CADENCE_LABEL } from "@/lib/receiving";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function StandingOrdersPage({ searchParams }: { searchParams: SP }) {
  const { error, message, vendor } = await searchParams;
  const { supabase, profile } = await getSession();
  const canBuy = can(profile, "buyer");
  const now = today();

  const [{ data: orders }, { data: vendors }, { data: upcoming }] = await Promise.all([
    supabase
      .from("standing_orders")
      .select("id, name, cadence, start_date, end_date, lead_days, active, vendors(name), standing_order_lines(qty, unit_cost)")
      .order("active", { ascending: false })
      .order("name"),
    supabase.from("vendors").select("id, name").eq("active", true).order("name"),
    supabase
      .from("purchase_orders")
      .select("standing_order_id, occurrence_date")
      .not("standing_order_id", "is", null)
      .in("status", ["draft", "ordered", "partially_received"])
      .gte("occurrence_date", now)
      .order("occurrence_date"),
  ]);
  const next = new Map<string, { date: string; count: number }>();
  for (const u of upcoming ?? []) {
    const x = next.get(u.standing_order_id);
    next.set(u.standing_order_id, x ? { ...x, count: x.count + 1 } : { date: u.occurrence_date, count: 1 });
  }

  return (
    <>
      <PageHeader
        title="Standing orders"
        subtitle="Repeat orders that plan their own purchase orders and shipments 12 months ahead. Edit or skip any single delivery."
        back={{ href: "/receiving", label: "Receiving" }}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Standing orders">
        {!orders?.length ? (
          <Empty>No standing orders yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Vendor</th>
                  <th>Schedule</th>
                  <th className="num">Per delivery</th>
                  <th>Next arrival</th>
                  <th className="num">Planned</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => {
                  const n = next.get(o.id);
                  const per = (o.standing_order_lines ?? []).reduce((t: number, l: any) => t + Number(l.qty) * Number(l.unit_cost), 0);
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/receiving/standing/${o.id}`} className="link">
                          {o.name}
                        </Link>
                      </td>
                      <td>{o.vendors?.name}</td>
                      <td>
                        {CADENCE_LABEL[o.cadence]}
                        <div className="text-xs text-stone-500">
                          from {date(o.start_date)}
                          {o.end_date && ` to ${date(o.end_date)}`}
                        </div>
                      </td>
                      <td className="num">{money(per)}</td>
                      <td>{n ? date(n.date) : "—"}</td>
                      <td className="num">{n?.count ?? 0}</td>
                      <td>
                        {o.active ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Active</span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                            {o.end_date && o.end_date <= now ? "Ended" : "Paused"}
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

      {canBuy && (
        <Section title="New standing order">
          {!vendors?.length ? (
            <Empty>
              Add a <Link href="/vendors" className="link">vendor</Link> first.
            </Empty>
          ) : (
            <form action={createStandingOrder} className="card grid gap-4 sm:grid-cols-3">
              <Field label="Name">
                <input name="name" className="input" placeholder="Weekly Ecuador roses" required />
              </Field>
              <Field label="Vendor">
                <select name="vendor_id" className="input" required defaultValue={vendor ?? ""}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Repeats">
                <select name="cadence" className="input" defaultValue="weekly">
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Every month</option>
                </select>
              </Field>
              <Field label="First arrival">
                <input name="start_date" type="date" className="input" min={now} max={oneYearFrom(now)} defaultValue={addDays(now, 7)} required />
              </Field>
              <Field label="Last arrival (optional)">
                <input name="end_date" type="date" className="input" min={now} />
              </Field>
              <Field label="Order lead time (days before arrival)">
                <input name="lead_days" type="number" min="0" max="120" className="input" defaultValue={7} />
              </Field>
              <Field label="Carrier">
                <input name="carrier" className="input" placeholder="e.g. KLM Cargo" />
              </Field>
              <Field label="Freight per delivery">
                <input name="freight_cost" type="number" min="0" step="0.01" className="input" defaultValue={0} />
              </Field>
              <Field label="Notes">
                <input name="notes" className="input" />
              </Field>
              <div className="sm:col-span-3">
                <SubmitButton>Create and add items</SubmitButton>
              </div>
            </form>
          )}
        </Section>
      )}
    </>
  );
}
