import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { inUnits, money, qty, sum, unitMoney } from "@/lib/format";
import { addUnit, deleteTierPrice, deleteUnit, setTierPrice, updateProduct } from "../actions";
import { ProductFields } from "@/components/ProductFields";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function ProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: product }, { data: units }, { data: tiers }, { data: lots }, { data: stock }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("product_units").select("*").eq("product_id", id).order("factor"),
    supabase.from("price_tiers").select("*").order("name"),
    supabase.from("v_lot_aging").select("*").eq("product_id", id).order("received_at"),
    supabase.from("v_product_stock").select("*").eq("product_id", id).maybeSingle(),
  ]);
  if (!product) notFound();

  const unitIds = (units ?? []).map((u) => u.id);
  const { data: tierPrices } = unitIds.length
    ? await supabase.from("tier_prices").select("*").in("product_unit_id", unitIds)
    : { data: [] as any[] };

  const canBuy = can(profile, "buyer");
  const canSell = can(profile, "sales");
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));
  const tierById = new Map((tiers ?? []).map((t) => [t.id, t]));

  const byLocation = new Map<string, { name: string; qty: number; value: number }>();
  for (const l of lots ?? []) {
    const cur = byLocation.get(l.location_id) ?? { name: l.location_name, qty: 0, value: 0 };
    cur.qty += Number(l.qty_on_hand_base);
    cur.value += Number(l.value);
    byLocation.set(l.location_id, cur);
  }
  const onHand = sum(lots, (l) => l.qty_on_hand_base);

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={
          <>
            <span className="font-mono">{product.sku}</span> · {product.kind === "flower" ? "Flower" : "Hard good"}
            {product.category ? ` · ${product.category}` : ""}
          </>
        }
        back={{ href: "/products", label: "Products" }}
      >
        <Link href={`/labels?products=${id}`} className="btn">
          Print SKU label
        </Link>
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card">
          <div className="label">On hand</div>
          <div className="text-xl font-semibold">{inUnits(onHand, units ?? [], product.base_unit)}</div>
          <div className="text-xs text-stone-500">
            {qty(onHand)} {product.base_unit}
          </div>
        </div>
        <div className="card">
          <div className="label">Inventory value</div>
          <div className="text-xl font-semibold">{money(stock?.value)}</div>
        </div>
        <div className="card">
          <div className="label">Avg landed cost</div>
          <div className="text-xl font-semibold">
            {stock?.avg_cost_base ? unitMoney(stock.avg_cost_base) : "—"}
          </div>
          <div className="text-xs text-stone-500">per {product.base_unit}</div>
        </div>
        <div className="card">
          <div className="label">Reorder point</div>
          <div className="text-xl font-semibold">{qty(product.reorder_point_base)}</div>
          <div className="text-xs text-stone-500">{product.base_unit}</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Units">
          <div className="table-wrap mb-3">
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th className="num">Contains</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(units ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name}</td>
                    <td className="num">
                      {qty(u.factor)} {product.base_unit}
                    </td>
                    <td className="text-right">
                      {canBuy && u.name !== product.base_unit && (
                        <form action={deleteUnit.bind(null, id, u.id)}>
                          <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={`Remove unit "${u.name}"?`}>
                            Remove
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canBuy && (
            <form action={addUnit.bind(null, id)} className="flex flex-wrap items-end gap-2">
              <label>
                <span className="label">New unit</span>
                <input name="name" className="input w-32" placeholder="box" required />
              </label>
              <label>
                <span className="label">{product.base_unit} per unit</span>
                <input name="factor" type="number" min="0" step="any" className="input w-28" required />
              </label>
              <SubmitButton className="btn">Add unit</SubmitButton>
            </form>
          )}
        </Section>

        <Section title="Stock by location">
          {byLocation.size === 0 ? (
            <Empty>No stock on hand.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th className="num">Qty</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byLocation.entries()].map(([locId, l]) => (
                    <tr key={locId}>
                      <td>{l.name}</td>
                      <td className="num">{inUnits(l.qty, units ?? [], product.base_unit)}</td>
                      <td className="num">{money(l.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href={`/inventory?view=lots&product=${id}`} className="link mt-2 inline-block text-sm">
            View lots →
          </Link>
        </Section>
      </div>

      <Section title="Tier pricing">
        <p className="mb-3 text-sm text-stone-500">
          Set prices per customer tier. Where no price is set, sales orders suggest average cost plus the tier&apos;s markup.
        </p>
        {(tierPrices ?? []).length > 0 && (
          <div className="table-wrap mb-3">
            <table className="table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Unit</th>
                  <th className="num">Price</th>
                  <th className="num">Margin at avg cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(tierPrices ?? []).map((tp) => {
                  const u = unitById.get(tp.product_unit_id);
                  const cost = stock?.avg_cost_base ? Number(stock.avg_cost_base) * Number(u?.factor ?? 1) : null;
                  return (
                    <tr key={tp.id}>
                      <td>{tierById.get(tp.tier_id)?.name}</td>
                      <td>{u?.name}</td>
                      <td className="num">{money(tp.price)}</td>
                      <td className="num">
                        {cost && Number(tp.price) > 0 ? `${(((Number(tp.price) - cost) / Number(tp.price)) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="text-right">
                        {canSell && (
                          <form action={deleteTierPrice.bind(null, id, tp.id)}>
                            <SubmitButton className="btn btn-sm btn-danger" pendingText="…">
                              Remove
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canSell && (tiers ?? []).length > 0 && (
          <form action={setTierPrice.bind(null, id)} className="flex flex-wrap items-end gap-2">
            <label>
              <span className="label">Tier</span>
              <select name="tier_id" className="input w-auto">
                {(tiers ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Unit</span>
              <select name="product_unit_id" className="input w-auto">
                {(units ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Price</span>
              <input name="price" type="number" min="0" step="0.01" className="input w-28" required />
            </label>
            <SubmitButton className="btn">Set price</SubmitButton>
          </form>
        )}
        {(tiers ?? []).length === 0 && (
          <Empty>
            No price tiers yet. <Link href="/customers/tiers" className="link">Create tiers</Link>
          </Empty>
        )}
      </Section>

      <Section title="Details">
        <form action={updateProduct.bind(null, id)} className="card space-y-4">
          <fieldset disabled={!canBuy} className="space-y-4">
            <ProductFields product={product} />
            {canBuy && <SubmitButton>Save changes</SubmitButton>}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
