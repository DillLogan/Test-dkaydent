import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { imageUrl } from "@/lib/images";
import { loadPlan } from "@/lib/plan";
import { FloorPlan, type PlanItem } from "@/components/FloorPlan";
import { PageHeader } from "@/components/ui";
import { removeArea, removePlanBackground, saveArea, setHomeAreaInline, setPlanShape, uploadPlanBackground } from "./actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function FloorPlanPage({ searchParams }: { searchParams: SP }) {
  const { item } = await searchParams;
  const { supabase, profile } = await getSession();
  const [plan, { data: products }, { data: lots }] = await Promise.all([
    loadPlan(supabase),
    supabase.from("products").select("id, sku, name, category, image_path, base_unit, home_location_id").eq("active", true).order("name"),
    supabase.from("v_lot_aging").select("product_id, location_id, qty_on_hand_base"),
  ]);

  const stock: Record<string, Record<string, number>> = {};
  for (const l of lots ?? []) {
    const s = (stock[l.product_id] ||= {});
    s[l.location_id] = (s[l.location_id] ?? 0) + Number(l.qty_on_hand_base);
  }
  const items: PlanItem[] = (products ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    image: p.image_path,
    baseUnit: p.base_unit,
    home: p.home_location_id,
    stock: stock[p.id] ?? {},
  }));

  return (
    <>
      <PageHeader
        title="Location in shop"
        subtitle="Where everything belongs on the floor, and where it actually is right now"
      />
      <FloorPlan
        aspect={plan.aspect}
        backgroundUrl={imageUrl(plan.background)}
        areas={plan.areas}
        locations={plan.locations.map((l) => ({ id: l.id, name: l.name, kind: l.kind, active: l.active }))}
        items={items}
        canEdit={can(profile, "warehouse")}
        canAssign={can(profile, "buyer", "warehouse")}
        initialItem={item ?? null}
        actions={{
          saveArea,
          removeArea,
          setPlanShape,
          uploadBackground: uploadPlanBackground,
          removeBackground: removePlanBackground,
          setHome: setHomeAreaInline,
        }}
      />
    </>
  );
}
