import Link from "next/link";
import { getSession } from "@/lib/auth";
import { searchTerm } from "@/lib/forms";
import { date, money, qty, sum, unitMoney } from "@/lib/format";
import { Empty, ErrorBanner, ExpiryText, PageHeader, Stat, Tabs } from "@/components/ui";
import { ItemCell, ItemPhoto } from "@/components/ItemThumb";
import { ViewToggle } from "@/components/ViewToggle";
import { listView } from "@/lib/view";

type SP = Promise<Record<string, string | undefined>>;

export default async function InventoryPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = sp.view === "lots" ? "lots" : "stock";
  const { supabase } = await getSession();
  const term = searchTerm(sp.q);

  let lotsQ = supabase.from("v_lot_aging").select("*");
  if (term) lotsQ = lotsQ.or(`sku.ilike.%${term}%,product_name.ilike.%${term}%,lot_code.ilike.%${term}%`);
  if (sp.location) lotsQ = lotsQ.eq("location_id", sp.location);
  if (sp.kind === "flower" || sp.kind === "hard_good") lotsQ = lotsQ.eq("kind", sp.kind);
  if (sp.product) lotsQ = lotsQ.eq("product_id", sp.product);
  lotsQ =
    sp.sort === "expiry"
      ? lotsQ.order("expires_at", { ascending: true, nullsFirst: false })
      : lotsQ.order("received_at", { ascending: true });

  const [{ data: lots }, { data: locations }, lotView] = await Promise.all([
    lotsQ.limit(1000),
    supabase.from("locations").select("id, name").order("name"),
    listView("lots"),
  ]);
  const rows = lots ?? [];

  // Roll lots up per product for the stock view
  const byProduct = new Map<string, any>();
  for (const l of rows) {
    const p = byProduct.get(l.product_id) ?? {
      product_id: l.product_id,
      sku: l.sku,
      name: l.product_name,
      base_unit: l.base_unit,
      image: l.product_image,
      category: l.category,
      qty: 0,
      value: 0,
      lots: 0,
      oldest: l.age_days,
      soonest: l.days_to_expiry,
    };
    p.qty += Number(l.qty_on_hand_base);
    p.value += Number(l.value);
    p.lots += 1;
    p.oldest = Math.max(p.oldest, l.age_days);
    if (l.days_to_expiry !== null) p.soonest = p.soonest === null ? l.days_to_expiry : Math.min(p.soonest, l.days_to_expiry);
    byProduct.set(l.product_id, p);
  }
  const products = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
  const qs = (extra: Record<string, string>) =>
    "/inventory?" + new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), ...extra }).toString();

  return (
    <>
      <PageHeader title="Inventory" subtitle="What's on hand, where it is, and how old it is">
        <a
          href={`/export/lots?${new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && ["q", "location", "kind", "product"].includes(k))) as Record<string, string>)}`}
          className="btn"
        >
          Export CSV
        </a>
        <Link
          href={`/labels?${new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && ["q", "location", "kind", "product"].includes(k))) as Record<string, string>)}`}
          className="btn"
        >
          Print labels
        </Link>
        <Link href="/inventory/movements" className="btn">
          Movement log
        </Link>
        <Link href="/inventory/locations" className="btn">
          Locations
        </Link>
      </PageHeader>
      <ErrorBanner error={sp.error} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Value (filtered)" value={money(sum(rows, (l) => l.value))} />
        <Stat label="Products" value={products.length} />
        <Stat label="Lots" value={rows.length} />
        <Stat
          label="Expiring ≤ 3 days"
          value={rows.filter((l) => l.days_to_expiry !== null && l.days_to_expiry <= 3).length}
          href={qs({ view: "lots", sort: "expiry" })}
          tone="warn"
        />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={sp.q} placeholder="SKU, product or lot" className="input max-w-xs" />
        <select name="location" defaultValue={sp.location ?? ""} className="input w-auto">
          <option value="">All locations</option>
          {(locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select name="kind" defaultValue={sp.kind ?? ""} className="input w-auto">
          <option value="">All types</option>
          <option value="flower">Flowers / greens</option>
          <option value="hard_good">Hard goods</option>
        </select>
        {view === "lots" && (
          <select name="sort" defaultValue={sp.sort ?? ""} className="input w-auto">
            <option value="">Oldest first</option>
            <option value="expiry">Expiring first</option>
          </select>
        )}
        <button className="btn">Apply</button>
        {(sp.q || sp.location || sp.kind || sp.product) && (
          <Link href={`/inventory?view=${view}`} className="btn">
            Clear
          </Link>
        )}
      </form>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          current={view}
          items={[
            { key: "stock", label: "By product", href: qs({ view: "stock" }) },
            { key: "lots", label: "By lot", href: qs({ view: "lots" }) },
          ]}
        />
        {view === "lots" && rows.length > 0 && (
          <div className="mb-4">
            <ViewToggle list="lots" view={lotView} />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty>Nothing on hand matches. Receive a purchase order to add stock.</Empty>
      ) : view === "stock" ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num">Lots</th>
                <th className="num">Oldest</th>
                <th>Soonest expiry</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_id}>
                  <td>
                    <ItemCell path={p.image} name={p.name} sku={p.sku} category={p.category}>
                      <Link href={`/products/${p.product_id}`} className="link">
                        {p.name}
                      </Link>
                    </ItemCell>
                  </td>
                  <td className="num">
                    {qty(p.qty)} {p.base_unit}
                  </td>
                  <td className="num">
                    <Link href={qs({ view: "lots", product: p.product_id })} className="link">
                      {p.lots}
                    </Link>
                  </td>
                  <td className="num">{p.oldest}d</td>
                  <td>
                    <ExpiryText days={p.soonest} />
                  </td>
                  <td className="num">{money(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : lotView === "cards" ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="lot-cards">
          {rows.map((l) => (
            <li key={l.lot_id} className="lift group overflow-hidden rounded-2xl border border-stone-200/80 bg-white" style={{ boxShadow: "var(--shadow-soft)" }}>
              <Link href={`/inventory/lots/${l.lot_id}`} className="block">
                <div className="relative">
                  <ItemPhoto path={l.lot_image || l.product_image} name={l.product_name} category={l.category} />
                  <span className="absolute right-2.5 bottom-2.5 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-medium text-stone-800 shadow-sm">
                    {l.location_name}
                  </span>
                </div>
                <div className="space-y-1 p-3.5">
                  <div className="leading-snug font-medium text-stone-900 group-hover:text-brand-700">{l.product_name}</div>
                  <div className="text-xs text-stone-500 tabular-nums">
                    Lot {l.lot_code} · received {date(l.received_at)}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 pt-1 text-sm">
                    <span className="text-stone-700">
                      {qty(l.qty_on_hand_base)} {l.base_unit}
                    </span>
                    <span className="text-xs">
                      {l.days_to_expiry !== null ? (
                        <>
                          Expires <ExpiryText days={l.days_to_expiry} />
                        </>
                      ) : (
                        <span className="text-stone-500">{l.age_days}d old</span>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Product</th>
                <th>Location</th>
                <th>Received</th>
                <th className="num">Age</th>
                <th>Expires</th>
                <th className="num">On hand</th>
                <th className="num">Cost / base</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.lot_id}>
                  <td>
                    <Link href={`/inventory/lots/${l.lot_id}`} className="link text-xs font-medium tabular-nums">
                      {l.lot_code}
                    </Link>
                  </td>
                  <td>
                    <ItemCell path={l.lot_image || l.product_image} name={l.product_name} category={l.category} />
                  </td>
                  <td>{l.location_name}</td>
                  <td>{date(l.received_at)}</td>
                  <td className="num">{l.age_days}d</td>
                  <td>
                    <ExpiryText days={l.days_to_expiry} />
                  </td>
                  <td className="num">
                    {qty(l.qty_on_hand_base)} {l.base_unit}
                  </td>
                  <td className="num">{unitMoney(l.unit_cost_base)}</td>
                  <td className="num">{money(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
