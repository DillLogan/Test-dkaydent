import type { SupabaseClient } from "@supabase/supabase-js";
import type { MapArea } from "@/components/MiniMap";
import { rectPoints, validShape, type Pt } from "@/lib/shapes";

export const AREA_COLORS = ["#2e5234", "#3d6b8f", "#8a6d3b", "#7a5c99", "#9a4d6b", "#b0543a", "#5f7f3a", "#2f7f7a", "#a1452c", "#56607a"];

export type Layout = { id: string; name: string; aspect: number; background: string | null; widthFt: number | null; heightFt: number | null };
export type DoorSide = "top" | "right" | "bottom" | "left";
export type PlanDoor = { id: string; kind: "entry" | "exit"; label: string; side: DoorSide; pos: number };
export type PlanLocationRow = { id: string; name: string; kind: string; temp_c: number | null; active: boolean; layout_id: string };

type LocRow = PlanLocationRow & {
  map_x: number | null;
  map_y: number | null;
  map_w: number | null;
  map_h: number | null;
  map_color: string | null;
  map_shape: unknown;
};

function toAreas(rows: LocRow[]): MapArea[] {
  return rows
    .filter((l) => l.map_x !== null && l.map_w !== null)
    .map((l, i) => ({
      id: l.id,
      name: l.name,
      x: Number(l.map_x),
      y: Number(l.map_y),
      w: Number(l.map_w),
      h: Number(l.map_h),
      color: l.map_color || AREA_COLORS[i % AREA_COLORS.length],
      points: validShape(l.map_shape) ? (l.map_shape as Pt[]) : rectPoints(Number(l.map_x), Number(l.map_y), Number(l.map_w), Number(l.map_h)),
    }));
}

/** Every shop's floor plan: shape, background, its sections and entries/exits. */
export async function loadPlans(supabase: SupabaseClient) {
  const [{ data: layouts }, { data: locations }, { data: doors }] = await Promise.all([
    supabase.from("shop_layouts").select("id, name, aspect, background_path, width_ft, height_ft").order("created_at").order("id"),
    supabase
      .from("locations")
      .select("id, name, kind, temp_c, active, layout_id, map_x, map_y, map_w, map_h, map_color, map_shape")
      .order("name"),
    supabase.from("plan_doors").select("id, layout_id, kind, label, side, pos").order("created_at"),
  ]);
  const locs = (locations ?? []) as LocRow[];
  return (layouts ?? []).map((l) => {
    const mine = locs.filter((x) => x.layout_id === l.id);
    return {
      layout: {
        id: l.id,
        name: l.name,
        aspect: Number(l.aspect),
        background: (l.background_path as string | null) ?? null,
        widthFt: l.width_ft === null ? null : Number(l.width_ft),
        heightFt: l.height_ft === null ? null : Number(l.height_ft),
      } as Layout,
      areas: toAreas(mine),
      locations: mine.map(({ id, name, kind, temp_c, active, layout_id }) => ({ id, name, kind, temp_c, active, layout_id })),
      doors: (doors ?? [])
        .filter((d) => d.layout_id === l.id)
        .map((d) => ({ id: d.id, kind: d.kind, label: d.label, side: d.side, pos: Number(d.pos) }) as PlanDoor),
    };
  });
}

/** One shop's plan (the first shop when none is chosen), plus the list of shops. */
export async function loadPlan(supabase: SupabaseClient, layoutId?: string | null) {
  const plans = await loadPlans(supabase);
  const plan = plans.find((p) => p.layout.id === layoutId) ?? plans[0];
  return { ...plan, layouts: plans.map((p) => p.layout) };
}
