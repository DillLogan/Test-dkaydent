import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { inUnits, money, qty, sum, unitMoney } from "@/lib/format";
import { addUnit, deleteTierPrice, deleteUnit, setTierPrice, updateProduct } from "../actions";
import { ProductFields } from "@/components/ProductFields";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
import { PhotoUpload } from "@/components/PhotoUpload";
import { MiniMap, type MapMark } from "@/components/MiniMap";
import { imageUrl } from "@/lib/images";
import { loadPlans } from "@/lib/plan";
import { removeProductPhoto, uploadProductPhoto } from "../../photos/actions";
import { setHomeArea, setHomeSpot } from "../../floor-plan/actions";
import { spotOptions, spotText } from "@/lib/spots";

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
  const [plans, { data: homes }] = await Promise.all([
    loadPlans(supabase),
    supabase.from("product_homes").select("layout_id, location_id, section_id, shelf").eq("product_id", id),
  ]);
  // One map per shop: its home area and the stock sitting there
  const shops = plans.map((plan) => {
    const homeRow = (homes ?? []).find((h) => h.layout_id === plan.layout.id) ?? null;
    const home = homeRow?.location_id ?? null;
    const homeSections = plan.sections.filter((x) => x.locationId === home);
    const ids = new Set(plan.locations.map((l) => l.id));
    const here = [...byLocation.keys()].filter((l) => ids.has(l));
    const marks: Record<string, MapMark> = {};
    for (const locId of here) marks[locId] = "here";
    if (home) marks[home] = marks[home] ? "both" : "home";
    return {
      plan,
      home,
      homeSections,
      spotNow: homeRow?.section_id ? `${homeRow.section_id}::${homeRow.shelf ?? ""}` : "",
      spotLabel: homeRow?.section_id ? spotText(homeSections.find((x) => x.id === homeRow.section_id)?.name, homeRow.shelf) : "",
      marks,
      homeName: plan.locations.find((l) => l.id === home)?.name,
      stockNames: here.map((l) => byLocation.get(l)!.name),
      misplaced: home ? here.filter((l) => l !== home) : [],
    };
  });
  const canPlace = can(profile, "buyer", "warehouse");

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={
          <>
            <span className="tabular-nums">{product.sku}</span> · {product.kind === "flower" ? "Flower" : "Hard good"}
            {product.category ? ` · ${product.category}` : ""}
          </>
        }
        back={{ href: "/products", label: "Products" }}
      >
        <Link href={`/labels?products=${id}`} className="btn">
          Print label
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
        <Section title="Photo">
          <PhotoUpload
            current={imageUrl(product.image_path)}
            alt={product.name}
            canEdit={canPlace}
            upload={uploadProductPhoto.bind(null, id)}
            remove={removeProductPhoto.bind(null, id)}
          />
        </Section>
        <Section title="Location in shop">
          <div className="space-y-6">
            {shops.map(({ plan, home, homeSections, spotNow, spotLabel, marks, homeName, stockNames, misplaced }) => (
              <div key={plan.layout.id} className="space-y-3">
                {shops.length > 1 && <h3 className="text-sm font-semibold">{plan.layout.name}</h3>}
                <MiniMap
                  aspect={plan.layout.aspect}
                  background={plan.layout.background}
                  areas={plan.areas}
                  marks={marks}
                  href={`/floor-plan?layout=${plan.layout.id}&item=${id}`}
                  caption={
                    <>
                      {homeName ? (
                        <>
                          Belongs in <b>{homeName}</b> (pulsing).{" "}
                        </>
                      ) : (
                        "No home area set. "
                      )}
                      {stockNames.length > 0 && <>Stock is in {stockNames.join(", ")}. </>}
                      {misplaced.length > 0 && <span className="font-medium text-amber-700">Some stock is outside its home area.</span>}
                    </>
                  }
                />
                {canPlace && (
                  <form action={setHomeArea.bind(null, id, plan.layout.id)} className="flex flex-wrap items-end gap-2">
                    <label className="min-w-48 flex-1">
                      <span className="label">Home area{shops.length > 1 ? ` in ${plan.layout.name}` : ""}</span>
                      <select name="location_id" defaultValue={home ?? ""} className="input">
                        <option value="">Not set</option>
                        {plan.locations
                          .filter((l) => l.active)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <SubmitButton className="btn">Save home area</SubmitButton>
                  </form>
                )}
                {home &&
                  (canPlace ? (
                    homeSections.length ? (
                      <form action={setHomeSpot.bind(null, id, plan.layout.id)} className="flex flex-wrap items-end gap-2" data-testid="home-spot">
                        <label className="min-w-48 flex-1">
                          <span className="label">Usual section and shelf</span>
                          <select name="spot" defaultValue={spotNow} className="input">
                            <option value="">Not set</option>
                            {spotOptions(homeSections).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <SubmitButton className="btn">Save spot</SubmitButton>
                      </form>
                    ) : (
                      <p className="text-xs text-stone-500">{homeName} has no sections yet. Add them on Location in shop.</p>
                    )
                  ) : (
                    spotLabel && (
                      <p className="text-sm">
                        Usual spot: <b>{spotLabel}</b>
                      </p>
                    )
                  ))}
              </div>
            ))}
          </div>
        </Section>
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
