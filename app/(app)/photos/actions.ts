"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage } from "@/lib/forms";
import { IMAGE_BUCKET } from "@/lib/images";

type Result = { error?: string };
const MAX_BYTES = 5 * 1024 * 1024;

async function store(folder: string, id: string, fd: FormData): Promise<{ path?: string; error?: string; supabase?: any }> {
  const { supabase } = await requireRole("buyer", "warehouse");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (file.size > MAX_BYTES) return { error: "That photo is over 5 MB even after shrinking. Try a smaller one." };
  if (!/^image\/(webp|jpeg|png)$/.test(file.type)) return { error: "Photos must be JPEG, PNG or WebP." };
  const path = `${folder}/${id}/${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp"}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: error.message.includes("row-level security") ? "Your role can't upload photos." : error.message };
  return { path, supabase };
}

async function removeOld(supabase: any, oldPath: string | null | undefined) {
  if (oldPath) await supabase.storage.from(IMAGE_BUCKET).remove([oldPath]).catch(() => {});
}

export async function uploadProductPhoto(productId: string, fd: FormData): Promise<Result> {
  const s = await store("products", productId, fd);
  if (s.error) return { error: s.error };
  const { data: old } = await s.supabase.from("products").select("image_path").eq("id", productId).single();
  const { error } = await s.supabase.rpc("set_product_image", { p_product_id: productId, p_path: s.path });
  if (error) return { error: dbMessage(error) };
  await removeOld(s.supabase, old?.image_path);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return {};
}

export async function removeProductPhoto(productId: string): Promise<Result> {
  const { supabase } = await requireRole("buyer", "warehouse");
  const { data: old } = await supabase.from("products").select("image_path").eq("id", productId).single();
  const { error } = await supabase.rpc("set_product_image", { p_product_id: productId, p_path: null });
  if (error) return { error: dbMessage(error) };
  await removeOld(supabase, old?.image_path);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return {};
}

export async function uploadLotPhoto(lotId: string, fd: FormData): Promise<Result> {
  const s = await store("lots", lotId, fd);
  if (s.error) return { error: s.error };
  const { data: old } = await s.supabase.from("lots").select("image_path").eq("id", lotId).single();
  const { error } = await s.supabase.rpc("set_lot_image", { p_lot_id: lotId, p_path: s.path });
  if (error) return { error: dbMessage(error) };
  await removeOld(s.supabase, old?.image_path);
  revalidatePath(`/inventory/lots/${lotId}`);
  return {};
}

export async function removeLotPhoto(lotId: string): Promise<Result> {
  const { supabase } = await requireRole("buyer", "warehouse");
  const { data: old } = await supabase.from("lots").select("image_path").eq("id", lotId).single();
  const { error } = await supabase.rpc("set_lot_image", { p_lot_id: lotId, p_path: null });
  if (error) return { error: dbMessage(error) };
  await removeOld(supabase, old?.image_path);
  revalidatePath(`/inventory/lots/${lotId}`);
  return {};
}
