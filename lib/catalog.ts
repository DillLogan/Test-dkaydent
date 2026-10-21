import type { SupabaseClient } from "@supabase/supabase-js";
import type { PickerProduct } from "@/components/ProductUnitPicker";
import { qty } from "./format";

type Unit = { id: string; product_id: string; name: string; factor: number };

/** Active products with units, stock and average cost — for order-line pickers. */
export async function loadCatalog(supabase: SupabaseClient) {
  const [{ data: products }, { data: units }, { data: stock }] = await Promise.all([
    supabase.from("products").select("id, sku, name, base_unit, kind").eq("active", true).order("name"),
    supabase.from("product_units").select("id, product_id, name, factor"),
    supabase.from("v_product_stock").select("product_id, qty_on_hand_base, avg_cost_base"),
  ]);
  const unitsByProduct = new Map<string, Unit[]>();
  for (const u of (units ?? []) as Unit[]) {
    const list = unitsByProduct.get(u.product_id) ?? [];
    list.push({ ...u, factor: Number(u.factor) });
    unitsByProduct.set(u.product_id, list);
  }
  const stockById = new Map((stock ?? []).map((s) => [s.product_id, s]));
  return (products ?? []).map((p) => ({
    ...p,
    units: (unitsByProduct.get(p.id) ?? []).sort((a, b) => a.factor - b.factor),
    onHand: Number(stockById.get(p.id)?.qty_on_hand_base ?? 0),
    avgCost: stockById.get(p.id)?.avg_cost_base ? Number(stockById.get(p.id)!.avg_cost_base) : null,
  }));
}

export type CatalogItem = Awaited<ReturnType<typeof loadCatalog>>[number];

export function toPicker(
  items: CatalogItem[],
  opts: { showStock?: boolean; suggest?: (item: CatalogItem, unit: Unit) => number | undefined } = {},
): PickerProduct[] {
  return items.map((p) => {
    const suggested: Record<string, number> = {};
    if (opts.suggest) {
      for (const u of p.units) {
        const s = opts.suggest(p, u);
        if (s !== undefined && Number.isFinite(s)) suggested[u.id] = s;
      }
    }
    return {
      id: p.id,
      label: `${p.sku} — ${p.name}`,
      baseUnit: p.base_unit,
      note: opts.showStock ? `${qty(p.onHand)} ${p.base_unit} on hand` : undefined,
      units: p.units.map((u) => ({ id: u.id, name: u.name, factor: u.factor })),
      suggested,
    };
  });
}
