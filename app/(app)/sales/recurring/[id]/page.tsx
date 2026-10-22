import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog, toPicker } from "@/lib/catalog";
import { addDays, date, money, qty, today } from "@/lib/format";
import { CADENCE_LABEL } from "@/lib/receiving";
import {
  addRecurringLine,
  removeRecurringLine,
  setRecurringState,
  skipRecurringSale,
  updateRecurringSale,
} from "../actions";
import { ProductUnitPicker } from "@/components/ProductUnitPicker";
import { SubmitButton } from "@/components/SubmitButton";
import {
  Empty,
  ErrorBanner,
  Field,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
} from "@/components/ui";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function RecurringSalePage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const canSell = can(profile, "sales");
  const now = today();
  if (canSell)
    await supabase.rpc("generate_recurring_sales", { p_recurring_id: id });

  const [{ data: r }, { data: lines }, { data: orders }] = await Promise.all([
    supabase
      .from("recurring_sales")
      .select("*, customers(id, name, price_tiers(name))")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("recurring_sale_lines")
      .select("id, qty, unit_id, products(name, sku), product_units(name)")
      .eq("recurring_id", id)
      .order("created_at"),
    supabase
      .from("sales_orders")
      .select(
        "id, so_number, status, occurrence_date, customized, sales_order_lines(qty, unit_price)",
      )
      .eq("recurring_id", id)
      .gte("occurrence_date", addDays(now, -30))
      .order("occurrence_date"),
  ]);
  if (!r) notFound();
  const ended = !r.active && !!r.end_date && r.end_date <= now;
  const prices = await Promise.all(
    (lines ?? []).map(async (l: any) =>
      Number(
        (
          await supabase.rpc("customer_unit_price", {
            p_customer_id: r.customer_id,
            p_unit_id: l.unit_id,
          })
        ).data ?? 0,
      ),
    ),
  );
  const per = (lines ?? []).reduce(
    (t: number, l: any, i: number) => t + Number(l.qty) * prices[i],
    0,
  );
  const picker =
    canSell && !ended
      ? toPicker(await loadCatalog(supabase), { showStock: true })
      : [];
  const back = `/sales/recurring/${id}`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.name}
            {r.active ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                Active
              </span>
            ) : (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                {ended ? "Ended" : "Paused"}
              </span>
            )}
          </span>
        }
        subtitle={
          <>
            <Link href={`/customers/${r.customers?.id}`} className="link">
              {r.customers?.name}
            </Link>
            {` · ${r.customers?.price_tiers?.name ?? "No tier"} · ${CADENCE_LABEL[r.cadence]} from ${date(r.start_date)}`}
            {r.end_date && ` to ${date(r.end_date)}`}
            {` · about ${money(per)} per order at today's prices`}
          </>
        }
        back={{
          href: `/sales/recurring?customer=${r.customer_id}`,
          label: "Recurring orders",
        }}
      >
        {canSell && r.active && (
          <>
            <form action={setRecurringState.bind(null, id, "pause")}>
              <SubmitButton
                className="btn"
                confirm="Pause? Planned orders you haven't edited will be removed."
                pendingText="…"
              >
                Pause
              </SubmitButton>
            </form>
            <form action={setRecurringState.bind(null, id, "end")}>
              <SubmitButton
                className="btn btn-danger"
                confirm="End this recurring order? Planned orders you haven't edited will be removed."
                pendingText="…"
              >
                End
              </SubmitButton>
            </form>
          </>
        )}
        {canSell && !r.active && !ended && (
          <form action={setRecurringState.bind(null, id, "resume")}>
            <SubmitButton pendingText="…">Resume</SubmitButton>
          </form>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Items each order">
        {!lines?.length ? (
          <Empty>
            No items yet. Nothing is planned until you add at least one.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Price today</th>
                  <th className="num">Extended</th>
                  {canSell && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l: any, i: number) => (
                  <tr key={l.id}>
                    <td>
                      {l.products.name}
                      <div className="text-xs text-stone-500 tabular-nums">
                        {l.products.sku}
                      </div>
                    </td>
                    <td className="num">
                      {qty(l.qty)} {l.product_units.name}
                    </td>
                    <td className="num">{money(prices[i])}</td>
                    <td className="num">{money(Number(l.qty) * prices[i])}</td>
                    {canSell && (
                      <td className="text-right">
                        <form action={removeRecurringLine.bind(null, id, l.id)}>
                          <SubmitButton
                            className="btn btn-sm btn-danger"
                            pendingText="…"
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canSell && !ended && (
          <form
            action={addRecurringLine.bind(null, id)}
            className="card mt-3 space-y-3"
          >
            <ProductUnitPicker
              products={picker}
              priceName="price"
              priceLabel="Price"
              defaultUnit="smallest"
              hidePrice
            />
            <SubmitButton>Add item</SubmitButton>
            <p className="text-xs text-stone-500">
              Each order is priced at the customer&apos;s current tier price.
              Planned orders you haven&apos;t edited are re-priced whenever
              prices change.
            </p>
          </form>
        )}
      </Section>

      <Section
        title={`Planned orders (${(orders ?? []).filter((o) => o.status !== "cancelled" && o.occurrence_date >= now).length} ahead)`}
      >
        {!orders?.length ? (
          <Empty>
            {r.active
              ? "Add items to plan the next 12 months."
              : "Nothing planned while paused."}
          </Empty>
        ) : (
          <div className="table-wrap max-h-[36rem] overflow-y-auto">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Ships</th>
                  <th>Order</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  {canSell && <th />}
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => {
                  const total = (o.sales_order_lines ?? []).reduce(
                    (t: number, l: any) =>
                      t + Number(l.qty) * Number(l.unit_price),
                    0,
                  );
                  return (
                    <tr
                      key={o.id}
                      className={
                        o.status === "cancelled" ? "text-stone-400" : ""
                      }
                    >
                      <td className="whitespace-nowrap">
                        {date(o.occurrence_date)}
                      </td>
                      <td>
                        <Link href={`/sales/${o.id}`} className="link">
                          {o.so_number}
                        </Link>
                        {o.customized && (
                          <span className="ml-1 text-xs text-amber-700">
                            edited
                          </span>
                        )}
                      </td>
                      <td className="num">{money(total)}</td>
                      <td>
                        {o.status === "cancelled" ? (
                          <span className="text-xs">Skipped</span>
                        ) : (
                          <StatusBadge status={o.status} />
                        )}
                      </td>
                      {canSell && (
                        <td className="text-right">
                          {["draft", "confirmed"].includes(o.status) && (
                            <form
                              action={skipRecurringSale.bind(null, o.id, back)}
                            >
                              <SubmitButton
                                className="btn btn-sm"
                                confirm={`Skip the ${date(o.occurrence_date)} order?`}
                                pendingText="…"
                              >
                                Skip
                              </SubmitButton>
                            </form>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-stone-500">
          Open an order to change that one delivery; it&apos;s then marked
          edited and kept if you pause, end or change this recurring order.
          Confirm each order when it&apos;s time to pick it.
        </p>
      </Section>

      <Section title="Schedule">
        <form action={updateRecurringSale.bind(null, id)} className="card">
          <fieldset
            disabled={!canSell || ended}
            className="grid gap-4 sm:grid-cols-3"
          >
            <Field label="Name">
              <input
                name="name"
                className="input"
                defaultValue={r.name}
                required
              />
            </Field>
            <Field label="Repeats">
              <select name="cadence" className="input" defaultValue={r.cadence}>
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
                defaultValue={r.start_date}
                required
              />
            </Field>
            <Field label="Last date (optional)">
              <input
                name="end_date"
                type="date"
                className="input"
                defaultValue={r.end_date ?? ""}
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <input
                name="notes"
                className="input"
                defaultValue={r.notes ?? ""}
              />
            </Field>
            {canSell && !ended && (
              <div className="sm:col-span-3">
                <SubmitButton>Save schedule</SubmitButton>
              </div>
            )}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
