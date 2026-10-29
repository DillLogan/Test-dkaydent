"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";
import { IMAGE_BUCKET } from "@/lib/images";
import { bbox, clamp, clampPts, validShape, type Pt } from "@/lib/shapes";
import { splitSpot } from "@/lib/spots";

type Result = { error?: string };

/** Save an area's outline (points in percent of the plan) and colour. Called while editing the plan. */
export async function saveArea(id: string, area: { points: Pt[]; color?: string }): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  if (!validShape(area.points)) return { error: "That shape needs at least 3 points on the plan." };
  const pts = clampPts(area.points);
  const b = bbox(pts);
  const patch: Record<string, unknown> = {
    map_shape: pts,
    map_x: clamp(b.x, 0, 100),
    map_y: clamp(b.y, 0, 100),
    map_w: clamp(Math.max(b.w, 0.1), 0.1, 100),
    map_h: clamp(Math.max(b.h, 0.1), 0.1, 100),
  };
  if (area.color && /^#[0-9a-fA-F]{6}$/.test(area.color)) patch.map_color = area.color;
  // the id is a location's or a section's
  const { data: hit, error } = await supabase.from("locations").update(patch).eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!hit?.length) {
    const { error: e2 } = await supabase.from("location_sections").update(patch).eq("id", id);
    if (e2) return { error: dbMessage(e2) };
  }
  revalidatePath("/floor-plan");
  return {};
}

/**
 * Set the floor's real size. Areas keep their size in feet: when a size was
 * already set, their outlines are rescaled to the new floor (and kept on it).
 */
export async function setFloorSize(layoutId: string, widthFt: number, heightFt: number): Promise<Result & { aspect?: number }> {
  const { supabase } = await requireRole("warehouse");
  if (!(widthFt > 0 && widthFt <= 5000 && heightFt > 0 && heightFt <= 5000)) return { error: "Enter the floor's width and depth in feet (up to 5,000)." };
  const { data: lay, error: e1 } = await supabase.from("shop_layouts").select("width_ft, height_ft, background_path, aspect").eq("id", layoutId).single();
  if (e1 || !lay) return { error: "Layout not found." };
  // a floor image fixes the shape: depth follows the width
  const h = lay.background_path ? Math.round((widthFt / Number(lay.aspect)) * 10) / 10 : heightFt;
  const aspect = Math.round((widthFt / h) * 1000) / 1000;
  if (!(aspect >= 0.3 && aspect <= 4)) return { error: "That floor is too long and narrow to draw. Keep width ÷ depth between 0.3 and 4." };
  if (lay.width_ft && lay.height_ft) {
    const sx = Number(lay.width_ft) / widthFt;
    const sy = Number(lay.height_ft) / h;
    if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) {
      const { data: locs } = await supabase.from("locations").select("id, map_shape").eq("layout_id", layoutId).not("map_shape", "is", null);
      const { data: allLocs } = await supabase.from("locations").select("id").eq("layout_id", layoutId);
      const { data: secs } = (allLocs ?? []).length
        ? await supabase.from("location_sections").select("id, map_shape").in("location_id", (allLocs ?? []).map((x) => x.id)).not("map_shape", "is", null)
        : { data: [] as { id: string; map_shape: unknown }[] };
      for (const sec of secs ?? []) {
        if (!validShape(sec.map_shape)) continue;
        const pts = clampPts((sec.map_shape as Pt[]).map(([x, y]) => [x * sx, y * sy] as Pt));
        if (!validShape(pts)) continue;
        const b = bbox(pts);
        await supabase.from("location_sections").update({ map_shape: pts, map_x: b.x, map_y: b.y, map_w: Math.max(b.w, 0.1), map_h: Math.max(b.h, 0.1) }).eq("id", sec.id);
      }
      for (const l of locs ?? []) {
        if (!validShape(l.map_shape)) continue;
        const pts = clampPts((l.map_shape as Pt[]).map(([x, y]) => [x * sx, y * sy] as Pt));
        if (!validShape(pts)) continue;
        const b = bbox(pts);
        await supabase
          .from("locations")
          .update({ map_shape: pts, map_x: b.x, map_y: b.y, map_w: Math.max(b.w, 0.1), map_h: Math.max(b.h, 0.1) })
          .eq("id", l.id);
      }
    }
  }
  const { error } = await supabase
    .from("shop_layouts")
    .update({ width_ft: widthFt, height_ft: h, aspect, updated_at: new Date().toISOString() })
    .eq("id", layoutId);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return { aspect };
}

export async function removeArea(id: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const off = { map_x: null, map_y: null, map_w: null, map_h: null, map_shape: null };
  const { data: hit, error } = await supabase.from("locations").update(off).eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!hit?.length) {
    const { error: e2 } = await supabase.from("location_sections").update(off).eq("id", id);
    if (e2) return { error: dbMessage(e2) };
  }
  revalidatePath("/floor-plan");
  return {};
}

const layoutName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const unique = (e: { message: string }) => (e.message.includes("shop_layouts_name_uidx") ? "A layout with that name already exists." : dbMessage(e));

export async function uploadPlanBackground(fd: FormData): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const layoutId = String(fd.get("layout_id") ?? "");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (file.size > 5 * 1024 * 1024) return { error: "That image is over 5 MB even after shrinking." };
  const aspect = Math.min(4, Math.max(0.3, Number(fd.get("aspect")) || 1.6));
  const path = `plan/${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp"}`;
  const { data: old, error: findErr } = await supabase.from("shop_layouts").select("background_path, width_ft").eq("id", layoutId).single();
  if (findErr) return { error: "Layout not found." };
  const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (upErr) return { error: upErr.message.includes("row-level security") ? "Your role can't upload images." : upErr.message };
  // The plan takes the image's shape so areas line up with what's drawn
  const { error } = await supabase
    .from("shop_layouts")
    .update({
      background_path: path,
      aspect: Math.round(aspect * 1000) / 1000,
      // with a floor size set, the depth follows the image's shape
      ...(old?.width_ft ? { height_ft: Math.round((Number(old.width_ft) / aspect) * 10) / 10 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", layoutId);
  if (error) return { error: dbMessage(error) };
  if (old?.background_path) await supabase.storage.from(IMAGE_BUCKET).remove([old.background_path]).catch(() => {});
  revalidatePath("/floor-plan");
  return {};
}

export async function removePlanBackground(layoutId: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { data: old } = await supabase.from("shop_layouts").select("background_path").eq("id", layoutId).single();
  const { error } = await supabase.from("shop_layouts").update({ background_path: null }).eq("id", layoutId);
  if (error) return { error: dbMessage(error) };
  if (old?.background_path) await supabase.storage.from(IMAGE_BUCKET).remove([old.background_path]).catch(() => {});
  revalidatePath("/floor-plan");
  return {};
}

// ---------- Layouts ----------
export async function createLayout(name: string): Promise<Result & { id?: string }> {
  const { supabase } = await requireRole("warehouse");
  const n = layoutName(name);
  if (!n) return { error: "Name the layout." };
  if (n.length > 60) return { error: "Keep the name under 60 characters." };
  const { data, error } = await supabase.from("shop_layouts").insert({ name: n }).select("id").single();
  if (error) return { error: unique(error) };
  revalidatePath("/floor-plan");
  return { id: data.id };
}

export async function renameLayout(id: string, name: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const n = layoutName(name);
  if (!n) return { error: "Name the layout." };
  if (n.length > 60) return { error: "Keep the name under 60 characters." };
  const { error } = await supabase.from("shop_layouts").update({ name: n, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: unique(error) };
  revalidatePath("/floor-plan");
  return {};
}

export async function deleteLayout(id: string, moveTo: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { data: old } = await supabase.from("shop_layouts").select("background_path").eq("id", id).single();
  const { error } = await supabase.rpc("delete_shop_layout", { p_id: id, p_move_to: moveTo });
  if (error) return { error: dbMessage(error) };
  if (old?.background_path) await supabase.storage.from(IMAGE_BUCKET).remove([old.background_path]).catch(() => {});
  revalidatePath("/floor-plan");
  return {};
}

// ---------- Entries and exits ----------
const SIDES = ["top", "right", "bottom", "left"];
type DoorPatch = { kind?: string; label?: string; side?: string; pos?: number };
function cleanDoor(d: DoorPatch): { error?: string; patch: Record<string, unknown> } {
  const patch: Record<string, unknown> = {};
  if (d.kind !== undefined) {
    if (d.kind !== "entry" && d.kind !== "exit") return { error: "Choose Entry or Exit.", patch };
    patch.kind = d.kind;
  }
  if (d.label !== undefined) {
    const l = d.label.trim().replace(/\s+/g, " ");
    if (!l) return { error: "Give it a label, like Front door.", patch };
    if (l.length > 60) return { error: "Keep the label under 60 characters.", patch };
    patch.label = l;
  }
  if (d.side !== undefined) {
    if (!SIDES.includes(d.side)) return { error: "Put it on a wall.", patch };
    patch.side = d.side;
  }
  if (d.pos !== undefined) patch.pos = clamp(d.pos, 0, 100);
  return { patch };
}

export async function addDoor(layoutId: string, d: { kind: string; label: string; side: string; pos: number }): Promise<Result & { id?: string }> {
  const { supabase } = await requireRole("warehouse");
  const { error: bad, patch } = cleanDoor(d);
  if (bad) return { error: bad };
  const { data, error } = await supabase.from("plan_doors").insert({ layout_id: layoutId, ...patch }).select("id").single();
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return { id: data.id };
}

export async function saveDoor(id: string, d: DoorPatch): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { error: bad, patch } = cleanDoor(d);
  if (bad) return { error: bad };
  const { error } = await supabase.from("plan_doors").update(patch).eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

export async function removeDoor(id: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { error } = await supabase.from("plan_doors").delete().eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

// ---------- Home areas (one per shop) ----------
/** Form action from the item page. */
export async function setHomeArea(productId: string, layoutId: string, fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `/products/${productId}`;
  const { error } = await supabase.rpc("set_home_location", {
    p_product_id: productId,
    p_layout_id: layoutId,
    p_location_id: str(fd, "location_id"),
  });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/floor-plan");
  redirect(`${path}?message=${encodeURIComponent("Home area saved.")}`);
}

/** Called from the floor plan's item panel. */
export async function setHomeAreaInline(productId: string, layoutId: string, locationId: string | null): Promise<Result> {
  const { supabase } = await requireRole("buyer", "warehouse");
  const { error } = await supabase.rpc("set_home_location", { p_product_id: productId, p_layout_id: layoutId, p_location_id: locationId });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

// ---------- sections inside locations ----------
export type SectionInput = {
  id?: string;
  layoutId: string;
  locationId: string; // "__new" creates a location named newLocation in this layout
  newLocation?: string;
  name: string;
  shelves: string;
  place?: { points: Pt[]; color?: string } | null;
};

/** "1-4" → 1, 2, 3, 4; otherwise comma or line separated names. */
function parseShelves(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split(/[\n,]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
    if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 50) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(String(i));
    else out.push(t.slice(0, 30));
  }
  return out.slice(0, 60);
}

/** Add or edit a section; can create its location too. Returns the section and location ids. */
export async function saveSection(input: SectionInput): Promise<Result & { id?: string; locationId?: string }> {
  const { supabase } = await requireRole("warehouse");
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) return { error: "Name the section (up to 40 characters)." };
  let locationId = input.locationId;
  if (locationId === "__new") {
    const ln = String(input.newLocation ?? "").trim().replace(/\s+/g, " ");
    if (!ln) return { error: "Name the new location." };
    const { data: loc, error } = await supabase.from("locations").insert({ name: ln, kind: "other", layout_id: input.layoutId }).select("id").single();
    if (error) return { error: error.message.includes("duplicate") ? "A location with that name already exists. Choose it from the list." : dbMessage(error) };
    locationId = loc.id;
  }
  const row: Record<string, unknown> = { name, location_id: locationId, shelves: parseShelves(input.shelves) };
  if (!input.id && input.place && validShape(input.place.points)) {
    const pts = clampPts(input.place.points);
    const b = bbox(pts);
    Object.assign(row, { map_shape: pts, map_x: b.x, map_y: b.y, map_w: Math.max(b.w, 0.1), map_h: Math.max(b.h, 0.1) });
    if (input.place.color && /^#[0-9a-fA-F]{6}$/.test(input.place.color)) row.map_color = input.place.color;
  }
  const res = input.id
    ? await supabase.from("location_sections").update(row).eq("id", input.id).select("id").single()
    : await supabase.from("location_sections").insert(row).select("id").single();
  if (res.error) return { error: res.error.message.includes("location_sections_name_uidx") ? "That location already has a section with this name." : dbMessage(res.error) };
  revalidatePath("/floor-plan");
  return { id: res.data.id, locationId };
}

export async function deleteSection(id: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { error } = await supabase.from("location_sections").delete().eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

export async function renameLocation(id: string, name: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n || n.length > 60) return { error: "Name the location (up to 60 characters)." };
  const { error } = await supabase.from("locations").update({ name: n }).eq("id", id);
  if (error) return { error: error.message.includes("duplicate") ? "Another location already has that name." : dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

/** An item's usual section and shelf inside its home area (form on the item page). */
export async function setHomeSpot(productId: string, layoutId: string, fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `/products/${productId}`;
  const { sectionId, shelf } = splitSpot(fd.get("spot"));
  const { error } = await supabase.rpc("set_home_spot", { p_product_id: productId, p_layout_id: layoutId, p_section_id: sectionId, p_shelf: shelf });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Usual section and shelf saved.")}`);
}
