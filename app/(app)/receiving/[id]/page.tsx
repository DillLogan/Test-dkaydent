import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, date, dateTime, money, qty, today, oneYearFrom } from "@/lib/format";
import {
  addPOToShipment,
  receiveShipment,
  removePOFromShipment,
  setShipmentStatus,
  skipOccurrence,
  updateShipment,
} from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ItemThumb } from "@/components/ItemThumb";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function ShipmentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: s }, { data: pos }, { data: locations }, { data: addable }] = await Promise.all([
    supabase.from("v_shipments").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, order_date, expected_date, freight_cost, other_cost, standing_order_id, customized, vendors(name), standing_orders(id, name), " +
          "purchase_order_lines(id, qty, unit_cost, qty_received_base, created_at, products(id, sku, name, base_unit, shelf_life_days, image_path, product_homes(location_id)), product_units(name, factor))",
      )
      .eq("shipment_id", id)
      .order("po_number"),
    supabase.from("locations").select("id, name").eq("active", true).order("name"),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, vendors(name)")
      .is("shipment_id", null)
      .in("status", ["draft", "ordered", "partially_received"])
      .order("po_number")
      .limit(200),
  ]);
  if (!s) notFound();

  const canPlan = can(profile, "buyer", "warehouse");
  const canBuy = can(profile, "buyer");
  const open = !["received", "cancelled"].includes(s.status);
  const locs = locations ?? [];
  const locIds = new Set(locs.map((l) => l.id));
  const receivingDock = locs.find((l) => /receiv|dock/i.test(l.name))?.id ?? locs[0]?.id;
  const now = today();

  const poRows = ((pos ?? []) as any[]).map((po) => {
    const lines = [...(po.purchase_order_lines ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((l: any) => {
        const factor = Number(l.product_units.factor);
        const remaining = Math.max(0, (Number(l.qty) * factor - Number(l.qty_received_base)) / factor);
        return { ...l, factor, remaining };
      });
    const subtotal = lines.reduce((t, l) => t + Number(l.qty) * Number(l.unit_cost), 0);
    return { ...po, lines, subtotal, landed: subtotal + Number(po.freight_cost) + Number(po.other_cost) };
  });
  const receivablePOs = poRows.filter((p) => ["draft", "ordered", "partially_received"].includes(p.status));
  const pending = receivablePOs.flatMap((p) => p.lines.filter((l: any) => l.remaining > 0).map((l: any) => ({ ...l, po: p })));
  const drafts = receivablePOs.filter((p) => p.status === "draft").length;

  // Original receipts from this shipment's POs
  const poNumbers = poRows.map((p) => p.po_number);
  const { data: receipts } = poNumbers.length
    ? await supabase
        .from("stock_movements")
        .select("id, qty_base, reference, created_at, lots(id, lot_code, expires_at), products(name, base_unit), locations(name)")
        .eq("kind", "receive")
        .in("reference", poNumbers)
        .order("created_at")
    : { data: [] as any[] };

  const STEPS = [
    { key: "planned", label: "Planned" },
    { key: "in_transit", label: "In transit" },
    { key: "arrived", label: "Arrived" },
    { key: "received", label: "Received" },
  ];
  const stepIndex = STEPS.findIndex((x) => x.key === s.status);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.shipment_number} <StatusBadge status={s.status} />
            {s.is_late && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Late</span>}
          </span>
        }
        subtitle={
          <>
            ETA {date(s.eta)}
            {s.carrier && ` · ${s.carrier}`}
            {s.tracking && (
              <>
                {" · "}
                <span className="font-mono">{s.tracking}</span>
              </>
            )}
            {s.received_at && ` · received ${dateTime(s.received_at)}`}
          </>
        }
        back={{ href: "/receiving", label: "Receiving" }}
      >
        {canPlan && open && (
          <>
            {s.status !== "in_transit" && (
              <form action={setShipmentStatus.bind(null, id, "in_transit")}>
                <SubmitButton className="btn" pendingText="…">
                  Mark in transit
                </SubmitButton>
              </form>
            )}
            {s.status !== "arrived" && (
              <form action={setShipmentStatus.bind(null, id, "arrived")}>
                <SubmitButton className="btn" pendingText="…">
                  Mark arrived
                </SubmitButton>
              </form>
            )}
            {s.status !== "planned" && (
              <form action={setShipmentStatus.bind(null, id, "planned")}>
                <SubmitButton className="btn" pendingText="…">
                  Back to planned
                </SubmitButton>
              </form>
            )}
            <form action={setShipmentStatus.bind(null, id, "cancelled")}>
              <SubmitButton className="btn btn-danger" confirm="Cancel this shipment? Its open POs will be taken off it." pendingText="…">
                Cancel shipment
              </SubmitButton>
            </form>
          </>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      {s.status !== "cancelled" && (
        <ol className="mb-6 flex flex-wrap gap-2 text-xs" aria-label="Shipment progress">
          {STEPS.map((x, i) => (
            <li
              key={x.key}
              className={`rounded-full border px-3 py-1 ${
                i < stepIndex
                  ? "border-brand-100 bg-brand-50 text-brand-800"
                  : i === stepIndex
                    ? "border-brand-700 bg-brand-700 font-medium text-white"
                    : "border-stone-200 text-stone-500"
              }`}
              aria-current={i === stepIndex ? "step" : undefined}
            >
              {x.label}
            </li>
          ))}
        </ol>
      )}

      <Section title={`Purchase orders (${poRows.length}) · ${money(poRows.reduce((t, p) => t + (p.status === "cancelled" ? 0 : p.landed), 0))} landed`}>
        {poRows.length === 0 ? (
          <Empty>No purchase orders on this shipment yet.</Empty>
        ) : (
          <div className="space-y-3">
            {poRows.map((po) => (
              <div key={po.id} className="card">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link href={`/purchasing/${po.id}`} className="link font-medium">
                    {po.po_number}
                  </Link>
                  <span className="text-stone-600">{po.vendors?.name}</span>
                  <StatusBadge status={po.status} />
                  {po.standing_orders && (
                    <Link href={`/receiving/standing/${po.standing_orders.id}`} className="text-xs text-stone-500 hover:underline">
                      ↻ {po.standing_orders.name}
                      {po.customized ? " · edited" : ""}
                    </Link>
                  )}
                  <span className="ml-auto text-sm tabular-nums">{money(po.landed)}</span>
                  {canPlan && open && ["draft", "ordered", "partially_received"].includes(po.status) && (
                    <form action={removePOFromShipment.bind(null, id, po.id)}>
                      <SubmitButton className="btn btn-sm" pendingText="…">
                        Take off
                      </SubmitButton>
                    </form>
                  )}
                  {canBuy && po.status === "draft" && po.standing_order_id && (
                    <form action={skipOccurrence.bind(null, po.id, `/receiving/${id}`)}>
                      <SubmitButton className="btn btn-sm btn-danger" confirm="Skip this planned order?" pendingText="…">
                        Skip
                      </SubmitButton>
                    </form>
                  )}
                </div>
                {po.lines.length === 0 ? (
                  <p className="text-sm text-stone-500">No lines.</p>
                ) : (
                  <ul className="divide-y divide-stone-100 text-sm">
                    {po.lines.map((l: any) => (
                      <li key={l.id} className="flex items-center gap-2 py-1.5">
                        <ItemThumb name={l.products.name} path={l.products.image_path} size={28} />
                        <span className="flex-1">{l.products.name}</span>
                        <span className="text-stone-600 tabular-nums">
                          {qty(l.qty)} {l.product_units.name} @ {money(l.unit_cost)}
                        </span>
                        {Number(l.qty_received_base) > 0 && (
                          <span className="text-xs text-brand-700">
                            {qty(Number(l.qty_received_base) / l.factor)} received
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {canPlan && open && (addable?.length ?? 0) > 0 && (
          <form action={addPOToShipment.bind(null, id)} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Add a purchase order">
              <select name="po_id" className="input w-auto" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {(addable ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.po_number} · {p.vendors?.name} ({p.status.replace("_", " ")})
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton className="btn" pendingText="Adding…">
              Add to shipment
            </SubmitButton>
          </form>
        )}
      </Section>

      {open && canPlan && pending.length > 0 && (
        <Section title="Receive shipment">
          <form action={receiveShipment.bind(null, id, pending.map((l) => l.id))} className="card space-y-4">
            <p className="text-sm text-stone-600">
              Everything on the shipment, in one go. Quantities start at what&apos;s still due; change any line that came in short, or set it to 0.
              Locations start at each item&apos;s home area.
              {drafts > 0 && ` ${drafts} draft PO${drafts === 1 ? " is" : "s are"} marked ordered when you receive.`}
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>PO</th>
                    <th>Product</th>
                    <th className="num">Due</th>
                    <th>Receive qty</th>
                    <th>Location</th>
                    <th>Expires</th>
                    <th>Lot / farm code</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((l) => {
                    const home = (l.products.product_homes ?? []).map((h: { location_id: string }) => h.location_id).find((x: string) => locIds.has(x)) ?? receivingDock;
                    return (
                      <tr key={l.id}>
                        <td className="text-xs whitespace-nowrap text-stone-500">{l.po.po_number}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ItemThumb name={l.products.name} path={l.products.image_path} size={28} />
                            {l.products.name}
                          </div>
                        </td>
                        <td className="num whitespace-nowrap">
                          {qty(l.remaining)} {l.product_units.name}
                        </td>
                        <td>
                          <input
                            name={`qty_${l.id}`}
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={l.remaining}
                            className="input w-24"
                            aria-label={`Receive qty for ${l.products.name} on ${l.po.po_number}`}
                          />
                        </td>
                        <td>
                          <select name={`loc_${l.id}`} className="input w-auto" defaultValue={home} aria-label={`Location for ${l.products.name}`}>
                            {locs.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            name={`exp_${l.id}`}
                            type="date"
                            className="input w-auto"
                            defaultValue={l.products.shelf_life_days ? addDays(now, l.products.shelf_life_days) : ""}
                          />
                        </td>
                        <td>
                          <input name={`lot_${l.id}`} className="input w-32" placeholder="Auto" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SubmitButton pendingText="Receiving…">Receive shipment into inventory</SubmitButton>
          </form>
        </Section>
      )}

      {(receipts ?? []).length > 0 && (
        <Section title="Received lots">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>PO</th>
                  <th>Product</th>
                  <th>Into</th>
                  <th>Received</th>
                  <th>Expires</th>
                  <th className="num">Qty</th>
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
                    <td className="text-xs">{m.reference}</td>
                    <td>{m.products?.name}</td>
                    <td>{m.locations?.name}</td>
                    <td>{dateTime(m.created_at)}</td>
                    <td>{date(m.lots?.expires_at)}</td>
                    <td className="num">
                      {qty(m.qty_base)} {m.products?.base_unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Details">
        <form action={updateShipment.bind(null, id)} className="card">
          <fieldset disabled={!canPlan || !open} className="grid gap-4 sm:grid-cols-3">
            <Field label="ETA">
              <input name="eta" type="date" className="input" defaultValue={s.eta} max={oneYearFrom(now)} required />
            </Field>
            <Field label="Carrier">
              <input name="carrier" className="input" defaultValue={s.carrier ?? ""} />
            </Field>
            <Field label="AWB / tracking">
              <input name="tracking" className="input font-mono" defaultValue={s.tracking ?? ""} />
            </Field>
            <Field label="Notes" className="sm:col-span-3">
              <textarea name="notes" rows={2} className="input" defaultValue={s.notes ?? ""} />
            </Field>
            {canPlan && open && (
              <div className="sm:col-span-3">
                <SubmitButton>Save details</SubmitButton>
                <p className="mt-2 text-xs text-stone-500">Changing the ETA moves the expected date of every PO on this shipment.</p>
              </div>
            )}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
