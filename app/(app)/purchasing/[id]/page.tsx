import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog, toPicker } from "@/lib/catalog";
import { addDays, date, dateTime, money, pct, qty, sum, today, unitMoney } from "@/lib/format";
import { addPOLine, closePO, deletePO, receivePO, removePOLine, setPOStatus, updatePO } from "../actions";
import { skipOccurrence } from "../../receiving/actions";
import { ProductUnitPicker } from "@/components/ProductUnitPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function POPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: po }, { data: lines }, { data: locations }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, vendors(id, name), shipments(id, shipment_number, status, eta, carrier), standing_orders(id, name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("purchase_order_lines")
      .select("*, products(sku, name, base_unit, shelf_life_days), product_units(name, factor)")
      .eq("po_id", id)
      .order("created_at"),
    supabase.from("locations").select("id, name").eq("active", true).order("name"),
  ]);
  if (!po) notFound();

  // Original receipts only (not later transfer splits)
  const { data: receipts } = await supabase
    .from("stock_movements")
    .select("id, qty_base, created_at, lots(id, lot_code, expires_at, unit_cost_base), products(name, base_unit), locations(name)")
    .eq("kind", "receive")
    .eq("reference", po.po_number)
    .order("created_at");

  const canBuy = can(profile, "buyer");
  const canReceive = can(profile, "buyer", "warehouse");
  const isDraft = po.status === "draft";
  const receivable = po.status === "ordered" || po.status === "partially_received";
  const editableHeader = !["received", "cancelled"].includes(po.status);

  const rows = (lines ?? []).map((l: any) => {
    const factor = Number(l.product_units.factor);
    const orderedBase = Number(l.qty) * factor;
    const receivedBase = Number(l.qty_received_base);
    return {
      ...l,
      factor,
      orderedBase,
      receivedBase,
      remainingUnits: Math.max(0, (orderedBase - receivedBase) / factor),
      extended: Number(l.qty) * Number(l.unit_cost),
    };
  });
  const subtotal = sum(rows, (r) => r.extended);
  const extra = Number(po.freight_cost) + Number(po.other_cost);
  const uplift = subtotal > 0 ? extra / subtotal : 0;
  const pending = rows.filter((r) => r.remainingUnits > 0);
  const nothingReceived = rows.every((r) => r.receivedBase === 0);

  // Suggest the last price paid per product+unit
  let picker: ReturnType<typeof toPicker> = [];
  if (isDraft && canBuy) {
    const catalog = await loadCatalog(supabase);
    const { data: recent } = await supabase
      .from("purchase_order_lines")
      .select("unit_id, unit_cost")
      .order("created_at", { ascending: false })
      .limit(500);
    const lastCost = new Map<string, number>();
    for (const r of recent ?? []) if (!lastCost.has(r.unit_id)) lastCost.set(r.unit_id, Number(r.unit_cost));
    picker = toPicker(catalog, { showStock: true, suggest: (_p, u) => lastCost.get(u.id) });
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {po.po_number} <StatusBadge status={po.status} />
          </span>
        }
        subtitle={
          <>
            <Link href={`/vendors/${po.vendors?.id}`} className="link">
              {po.vendors?.name}
            </Link>
            {po.order_date && ` · ordered ${date(po.order_date)}`}
            {po.expected_date && ` · expected ${date(po.expected_date)}`}
            {po.shipments && (
              <>
                {" · on "}
                <Link href={`/receiving/${po.shipments.id}`} className="link">
                  {po.shipments.shipment_number}
                </Link>
                {po.shipments.carrier && ` (${po.shipments.carrier})`}
              </>
            )}
            {po.standing_orders && (
              <>
                {" · ↻ "}
                <Link href={`/receiving/standing/${po.standing_orders.id}`} className="link">
                  {po.standing_orders.name}
                </Link>
                {po.customized && " (edited)"}
              </>
            )}
          </>
        }
        back={{ href: "/purchasing", label: "Purchasing" }}
      >
        {canBuy && isDraft && (
          <>
            {po.standing_order_id ? (
              <form action={skipOccurrence.bind(null, id, `/purchasing/${id}`)}>
                <SubmitButton className="btn btn-danger" confirm="Skip this planned delivery?" pendingText="Skipping…">
                  Skip delivery
                </SubmitButton>
              </form>
            ) : (
              <form action={deletePO.bind(null, id)}>
                <SubmitButton className="btn btn-danger" confirm="Delete this draft PO?" pendingText="Deleting…">
                  Delete draft
                </SubmitButton>
              </form>
            )}
            <form action={setPOStatus.bind(null, id, "ordered")}>
              <SubmitButton pendingText="Updating…">Mark as ordered</SubmitButton>
            </form>
          </>
        )}
        {canBuy && po.status === "ordered" && nothingReceived && (
          <>
            <form action={setPOStatus.bind(null, id, "draft")}>
              <SubmitButton className="btn" pendingText="…">
                Back to draft
              </SubmitButton>
            </form>
            <form action={setPOStatus.bind(null, id, "cancelled")}>
              <SubmitButton className="btn btn-danger" confirm="Cancel this PO?" pendingText="…">
                Cancel PO
              </SubmitButton>
            </form>
          </>
        )}
        {canBuy && po.status === "partially_received" && (
          <form action={closePO.bind(null, id)}>
            <SubmitButton className="btn" confirm="Close this PO? Remaining quantities won't be received." pendingText="…">
              Close short
            </SubmitButton>
          </form>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Lines">
        {rows.length === 0 ? (
          <Empty>No lines yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Extended</th>
                  <th className="num">Landed / base</th>
                  <th className="num">Received</th>
                  {isDraft && canBuy && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.products.name}
                      <div className="text-xs text-stone-500 tabular-nums">{r.products.sku}</div>
                    </td>
                    <td className="num">
                      {qty(r.qty)} {r.product_units.name}
                      {r.factor !== 1 && (
                        <div className="text-xs text-stone-500">
                          {qty(r.orderedBase)} {r.products.base_unit}
                        </div>
                      )}
                    </td>
                    <td className="num">{money(r.unit_cost)}</td>
                    <td className="num">{money(r.extended)}</td>
                    <td className="num">{unitMoney((Number(r.unit_cost) / r.factor) * (1 + uplift))}</td>
                    <td className="num">
                      {qty(r.receivedBase / r.factor)} / {qty(r.qty)}
                    </td>
                    {isDraft && canBuy && (
                      <td className="text-right">
                        <form action={removePOLine.bind(null, id, r.id)}>
                          <SubmitButton className="btn btn-sm btn-danger" pendingText="…">
                            Remove
                          </SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr>
                  <td colSpan={3} className="text-right text-stone-500">
                    Product subtotal
                  </td>
                  <td className="num font-medium">{money(subtotal)}</td>
                  <td colSpan={isDraft && canBuy ? 3 : 2} />
                </tr>
                <tr>
                  <td colSpan={3} className="text-right text-stone-500">
                    Freight + other ({pct(uplift)} uplift)
                  </td>
                  <td className="num">{money(extra)}</td>
                  <td colSpan={isDraft && canBuy ? 3 : 2} />
                </tr>
                <tr>
                  <td colSpan={3} className="text-right font-medium">
                    Landed total
                  </td>
                  <td className="num font-semibold">{money(subtotal + extra)}</td>
                  <td colSpan={isDraft && canBuy ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      {isDraft && canBuy && (
        <Section title="Add line">
          <form action={addPOLine.bind(null, id)} className="card space-y-3">
            <ProductUnitPicker products={picker} priceName="unit_cost" priceLabel="Vendor cost per unit" defaultUnit="largest" />
            <SubmitButton>Add line</SubmitButton>
          </form>
        </Section>
      )}

      {receivable && canReceive && pending.length > 0 && (
        <Section title="Receive">
          <form action={receivePO.bind(null, id, pending.map((r) => r.id))} className="card space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Default location">
                <select name="default_location" className="input w-auto" required>
                  {(locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="pb-2 text-xs text-stone-500">
                Landed cost includes freight and other charges ({pct(uplift)}). Expiry defaults from each product&apos;s shelf life.
              </p>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Remaining</th>
                    <th>Receive qty</th>
                    <th>Location</th>
                    <th>Expires</th>
                    <th>Lot / farm code</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((r) => (
                    <tr key={r.id}>
                      <td>{r.products.name}</td>
                      <td className="num">
                        {qty(r.remainingUnits)} {r.product_units.name}
                      </td>
                      <td>
                        <input
                          name={`qty_${r.id}`}
                          type="number"
                          min="0"
                          step="any"
                          defaultValue={r.remainingUnits}
                          className="input w-24"
                        />
                      </td>
                      <td>
                        <select name={`loc_${r.id}`} className="input w-auto" defaultValue="">
                          <option value="">Default</option>
                          {(locations ?? []).map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          name={`exp_${r.id}`}
                          type="date"
                          className="input w-auto"
                          defaultValue={r.products.shelf_life_days ? addDays(today(), r.products.shelf_life_days) : ""}
                        />
                      </td>
                      <td>
                        <input name={`lot_${r.id}`} className="input w-32" placeholder="Auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubmitButton pendingText="Receiving…">Receive into inventory</SubmitButton>
          </form>
        </Section>
      )}

      {(receipts ?? []).length > 0 && (
        <Section
          title="Received lots"
          actions={
            <Link href={`/labels?po=${id}`} className="btn">
              Print labels
            </Link>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Product</th>
                  <th>Into</th>
                  <th>Received</th>
                  <th>Expires</th>
                  <th className="num">Qty</th>
                  <th className="num">Landed / base</th>
                </tr>
              </thead>
              <tbody>
                {(receipts ?? []).map((m: any) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/inventory/lots/${m.lots?.id}`} className="link">
                        {m.lots?.lot_code}
                      </Link>
                    </td>
                    <td>{m.products?.name}</td>
                    <td>{m.locations?.name}</td>
                    <td>{dateTime(m.created_at)}</td>
                    <td>{date(m.lots?.expires_at)}</td>
                    <td className="num">
                      {qty(m.qty_base)} {m.products?.base_unit}
                    </td>
                    <td className="num">{unitMoney(m.lots?.unit_cost_base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Details">
        <form action={updatePO.bind(null, id)} className="card">
          <fieldset disabled={!canBuy || !editableHeader} className="grid gap-4 sm:grid-cols-4">
            <Field label="Order date">
              <input name="order_date" type="date" className="input" defaultValue={po.order_date ?? ""} />
            </Field>
            <Field label="Expected date">
              <input name="expected_date" type="date" className="input" defaultValue={po.expected_date ?? ""} />
            </Field>
            <Field label="Freight">
              <input name="freight_cost" type="number" min="0" step="0.01" className="input" defaultValue={po.freight_cost} />
            </Field>
            <Field label="Other charges (duties, boxes…)">
              <input name="other_cost" type="number" min="0" step="0.01" className="input" defaultValue={po.other_cost} />
            </Field>
            <Field label="Notes" className="sm:col-span-4">
              <textarea name="notes" rows={2} className="input" defaultValue={po.notes ?? ""} />
            </Field>
            {canBuy && editableHeader && (
              <div className="sm:col-span-4">
                <SubmitButton>Save details</SubmitButton>
                {po.status !== "draft" && (
                  <p className="mt-2 text-xs text-stone-500">
                    Freight changes apply to lots received after you save; lots already received keep their landed cost.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
