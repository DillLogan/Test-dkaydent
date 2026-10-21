"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";
import { IMAGE_BUCKET } from "@/lib/images";

type Result = { error?: string };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n * 10) / 10));

/** Save an area's rectangle (percent of plan) and color. Called while editing the plan. */
export async function saveArea(id: string, rect: { x: number; y: number; w: number; h: number; color?: string }): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const w = clamp(rect.w, 3, 100);
  const h = clamp(rect.h, 3, 100);
  const x = clamp(rect.x, 0, 100 - w);
  const y = clamp(rect.y, 0, 100 - h);
  const patch: Record<string, unknown> = { map_x: x, map_y: y, map_w: w, map_h: h };
  if (rect.color && /^#[0-9a-fA-F]{6}$/.test(rect.color)) patch.map_color = rect.color;
  const { error } = await supabase.from("locations").update(patch).eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

export async function removeArea(id: string): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { error } = await supabase.from("locations").update({ map_x: null, map_y: null, map_w: null, map_h: null }).eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

export async function setPlanShape(aspect: number): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  if (!(aspect >= 0.3 && aspect <= 4)) return { error: "Choose a plan shape." };
  const { error } = await supabase.from("shop_layout").update({ aspect, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}

export async function uploadPlanBackground(fd: FormData): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (file.size > 5 * 1024 * 1024) return { error: "That image is over 5 MB even after shrinking." };
  const aspect = Math.min(4, Math.max(0.3, Number(fd.get("aspect")) || 1.6));
  const path = `plan/${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp"}`;
  const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (upErr) return { error: upErr.message.includes("row-level security") ? "Your role can't upload images." : upErr.message };
  const { data: old } = await supabase.from("shop_layout").select("background_path").eq("id", 1).single();
  // The plan takes the image's shape so areas line up with what's drawn
  const { error } = await supabase
    .from("shop_layout")
    .update({ background_path: path, aspect: Math.round(aspect * 1000) / 1000, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: dbMessage(error) };
  if (old?.background_path) await supabase.storage.from(IMAGE_BUCKET).remove([old.background_path]).catch(() => {});
  revalidatePath("/floor-plan");
  return {};
}

export async function removePlanBackground(): Promise<Result> {
  const { supabase } = await requireRole("warehouse");
  const { data: old } = await supabase.from("shop_layout").select("background_path").eq("id", 1).single();
  const { error } = await supabase.from("shop_layout").update({ background_path: null }).eq("id", 1);
  if (error) return { error: dbMessage(error) };
  if (old?.background_path) await supabase.storage.from(IMAGE_BUCKET).remove([old.background_path]).catch(() => {});
  revalidatePath("/floor-plan");
  return {};
}

/** Form action from the item page. */
export async function setHomeArea(productId: string, fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `/products/${productId}`;
  const { error } = await supabase.rpc("set_home_location", { p_product_id: productId, p_location_id: str(fd, "location_id") });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/floor-plan");
  redirect(`${path}?message=${encodeURIComponent("Home area saved.")}`);
}

/** Called from the floor plan's item panel. */
export async function setHomeAreaInline(productId: string, locationId: string | null): Promise<Result> {
  const { supabase } = await requireRole("buyer", "warehouse");
  const { error } = await supabase.rpc("set_home_location", { p_product_id: productId, p_location_id: locationId });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/floor-plan");
  return {};
}
