import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { searchTerm } from "@/lib/forms";
import { money, qty, unitMoney } from "@/lib/format";
import { Empty, ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const { q, kind, error, inactive } = await searchParams;
  const { supabase, profile } = await getSession();

  let query = supabase.from("v_product_stock").select("*").order("name");
  const term = searchTerm(q);
  if (term) query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%,category.ilike.%${term}%`);
  if (kind === "flower" || kind === "hard_good") query = query.eq("kind", kind);
  if (!inactive) query = query.eq("active", true);
  const { data: products } = await query;

  return (
    <>
      <PageHeader title="Products" subtitle="Flowers, greens and hard goods with their units and stock">
        {can(profile, "buyer") && (
          <Link href="/products/new" className="btn btn-primary">
            New product
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={q} placeholder="Search SKU, name, category" className="input max-w-xs" />
        <select name="kind" defaultValue={kind ?? ""} className="input w-auto">
          <option value="">All types</option>
          <option value="flower">Flowers / greens</option>
          <option value="hard_good">Hard goods</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-stone-600">
          <input type="checkbox" name="inactive" value="1" defaultChecked={!!inactive} /> Include inactive
        </label>
        <button className="btn">Filter</button>
      </form>

      {!products?.length ? (
        <Empty>No products found.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
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
                const low = Number(p.reorder_point_base) > 0 && Number(p.qty_on_hand_base) <= Number(p.reorder_point_base);
                return (
                  <tr key={p.product_id}>
                    <td className="font-mono text-xs whitespace-nowrap">{p.sku}</td>
                    <td>
                      <Link href={`/products/${p.product_id}`} className="link">
                        {p.name}
                      </Link>{" "}
                      {!p.active && <StatusBadge status="inactive" />}
                      <div className="text-xs text-stone-500">{p.kind === "flower" ? "Flower" : "Hard good"}</div>
                    </td>
                    <td>{p.category ?? "—"}</td>
                    <td className={`num ${low ? "font-medium text-amber-700" : ""}`}>
                      {qty(p.qty_on_hand_base)} {p.base_unit}
                    </td>
                    <td className="num">{p.avg_cost_base ? `${unitMoney(p.avg_cost_base)}/${p.base_unit}` : "—"}</td>
                    <td className="num">{money(p.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
