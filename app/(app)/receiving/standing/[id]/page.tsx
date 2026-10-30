import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog, toPicker } from "@/lib/catalog";
import { addDays, date, money, qty, today } from "@/lib/format";
import { CADENCE_LABEL } from "@/lib/receiving";
import { addStandingLine, removeStandingLine, setStandingState, skipOccurrence, updateStandingOrder } from "../../actions";
import { ProductUnitPicker } from "@/components/ProductUnitPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { DirectShipBadge, DirectShipField } from "@/components/DirectShip";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function StandingOrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const now = today();

  const [{ data: so }, { data: lines }, { data: occ }, { data: customers }] = await Promise.all([
    supabase.from("standing_orders").select("*, vendors(id, name), customers(id, name)").eq("id", id).maybeSingle(),
    supabase
      .from("standing_order_lines")
      .select("id, qty, unit_cost, products(name, sku), product_units(name)")
      .eq("standing_order_id", id)
      .order("created_at"),
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, order_date, occurrence_date, customized, shipment_id, shipments(id, shipment_number, status), purchase_order_lines(qty, unit_cost)",
      )
      .eq("standing_order_id", id)
      .gte("occurrence_date", addDays(now, -30))
      .order("occurrence_date"),
    supabase.from("customers").select("id, name").eq("active", true).order("name"),
  ]);
  if (!so) notFound();
  const canBuy = can(profile, "buyer");
  const ended = !!so.end_date && so.end_date <= now && !so.active;
  const per = (lines ?? []).reduce((t, l) => t + Number(l.qty) * Number(l.unit_cost), 0);

  let picker: ReturnType<typeof toPicker> = [];
  if (canBuy) picker = toPicker(await loadCatalog(supabase), { showStock: false });

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {so.name}
            <DirectShipBadge name={so.customers?.name} />
            {so.active ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Active</span>
            ) : (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">{ended ? "Ended" : "Paused"}</span>
            )}
          </span>
        }
        subtitle={
          <>
            <Link href={`/vendors/${so.vendors?.id}`} className="link">
              {so.vendors?.name}
            </Link>
            {` · ${CADENCE_LABEL[so.cadence]} from ${date(so.start_date)}`}
            {so.end_date && ` to ${date(so.end_date)}`}
            {` · ordered ${so.lead_days} day${so.lead_days === 1 ? "" : "s"} ahead · ${money(per)} per delivery`}
          </>
        }
        back={{ href: "/receiving/standing", label: "Standing orders" }}
      >
        {canBuy && so.active && (
          <>
            <form action={setStandingState.bind(null, id, "pause")}>
              <SubmitButton className="btn" confirm="Pause? Planned deliveries you haven't edited will be removed." pendingText="…">
                Pause
              </SubmitButton>
            </form>
            <form action={setStandingState.bind(null, id, "end")}>
              <SubmitButton className="btn btn-danger" confirm="End this standing order? Planned deliveries you haven't edited will be removed." pendingText="…">
                End
              </SubmitButton>
            </form>
          </>
        )}
        {canBuy && !so.active && !ended && (
          <form action={setStandingState.bind(null, id, "resume")}>
            <SubmitButton pendingText="…">Resume</SubmitButton>
          </form>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Items each delivery">
        {!lines?.length ? (
          <Empty>No items yet. Nothing is planned until you add at least one.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Extended</th>
                  {canBuy && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l: any) => (
                  <tr key={l.id}>
                    <td>
                      {l.products.name}
                      <div className="text-xs text-stone-500 tabular-nums">{l.products.sku}</div>
                    </td>
                    <td className="num">
                      {qty(l.qty)} {l.product_units.name}
                    </td>
                    <td className="num">{money(l.unit_cost)}</td>
                    <td className="num">{money(Number(l.qty) * Number(l.unit_cost))}</td>
                    {canBuy && (
                      <td className="text-right">
                        <form action={removeStandingLine.bind(null, id, l.id)}>
                          <SubmitButton className="btn btn-sm btn-danger" pendingText="…">
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
        {canBuy && !ended && (
          <form action={addStandingLine.bind(null, id)} className="card mt-3 space-y-3">
            <ProductUnitPicker products={picker} priceName="unit_cost" priceLabel="Vendor cost per unit" defaultUnit="largest" />
            <SubmitButton>Add item</SubmitButton>
            <p className="text-xs text-stone-500">Changes to items apply to planned deliveries you haven&apos;t edited.</p>
          </form>
        )}
      </Section>

      <Section title={`Planned deliveries (${(occ ?? []).filter((o) => o.status !== "cancelled" && o.occurrence_date >= now).length} ahead)`}>
        {!occ?.length ? (
          <Empty>{so.active ? "Add items to plan the next 12 months." : "Nothing planned while paused."}</Empty>
        ) : (
          <div className="table-wrap max-h-[36rem] overflow-y-auto">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Arrives</th>
                  <th>Order by</th>
                  <th>PO</th>
                  <th>Shipment</th>
                  <th className="num">Value</th>
                  <th>Status</th>
                  {canBuy && <th />}
                </tr>
              </thead>
              <tbody>
                {occ.map((o: any) => {
                  const value = (o.purchase_order_lines ?? []).reduce((t: number, l: any) => t + Number(l.qty) * Number(l.unit_cost), 0);
                  return (
                    <tr key={o.id} className={o.status === "cancelled" ? "text-stone-400" : ""}>
                      <td className="whitespace-nowrap">{date(o.occurrence_date)}</td>
                      <td className="whitespace-nowrap">{o.status === "draft" ? date(o.order_date) : "—"}</td>
                      <td>
                        <Link href={`/purchasing/${o.id}`} className="link">
                          {o.po_number}
                        </Link>
                        {o.customized && <span className="ml-1 text-xs text-amber-700">edited</span>}
                      </td>
                      <td>
                        {o.shipments ? (
                          <Link href={`/receiving/${o.shipments.id}`} className="link">
                            {o.shipments.shipment_number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">{money(value)}</td>
                      <td>{o.status === "cancelled" ? <span className="text-xs">Skipped</span> : <StatusBadge status={o.status} />}</td>
                      {canBuy && (
                        <td className="text-right">
                          {o.status === "draft" && (
                            <form action={skipOccurrence.bind(null, o.id, `/receiving/standing/${id}`)}>
                              <SubmitButton className="btn btn-sm" confirm={`Skip the ${date(o.occurrence_date)} delivery?`} pendingText="…">
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
          Open a PO to change one delivery&apos;s quantities or prices; that delivery is then marked edited and kept if you pause, end, or change the
          standing order.
        </p>
      </Section>

      <Section title="Schedule">
        <form action={updateStandingOrder.bind(null, id)} className="card">
          <fieldset disabled={!canBuy || ended} className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <input name="name" className="input" defaultValue={so.name} required />
            </Field>
            <Field label="Repeats">
              <select name="cadence" className="input" defaultValue={so.cadence}>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
            <Field label="First arrival">
              <input name="start_date" type="date" className="input" defaultValue={so.start_date} required />
            </Field>
            <Field label="Last arrival (optional)">
              <input name="end_date" type="date" className="input" defaultValue={so.end_date ?? ""} />
            </Field>
            <Field label="Order lead time (days)">
              <input name="lead_days" type="number" min="0" max="120" className="input" defaultValue={so.lead_days} />
            </Field>
            <Field label="Carrier">
              <input name="carrier" className="input" defaultValue={so.carrier ?? ""} />
            </Field>
            <Field label="Freight per delivery">
              <input name="freight_cost" type="number" min="0" step="0.01" className="input" defaultValue={so.freight_cost} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <input name="notes" className="input" defaultValue={so.notes ?? ""} />
            </Field>
            <DirectShipField customers={customers ?? []} value={so.direct_customer_id} />
            {canBuy && !ended && (
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
