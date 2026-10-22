import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { searchTerm } from "@/lib/forms";
import { money, qty, unitMoney } from "@/lib/format";
import { Empty, ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";
import { ItemPhoto, ItemThumb } from "@/components/ItemThumb";
import { ViewToggle } from "@/components/ViewToggle";
import { listView } from "@/lib/view";

type SP = Promise<Record<string, string | undefined>>;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const { q, kind, error, inactive } = await searchParams;
  const { supabase, profile } = await getSession();

  let query = supabase.from("v_product_stock").select("*").order("name");
  const term = searchTerm(q);
  if (term)
    query = query.or(
      `sku.ilike.%${term}%,name.ilike.%${term}%,category.ilike.%${term}%`,
    );
  if (kind === "flower" || kind === "hard_good") query = query.eq("kind", kind);
  if (!inactive) query = query.eq("active", true);
  const [{ data: products }, view] = await Promise.all([query, listView("products")]);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Flowers, greens and hard goods with their units and stock"
      >
        <Link href="/products/categories" className="btn">
          Category rules
        </Link>
        <a href="/export/products" className="btn">
          Export CSV
        </a>
        {can(profile, "buyer") && (
          <Link href="/import?entity=products" className="btn">
            Import
          </Link>
        )}
        {can(profile, "buyer") && (
          <Link href="/products/new" className="btn btn-primary">
            New product
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search SKU, name, category"
          className="input max-w-xs"
        />
        <select name="kind" defaultValue={kind ?? ""} className="input w-auto">
          <option value="">All types</option>
          <option value="flower">Flowers / greens</option>
          <option value="hard_good">Hard goods</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-stone-600">
          <input
            type="checkbox"
            name="inactive"
            value="1"
            defaultChecked={!!inactive}
          />{" "}
          Include inactive
        </label>
        <button className="btn">Filter</button>
      </form>

      {!products?.length ? (
        <Empty>No products found.</Empty>
      ) : (
        <form action="/labels" method="get">
          <input type="hidden" name="from" value="products" />
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button className="btn">Print labels for selected</button>
            <span className="text-xs text-stone-500">
              Tick any products, then print. Uses your print settings.
            </span>
            <span className="ml-auto">
              <ViewToggle list="products" view={view} />
            </span>
          </div>
          {view === "cards" ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="product-cards">
              {products.map((p) => {
                const low = Number(p.reorder_point_base) > 0 && Number(p.qty_on_hand_base) <= Number(p.reorder_point_base);
                return (
                  <li key={p.product_id} className="lift group relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white" style={{ boxShadow: "var(--shadow-soft)" }}>
                    <label className="absolute top-2.5 left-2.5 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-white/90 shadow-sm">
                      <input type="checkbox" name="pid" value={p.product_id} aria-label={`Select ${p.name} for labels`} />
                    </label>
                    <Link href={`/products/${p.product_id}`} className="block">
                      <ItemPhoto path={p.image_path} name={p.name} category={p.category} />
                      <div className="space-y-1 p-3.5">
                        <div className="leading-snug font-medium text-stone-900 group-hover:text-brand-700">
                          {p.name} {!p.active && <StatusBadge status="inactive" />}
                        </div>
                        <div className="text-xs text-stone-500">
                          {p.category ?? (p.kind === "flower" ? "Flower" : "Hard good")} · <span className="tabular-nums">{p.sku}</span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 pt-1 text-sm">
                          <span className={low ? "font-medium text-amber-700" : "text-stone-700"}>
                            {qty(p.qty_on_hand_base)} {p.base_unit}
                          </span>
                          <span className="text-xs text-stone-500 tabular-nums">
                            {p.avg_cost_base ? `${unitMoney(p.avg_cost_base)}/${p.base_unit}` : ""}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">
                    <span className="sr-only">Select</span>
                  </th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th className="num">On hand</th>
                  <th className="num">Avg cost</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const low =
                    Number(p.reorder_point_base) > 0 &&
                    Number(p.qty_on_hand_base) <= Number(p.reorder_point_base);
                  return (
                    <tr key={p.product_id}>
                      <td>
                        <input
                          type="checkbox"
                          name="pid"
                          value={p.product_id}
                          aria-label={`Select ${p.name} for labels`}
                        />
                      </td>
                      <td className="text-xs whitespace-nowrap text-stone-500 tabular-nums">
                        {p.sku}
                      </td>
                      <td>
                        <div className="flex items-start gap-2.5">
                          <ItemThumb
                            path={p.image_path}
                            name={p.name}
                            category={p.category}
                            size={36}
                          />
                          <div>
                            <Link
                              href={`/products/${p.product_id}`}
                              className="link"
                            >
                              {p.name}
                            </Link>{" "}
                            {!p.active && <StatusBadge status="inactive" />}
                            <div className="text-xs text-stone-500">
                              {p.kind === "flower" ? "Flower" : "Hard good"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{p.category ?? "—"}</td>
                      <td
                        className={`num ${low ? "font-medium text-amber-700" : ""}`}
                      >
                        {qty(p.qty_on_hand_base)} {p.base_unit}
                      </td>
                      <td className="num">
                        {p.avg_cost_base
                          ? `${unitMoney(p.avg_cost_base)}/${p.base_unit}`
                          : "—"}
                      </td>
                      <td className="num">{money(p.value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </form>
      )}
    </>
  );
}
