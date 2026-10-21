import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog, toPicker } from "@/lib/catalog";
import { date, dateTime, money, pct, qty, sum } from "@/lib/format";
import {
  addSOLine,
  createReturn,
  deleteSO,
  fulfillSO,
  fulfillSOPicked,
  invoiceSO,
  removeSOLine,
  setCreditStatus,
  setSOStatus,
  updateSO,
} from "../actions";
import { PickForm, type PickLine } from "@/components/PickForm";
import { ProductUnitPicker } from "@/components/ProductUnitPicker";
import { ItemCell } from "@/components/ItemThumb";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function SOPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: so }, { data: lines }, { data: invoice }] = await Promise.all([
    supabase.from("sales_orders").select("*, customers(id, name, price_tier_id, price_tiers(name, markup_pct))").eq("id", id).maybeSingle(),
    supabase
      .from("sales_order_lines")
      .select("*, products(sku, name, base_unit, image_path, category), product_units(name, factor)")
      .eq("so_id", id)
      .order("created_at"),
    supabase.from("invoices").select("id, invoice_number").eq("so_id", id).neq("status", "void").maybeSingle(),
  ]);
  if (!so) notFound();
  const { data: returns } = await supabase
    .from("returns")
    .select("*, return_lines(so_line_id, qty, qty_base, restock, credit, product_id)")
    .eq("so_id", id)
    .order("created_at");

  const canSell = can(profile, "sales");
  const canFulfill = can(profile, "sales", "warehouse");
  const isDraft = so.status === "draft";
  const showCost = so.status === "fulfilled" || so.status === "invoiced";
  const tier = so.customers?.price_tiers;

  const catalog = await loadCatalog(supabase);
  const stockById = new Map(catalog.map((c) => [c.id, c]));

  // Availability check against what this order needs
  const needByProduct = new Map<string, number>();
  for (const l of lines ?? []) {
    needByProduct.set(l.product_id, (needByProduct.get(l.product_id) ?? 0) + Number(l.qty) * Number(l.product_units.factor));
  }

  const rows = (lines ?? []).map((l: any) => {
    const revenue = Number(l.qty) * Number(l.unit_price);
    const cost = l.cost_total === null ? null : Number(l.cost_total);
    const onHand = stockById.get(l.product_id)?.onHand ?? 0;
    return { ...l, revenue, cost, short: !showCost && (needByProduct.get(l.product_id) ?? 0) > onHand, onHand };
  });
  const subtotal = sum(rows, (r) => r.revenue);
  const costTotal = sum(rows, (r) => r.cost);
  const anyShort = rows.some((r) => r.short);

  // Returnable quantity per line, in the line's unit
  const returnedBase = new Map<string, number>();
  for (const r of returns ?? []) for (const rl of r.return_lines ?? []) returnedBase.set(rl.so_line_id, (returnedBase.get(rl.so_line_id) ?? 0) + Number(rl.qty_base));
  const canReturn = (so.status === "fulfilled" || so.status === "invoiced") && canFulfill;

  // Hand-pick: available lots per line, oldest first
  let pickLines: PickLine[] = [];
  if (so.status === "confirmed" && canFulfill && rows.length) {
    const productIds = [...new Set(rows.map((r) => r.product_id))];
    const { data: avail } = await supabase
      .from("v_lot_aging")
      .select("lot_id, lot_code, product_id, location_name, received_at, expires_at, days_to_expiry, qty_on_hand_base")
      .in("product_id", productIds)
      .order("received_at");
    pickLines = rows.map((r) => ({
      id: r.id,
      product: r.products.name,
      sku: r.products.sku,
      base_unit: r.products.base_unit,
      need: Number(r.qty) * Number(r.product_units.factor),
      lots: (avail ?? [])
        .filter((a) => a.product_id === r.product_id)
        .map((a) => ({
          lot_id: a.lot_id,
          lot_code: a.lot_code,
          location: a.location_name,
          received: date(a.received_at),
          expires: date(a.expires_at),
          days_to_expiry: a.days_to_expiry,
          available: Number(a.qty_on_hand_base),
        })),
    }));
  }

  let picker: ReturnType<typeof toPicker> = [];
  if (isDraft && canSell) {
    const unitIds = catalog.flatMap((c) => c.units.map((u) => u.id));
    const { data: tierPrices } =
      so.customers?.price_tier_id && unitIds.length
        ? await supabase.from("tier_prices").select("product_unit_id, price").eq("tier_id", so.customers.price_tier_id)
        : { data: [] as any[] };
    const priceByUnit = new Map((tierPrices ?? []).map((t) => [t.product_unit_id, Number(t.price)]));
    const markup = Number(tier?.markup_pct ?? 35) / 100;
    picker = toPicker(catalog, {
      showStock: true,
      suggest: (p, u) =>
        priceByUnit.get(u.id) ?? (p.avgCost !== null ? Math.round(p.avgCost * u.factor * (1 + markup) * 100) / 100 : undefined),
    });
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {so.so_number} <StatusBadge status={so.status} />
          </span>
        }
        subtitle={
          <>
            <Link href={`/customers/${so.customers?.id}`} className="link">
              {so.customers?.name}
            </Link>
            {tier && ` · ${tier.name}`} · ordered {date(so.order_date)}
            {so.ship_date && ` · ships ${date(so.ship_date)}`}
          </>
        }
        back={{ href: "/sales", label: "Sales orders" }}
      >
        {canSell && isDraft && (
          <>
            <form action={deleteSO.bind(null, id)}>
              <SubmitButton className="btn btn-danger" confirm="Delete this draft order?" pendingText="…">
                Delete draft
              </SubmitButton>
            </form>
            <form action={setSOStatus.bind(null, id, "confirmed")}>
              <SubmitButton pendingText="…">Confirm order</SubmitButton>
            </form>
          </>
        )}
        {so.status === "confirmed" && (
          <>
            {canSell && (
              <>
                <form action={setSOStatus.bind(null, id, "draft")}>
                  <SubmitButton className="btn" pendingText="…">
                    Back to draft
                  </SubmitButton>
                </form>
                <form action={setSOStatus.bind(null, id, "cancelled")}>
                  <SubmitButton className="btn btn-danger" confirm="Cancel this order?" pendingText="…">
                    Cancel
                  </SubmitButton>
                </form>
              </>
            )}
            {canFulfill && (
              <form action={fulfillSO.bind(null, id)}>
                <SubmitButton pendingText="Pulling stock…" confirm="Pull stock for this order now? Oldest lots are used first.">
                  Fulfill oldest-first
                </SubmitButton>
              </form>
            )}
          </>
        )}
        {invoice && (
          <Link href={`/invoices/${invoice.id}`} className="btn btn-primary">
            View {invoice.invoice_number}
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />
      {anyShort && so.status !== "cancelled" && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some lines need more than is on hand. Fulfillment will be blocked until stock is received.
        </div>
      )}

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
                  <th className="num">Price</th>
                  <th className="num">Extended</th>
                  {showCost ? (
                    <>
                      <th className="num">FIFO cost</th>
                      <th className="num">Margin</th>
                    </>
                  ) : (
                    <th className="num">On hand</th>
                  )}
                  {isDraft && canSell && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <ItemCell path={r.products.image_path} name={r.products.name} sku={r.products.sku} category={r.products.category} />
                    </td>
                    <td className="num">
                      {qty(r.qty)} {r.product_units.name}
                      {Number(r.product_units.factor) !== 1 && (
                        <div className="text-xs text-stone-500">
                          {qty(Number(r.qty) * Number(r.product_units.factor))} {r.products.base_unit}
                        </div>
                      )}
                    </td>
                    <td className="num">{money(r.unit_price)}</td>
                    <td className="num">{money(r.revenue)}</td>
                    {showCost ? (
                      <>
                        <td className="num">{money(r.cost)}</td>
                        <td className="num">
                          {money(r.revenue - (r.cost ?? 0))}
                          <div className="text-xs text-stone-500">{pct(r.revenue ? (r.revenue - (r.cost ?? 0)) / r.revenue : null)}</div>
                        </td>
                      </>
                    ) : (
                      <td className={`num ${r.short ? "font-medium text-amber-700" : ""}`}>
                        {qty(r.onHand)} {r.products.base_unit}
                      </td>
                    )}
                    {isDraft && canSell && (
                      <td className="text-right">
                        <form action={removeSOLine.bind(null, id, r.id)}>
                          <SubmitButton className="btn btn-sm btn-danger" pendingText="…">
                            Remove
                          </SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right font-medium">
                    Subtotal
                  </td>
                  <td className="num font-semibold">{money(subtotal)}</td>
                  {showCost ? (
                    <>
                      <td className="num">{money(costTotal)}</td>
                      <td className="num font-semibold">
                        {money(subtotal - costTotal)}
                        <div className="text-xs font-normal text-stone-500">{pct(subtotal ? (subtotal - costTotal) / subtotal : null)}</div>
                      </td>
                    </>
                  ) : (
                    <td />
                  )}
                  {isDraft && canSell && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      {isDraft && canSell && (
        <Section title="Add line">
          <form action={addSOLine.bind(null, id)} className="card space-y-3">
            <ProductUnitPicker products={picker} priceName="unit_price" priceLabel="Price per unit" defaultUnit="smallest" />
            <p className="text-xs text-stone-500">
              Suggested price uses the {tier?.name ?? "default"} tier price, or average landed cost + {Number(tier?.markup_pct ?? 35)}% markup.
            </p>
            <SubmitButton>Add line</SubmitButton>
          </form>
        </Section>
      )}

      {pickLines.length > 0 && (
        <Section title="Or choose lots">
          <details className="group">
            <summary className="btn mb-3 cursor-pointer list-none">Hand-pick lots / scan to pick</summary>
            <PickForm lines={pickLines} action={fulfillSOPicked.bind(null, id)} />
          </details>
        </Section>
      )}

      {(canReturn || (returns ?? []).length > 0) && (
        <Section title="Returns & credits">
          {(returns ?? []).length > 0 && (
            <div className="table-wrap mb-4">
              <table className="table">
                <thead>
                  <tr>
                    <th>Return</th>
                    <th>When</th>
                    <th>Items</th>
                    <th>Reason</th>
                    <th className="num">Credit</th>
                    <th>Credit status</th>
                  </tr>
                </thead>
                <tbody>
                  {(returns ?? []).map((r: any) => (
                    <tr key={r.id}>
                      <td className="font-medium whitespace-nowrap">{r.return_number}</td>
                      <td className="whitespace-nowrap">{dateTime(r.created_at)}</td>
                      <td>
                        {r.return_lines.map((rl: any) => {
                          const line = rows.find((x) => x.id === rl.so_line_id);
                          return (
                            <div key={rl.so_line_id} className="text-sm">
                              {qty(rl.qty)} {line?.product_units.name} {line?.products.name}{" "}
                              <span className={rl.restock ? "text-brand-700" : "text-red-700"}>
                                ({rl.restock ? "restocked" : "written off"})
                              </span>
                            </div>
                          );
                        })}
                      </td>
                      <td>{r.reason ?? "—"}</td>
                      <td className="num">{money(r.total)}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={r.credit_status} />
                          {canSell && r.credit_status === "open" && (
                            <>
                              <form action={setCreditStatus.bind(null, r.id, "applied", `/sales/${id}`)}>
                                <SubmitButton className="btn btn-sm" pendingText="…">
                                  Applied
                                </SubmitButton>
                              </form>
                              <form action={setCreditStatus.bind(null, r.id, "refunded", `/sales/${id}`)}>
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
          {canReturn && (
            <details>
              <summary className="btn mb-3 cursor-pointer list-none">Record a return</summary>
              <form action={createReturn.bind(null, id, rows.map((r) => r.id))} className="card space-y-4">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Sold</th>
                        <th className="num">Returnable</th>
                        <th>Return qty</th>
                        <th>Resellable?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const factor = Number(r.product_units.factor);
                        const left = Number(r.qty) - (returnedBase.get(r.id) ?? 0) / factor;
                        return (
                          <tr key={r.id}>
                            <td>{r.products.name}</td>
                            <td className="num">
                              {qty(r.qty)} {r.product_units.name}
                            </td>
                            <td className="num">
                              {qty(left)} {r.product_units.name}
                            </td>
                            <td>
                              <input
                                name={`rqty_${r.id}`}
                                type="number"
                                min="0"
                                max={left}
                                step="any"
                                className="input w-24"
                                disabled={left <= 0}
                              />
                            </td>
                            <td>
                              <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name={`restock_${r.id}`} defaultChecked disabled={left <= 0} />
                                Restock
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Field label="Reason">
                  <input name="reason" className="input" placeholder="Wrong color, damaged in transit, over-shipped…" />
                </Field>
                <p className="text-xs text-stone-500">
                  Restocked items go back into the exact lots they shipped from. Unchecked items are returned and written off as shrink.
                  The customer gets a credit at the sale price{invoice ? " plus the invoice's tax rate" : ""}.
                </p>
                <SubmitButton pendingText="Recording…">Record return</SubmitButton>
              </form>
            </details>
          )}
        </Section>
      )}

      {so.status === "fulfilled" && canSell && (
        <Section title="Invoice">
          <form action={invoiceSO.bind(null, id)} className="card flex flex-wrap items-end gap-3">
            <Field label="Sales tax %">
              <input name="tax_rate" type="number" min="0" step="0.001" defaultValue={0} className="input w-28" />
            </Field>
            <p className="pb-2 text-xs text-stone-500">Leave at 0 for resale-exempt customers.</p>
            <SubmitButton pendingText="Creating…">Create invoice</SubmitButton>
          </form>
        </Section>
      )}

      <Section title="Details">
        <form action={updateSO.bind(null, id)} className="card">
          <fieldset disabled={!canSell || ["invoiced", "cancelled"].includes(so.status)} className="grid gap-4 sm:grid-cols-4">
            <Field label="Ship / pickup date">
              <input name="ship_date" type="date" className="input" defaultValue={so.ship_date ?? ""} />
            </Field>
            <Field label="Notes" className="sm:col-span-3">
              <input name="notes" className="input" defaultValue={so.notes ?? ""} />
            </Field>
            {canSell && !["invoiced", "cancelled"].includes(so.status) && (
              <div className="sm:col-span-4">
                <SubmitButton>Save details</SubmitButton>
              </div>
            )}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
