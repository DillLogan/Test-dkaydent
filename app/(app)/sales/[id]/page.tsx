import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog, toPicker } from "@/lib/catalog";
import { date, money, pct, qty, sum } from "@/lib/format";
import { addSOLine, deleteSO, fulfillSO, invoiceSO, removeSOLine, setSOStatus, updateSO } from "../actions";
import { ProductUnitPicker } from "@/components/ProductUnitPicker";
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
      .select("*, products(sku, name, base_unit), product_units(name, factor)")
      .eq("so_id", id)
      .order("created_at"),
    supabase.from("invoices").select("id, invoice_number").eq("so_id", id).maybeSingle(),
  ]);
  if (!so) notFound();

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
                  Fulfill (pull stock)
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
                      {r.products.name}
                      <div className="font-mono text-xs text-stone-500">{r.products.sku}</div>
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
