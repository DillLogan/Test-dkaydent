import type { SupabaseClient } from "@supabase/supabase-js";
import type { MapArea } from "@/components/MiniMap";

export const AREA_COLORS = ["#2e5234", "#3d6b8f", "#8a6d3b", "#7a5c99", "#9a4d6b", "#b0543a", "#5f7f3a", "#2f7f7a", "#a1452c", "#56607a"];

/** Floor plan: shape, background and the locations placed on it. */
export async function loadPlan(supabase: SupabaseClient) {
  const [{ data: layout }, { data: locations }] = await Promise.all([
    supabase.from("shop_layout").select("*").eq("id", 1).maybeSingle(),
    supabase.from("locations").select("id, name, kind, temp_c, active, map_x, map_y, map_w, map_h, map_color").order("name"),
  ]);
  const all = locations ?? [];
  const areas: MapArea[] = all
    .filter((l) => l.map_x !== null && l.map_w !== null)
    .map((l, i) => ({
      id: l.id,
      name: l.name,
      x: Number(l.map_x),
      y: Number(l.map_y),
      w: Number(l.map_w),
      h: Number(l.map_h),
      color: l.map_color || AREA_COLORS[i % AREA_COLORS.length],
    }));
  return {
    aspect: Number(layout?.aspect ?? 1.6),
    background: (layout?.background_path as string | null) ?? null,
    areas,
    locations: all,
  };
}
