"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";
import { splitSpot } from "@/lib/spots";

// lot page qty comes in the chosen unit, convert to base
async function toBase(fd: FormData, supabase: any): Promise<number | null> {
  const q = num(fd, "qty");
  const unitId = str(fd, "unit_id");
  if (q === null) return null;
  if (!unitId) return q;
  const { data } = await supabase.from("product_units").select("factor").eq("id", unitId).single();
  return q * Number(data?.factor ?? 1);
}

export async function transferLot(lotId: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse", "sales");
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
  const { supabase } = await requireRole("warehouse", "sales");
  const path = `/inventory/lots/${lotId}`;
  const qtyBase = await toBase(fd, supabase);
  const reason = [str(fd, "reason"), str(fd, "note")].filter(Boolean).join(" — ");
  const { error } = await supabase.rpc("record_shrink", { p_lot_id: lotId, p_qty_base: qtyBase, p_reason: reason });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/inventory");
  redirect(`${path}?message=${encodeURIComponent("Shrink recorded.")}`);
}

export async function countLot(lotId: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse", "sales");
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
  const { supabase } = await requireRole("warehouse", "sales");
  const name = str(fd, "name");
  if (!name) fail("/inventory/locations", "Location name is required.");
  const { error } = await supabase
    .from("locations")
    .insert({ name, kind: str(fd, "kind") ?? "cooler", temp_c: num(fd, "temp_c"), layout_id: str(fd, "layout_id") });
  if (error) fail("/inventory/locations", dbMessage(error));
  revalidatePath("/inventory/locations");
  redirect("/inventory/locations");
}

// moving shops drops it from the old plan and clears item homes there
export async function moveLocationShop(id: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse", "sales");
  const layoutId = str(fd, "layout_id");
  if (!layoutId) fail("/inventory/locations", "Choose a shop.");
  const { error } = await supabase.from("locations").update({ layout_id: layoutId }).eq("id", id);
  if (error) fail("/inventory/locations", dbMessage(error));
  revalidatePath("/inventory/locations");
  revalidatePath("/floor-plan");
  redirect("/inventory/locations");
}

export async function toggleLocation(id: string, active: boolean) {
  const { supabase } = await requireRole("warehouse", "sales");
  const { error } = await supabase.from("locations").update({ active }).eq("id", id);
  if (error) fail("/inventory/locations", dbMessage(error));
  revalidatePath("/inventory/locations");
  redirect("/inventory/locations");
}

export async function setLotSpot(lotId: string, fd: FormData) {
  const { supabase } = await requireRole("warehouse", "sales");
  const path = `/inventory/lots/${lotId}`;
  const { sectionId, shelf } = splitSpot(fd.get("spot"));
  const { error } = await supabase.rpc("set_lot_spot", { p_lot_id: lotId, p_section_id: sectionId, p_shelf: shelf });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("Section and shelf saved.")}`);
}

// back to the inventory list the person was on, with a note
function backTo(fd: FormData) {
  const back = str(fd, "back") ?? "/inventory";
  return back.startsWith("/inventory") ? back : "/inventory";
}
const withMessage = (path: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}message=${encodeURIComponent(msg)}`;

// whole-product count from the Inventory list; the difference from what was on screen is applied
export async function countProduct(fd: FormData) {
  const { supabase } = await requireRole("warehouse", "sales");
  const back = backTo(fd);
  const counted = await toBase(fd, supabase);
  const expected = num(fd, "expected");
  if (counted === null || expected === null) fail(back, "Enter the count.");
  const { error } = await supabase.rpc("count_product", {
    p_product: str(fd, "product_id"),
    p_location: str(fd, "location_id"),
    p_counted_base: counted,
    p_expected_base: expected,
    p_into_lot: str(fd, "into_lot"),
    p_new_lot_location: str(fd, "new_lot_location"),
  });
  if (error) fail(back, dbMessage(error));
  revalidatePath("/inventory");
  redirect(withMessage(back, "Count saved."));
}

export async function moveProduct(fd: FormData) {
  const { supabase } = await requireRole("warehouse", "sales");
  const back = backTo(fd);
  const qtyBase = await toBase(fd, supabase);
  const { error } = await supabase.rpc("move_product_stock", {
    p_product: str(fd, "product_id"),
    p_from: str(fd, "from_location"),
    p_to: str(fd, "to_location"),
    p_qty_base: qtyBase,
  });
  if (error) fail(back, dbMessage(error));
  revalidatePath("/inventory");
  redirect(withMessage(back, "Moved."));
}
