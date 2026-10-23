import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { imageUrl } from "@/lib/images";
import { loadPlan } from "@/lib/plan";
import { FloorPlan, type PlanItem } from "@/components/FloorPlan";
import { PageHeader } from "@/components/ui";
import {
  addDoor,
  createLayout,
  deleteLayout,
  removeArea,
  removeDoor,
  removePlanBackground,
  renameLayout,
  saveArea,
  saveDoor,
  setHomeAreaInline,
  setFloorSize,
  uploadPlanBackground,
} from "./actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function FloorPlanPage({ searchParams }: { searchParams: SP }) {
  const { item, layout: layoutParam } = await searchParams;
  const { supabase, profile } = await getSession();
  const plan = await loadPlan(supabase, layoutParam);
  const layoutId = plan.layout.id;
  const locIds = plan.locations.map((l) => l.id);
  const [{ data: products }, { data: lots }, { data: homes }] = await Promise.all([
    supabase.from("products").select("id, sku, name, category, image_path, base_unit").eq("active", true).order("name"),
    locIds.length
      ? supabase.from("v_lot_aging").select("product_id, location_id, qty_on_hand_base").in("location_id", locIds)
      : Promise.resolve({ data: [] as { product_id: string; location_id: string; qty_on_hand_base: number }[] }),
    supabase.from("product_homes").select("product_id, location_id").eq("layout_id", layoutId),
  ]);

  // Stock and homes in this shop only
  const stock: Record<string, Record<string, number>> = {};
  for (const l of lots ?? []) {
    const s = (stock[l.product_id] ||= {});
    s[l.location_id] = (s[l.location_id] ?? 0) + Number(l.qty_on_hand_base);
  }
  const homeOf = new Map((homes ?? []).map((h) => [h.product_id, h.location_id as string]));
  const items: PlanItem[] = (products ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    image: p.image_path,
    baseUnit: p.base_unit,
    home: homeOf.get(p.id) ?? null,
    stock: stock[p.id] ?? {},
  }));

  return (
    <>
      <PageHeader
        title="Location in shop"
        subtitle="Where everything belongs on the floor, and where it actually is right now"
      />
      <FloorPlan
        key={layoutId}
        layout={{ id: layoutId, name: plan.layout.name }}
        layouts={plan.layouts.map((l) => ({ id: l.id, name: l.name }))}
        aspect={plan.layout.aspect}
        widthFt={plan.layout.widthFt}
        heightFt={plan.layout.heightFt}
        backgroundUrl={imageUrl(plan.layout.background)}
        areas={plan.areas}
        doors={plan.doors}
        locations={plan.locations.map((l) => ({ id: l.id, name: l.name, kind: l.kind, active: l.active }))}
        items={items}
        canEdit={can(profile, "warehouse")}
        canAssign={can(profile, "buyer", "warehouse")}
        initialItem={item ?? null}
        actions={{
          saveArea,
          removeArea,
          setFloorSize,
          uploadBackground: uploadPlanBackground,
          removeBackground: removePlanBackground,
          setHome: setHomeAreaInline,
          createLayout,
          renameLayout,
          deleteLayout,
          addDoor,
          saveDoor,
          removeDoor,
        }}
      />
    </>
  );
}
