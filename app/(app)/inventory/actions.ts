"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";

/** Quantities on the lot page are entered in a chosen unit and converted to base units here. */
async function toBase(fd: FormData, supabase: any): Promise<number | null> {
  const q = num(fd, "qty");
  const unitId = str(fd, "unit_id");
  if (q === null) return null;
  if (!unitId) return q;
  const { data } = await supabase.from("product_units").select("factor").eq("id", unitId).single();
  return q * Number(data?.factor ?? 1);
}

export async function transferLot(lotId: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse");
  const path = `/inventory/lots/${lotId}`;
  const qtyBase = await toBase(fd, supabase);
  const { data, error } = await supabase.rpc("transfer_stock", {
    p_lot_id: lotId,
    p_qty_base: qtyBase,
    p_to_location: str(fd, "to_location"),
  });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/inventory");
  redirect(`/inventory/lots/${data}?message=${encodeURIComponent("Transferred.")}`);
}

export async function shrinkLot(lotId: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse");
  const path = `/inventory/lots/${lotId}`;
  const qtyBase = await toBase(fd, supabase);
  const reason = [str(fd, "reason"), str(fd, "note")].filter(Boolean).join(" — ");
  const { error } = await supabase.rpc("record_shrink", { p_lot_id: lotId, p_qty_base: qtyBase, p_reason: reason });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/inventory");
  redirect(`${path}?message=${encodeURIComponent("Shrink recorded.")}`);
}

export async function countLot(lotId: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse");
  const path = `/inventory/lots/${lotId}`;
  const counted = await toBase(fd, supabase);
  const { error } = await supabase.rpc("adjust_lot", {
    p_lot_id: lotId,
    p_counted_base: counted,
    p_reason: str(fd, "reason") ?? "Cycle count",
  });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/inventory");
  redirect(`${path}?message=${encodeURIComponent("Count saved.")}`);
}

export async function createLocation(fd: FormData) {
  const { supabase } = await requireRole("warehouse");
  const name = str(fd, "name");
  if (!name) fail("/inventory/locations", "Location name is required.");
  const { error } = await supabase
    .from("locations")
    .insert({ name, kind: str(fd, "kind") ?? "cooler", temp_c: num(fd, "temp_c"), layout_id: str(fd, "layout_id") });
  if (error) fail("/inventory/locations", dbMessage(error));
  revalidatePath("/inventory/locations");
  redirect("/inventory/locations");
}

/** Move a location to another shop. It leaves the old floor plan and stops being any item's home there. */
export async function moveLocationShop(id: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse");
  const layoutId = str(fd, "layout_id");
  if (!layoutId) fail("/inventory/locations", "Choose a shop.");
  const { error } = await supabase.from("locations").update({ layout_id: layoutId }).eq("id", id);
  if (error) fail("/inventory/locations", dbMessage(error));
  revalidatePath("/inventory/locations");
  revalidatePath("/floor-plan");
  redirect("/inventory/locations");
}

export async function toggleLocation(id: string, active: boolean) {
  const { supabase } = await requireRole("warehouse");
  const { error } = await supabase.from("locations").update({ active }).eq("id", id);
  if (error) fail("/inventory/locations", dbMessage(error));
  revalidatePath("/inventory/locations");
  redirect("/inventory/locations");
}
