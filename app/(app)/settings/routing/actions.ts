"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";

const PATH = "/settings/routing";

export async function setMapsKey(fd: FormData) {
  const { supabase } = await requireRole();
  const key = fd.get("clear") === "1" ? null : str(fd, "google_maps_key");
  if (key !== null && !/^[A-Za-z0-9_-]{10,200}$/.test(key)) fail(PATH, "That doesn't look like a Google API key.");
  const { error } = await supabase.from("app_settings").update({ google_maps_key: key, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath(PATH);
  revalidatePath("/routing");
  redirect(`${PATH}?message=${encodeURIComponent(key ? "Maps key saved." : "Maps key removed.")}`);
}

export async function setShopAddress(id: string, fd: FormData) {
  const { supabase } = await requireRole();
  const { error } = await supabase.from("shop_layouts").update({ address: str(fd, "address") }).eq("id", id);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath(PATH);
  revalidatePath("/routing");
  redirect(`${PATH}?message=${encodeURIComponent("Shop address saved.")}`);
}
