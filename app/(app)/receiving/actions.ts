"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, int, num, str } from "@/lib/forms";
import { splitSpot } from "@/lib/spots";

const LIST = "/receiving";
const msg = (path: string, m: string) => `${path}${path.includes("?") ? "&" : "?"}message=${encodeURIComponent(m)}`;

function refresh() {
  revalidatePath(LIST);
  revalidatePath("/purchasing");
  revalidatePath("/");
}

// ---------------------------------------------------------------- shipments

export async function createShipment(fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const eta = str(fd, "eta");
  if (!eta) fail(`${LIST}?view=new`, "Enter an ETA.");
  const { data, error } = await supabase
    .from("shipments")
    .insert({ eta, carrier: str(fd, "carrier"), tracking: str(fd, "tracking"), notes: str(fd, "notes") })
    .select("id")
    .single();
  if (error) fail(`${LIST}?view=new`, dbMessage(error));
  for (const po of fd.getAll("po_id").map(String).filter(Boolean)) {
    const { error: e } = await supabase.rpc("set_po_shipment", { p_po_id: po, p_shipment_id: data.id });
    if (e) fail(`${LIST}/${data.id}`, dbMessage(e));
  }
  refresh();
  redirect(msg(`${LIST}/${data.id}`, "Shipment planned."));
}

export async function updateShipment(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `${LIST}/${id}`;
  const eta = str(fd, "eta");
  if (!eta) fail(path, "Enter an ETA.");
  const { error } = await supabase
    .from("shipments")
    .update({ eta, carrier: str(fd, "carrier"), tracking: str(fd, "tracking"), notes: str(fd, "notes") })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  refresh();
  redirect(msg(path, "Saved."));
}

export async function setShipmentStatus(id: string, status: "planned" | "in_transit" | "arrived" | "cancelled") {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `${LIST}/${id}`;
  if (status === "cancelled") {
    // take any open POs off the shipment so they can go on another one
    const { data: pos } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("shipment_id", id)
      .in("status", ["draft", "ordered", "partially_received"]);
    for (const po of pos ?? []) {
      const { error } = await supabase.rpc("set_po_shipment", { p_po_id: po.id, p_shipment_id: null });
      if (error) fail(path, dbMessage(error));
    }
  }
  const { error } = await supabase.from("shipments").update({ status }).eq("id", id);
  if (error) fail(path, dbMessage(error));
  refresh();
  redirect(path);
}

export async function addPOToShipment(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `${LIST}/${id}`;
  const po = str(fd, "po_id");
  if (!po) fail(path, "Choose a purchase order.");
  const { error } = await supabase.rpc("set_po_shipment", { p_po_id: po, p_shipment_id: id });
  if (error) fail(path, dbMessage(error));
  refresh();
  redirect(path);
}

export async function removePOFromShipment(id: string, poId: string) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `${LIST}/${id}`;
  const { error } = await supabase.rpc("set_po_shipment", { p_po_id: poId, p_shipment_id: null });
  if (error) fail(path, dbMessage(error));
  refresh();
  redirect(path);
}

const spotOf = (fd: FormData, lineId: string) => {
  const { sectionId, shelf } = splitSpot(fd.get(`spot_${lineId}`));
  return { section_id: sectionId, shelf };
};

export async function receiveShipment(id: string, lineIds: string[], fd: FormData) {
  const { supabase } = await requireRole("buyer", "warehouse");
  const path = `${LIST}/${id}`;
  const lines = lineIds
    .map((lineId) => ({
      line_id: lineId,
      qty: num(fd, `qty_${lineId}`) ?? 0,
      location_id: str(fd, `loc_${lineId}`),
      ...spotOf(fd, lineId),
      expires_at: str(fd, `exp_${lineId}`),
      lot_code: str(fd, `lot_${lineId}`),
    }))
    .filter((l) => l.qty > 0);
  if (lines.length === 0) fail(path, "Mark at least one line as received (All or Some).");
  const toCustomer = fd.getAll("to_customer").map(String).filter(Boolean);
  const { data, error } = await supabase.rpc("receive_shipment", { p_shipment_id: id, p_lines: lines, p_to_customer: toCustomer });
  if (error) fail(path, dbMessage(error));
  refresh();
  revalidatePath("/inventory");
  revalidatePath("/sales");
  const r = data as { pos: number; lots: number; orders: string[]; open: boolean };
  const n = r.orders?.length ?? 0;
  redirect(
    msg(
      path,
      `Received ${r.lots} lot${r.lots === 1 ? "" : "s"} from ${r.pos} purchase order${r.pos === 1 ? "" : "s"}.` +
        (n ? ` Made ${n} customer order${n === 1 ? "" : "s"} (linked on each PO below).` : "") +
        (r.open ? " Some lines are still due, so the shipment stays open." : ""),
    ),
  );
}

// ---------------------------------------------------------- standing orders

const SO = `${LIST}/standing`;

export async function createStandingOrder(fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const name = str(fd, "name");
  const vendor_id = str(fd, "vendor_id");
  const start_date = str(fd, "start_date");
  if (!name || !vendor_id || !start_date) fail(SO, "Enter a name, vendor and first arrival date.");
  const { data, error } = await supabase
    .from("standing_orders")
    .insert({
      name,
      vendor_id,
      start_date,
      cadence: str(fd, "cadence") ?? "weekly",
      end_date: str(fd, "end_date"),
      lead_days: int(fd, "lead_days") ?? 7,
      carrier: str(fd, "carrier"),
      freight_cost: num(fd, "freight_cost") ?? 0,
      notes: str(fd, "notes"),
      direct_customer_id: str(fd, "direct_customer_id"),
    })
    .select("id")
    .single();
  if (error) fail(SO, dbMessage(error));
  revalidatePath(SO);
  redirect(msg(`${SO}/${data.id}`, "Standing order created. Add the items it brings in."));
}

/** After a template change: drop untouched future occurrences and plan them again. */
async function replan(supabase: any, id: string, path: string) {
  const { data: so } = await supabase.from("standing_orders").select("active").eq("id", id).single();
  const { error: e1 } = await supabase.rpc("clear_untouched_occurrences", { p_standing_order_id: id });
  if (e1) fail(path, dbMessage(e1));
  if (so?.active) {
    const { error: e2 } = await supabase.rpc("generate_standing_orders", { p_standing_order_id: id });
    if (e2) fail(path, dbMessage(e2));
  }
  refresh();
  revalidatePath(path);
}

export async function updateStandingOrder(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `${SO}/${id}`;
  const { error } = await supabase
    .from("standing_orders")
    .update({
      name: str(fd, "name"),
      cadence: str(fd, "cadence") ?? "weekly",
      start_date: str(fd, "start_date"),
      end_date: str(fd, "end_date"),
      lead_days: int(fd, "lead_days") ?? 7,
      carrier: str(fd, "carrier"),
      freight_cost: num(fd, "freight_cost") ?? 0,
      notes: str(fd, "notes"),
      direct_customer_id: str(fd, "direct_customer_id"),
    })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  await replan(supabase, id, path);
  redirect(msg(path, "Saved. Planned orders you haven't edited were updated."));
}

export async function addStandingLine(id: string, fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const path = `${SO}/${id}`;
  const product_id = str(fd, "product_id");
  const unit_id = str(fd, "unit_id");
  const qty = num(fd, "qty");
  const unit_cost = num(fd, "unit_cost");
  if (!product_id || !unit_id || !qty || qty <= 0 || unit_cost === null || unit_cost < 0) {
    fail(path, "Choose a product and unit, and enter a quantity and cost.");
  }
  const { error } = await supabase.from("standing_order_lines").insert({ standing_order_id: id, product_id, unit_id, qty, unit_cost });
  if (error) fail(path, dbMessage(error));
  await replan(supabase, id, path);
  redirect(path);
}

export async function removeStandingLine(id: string, lineId: string) {
  const { supabase } = await requireRole("buyer");
  const path = `${SO}/${id}`;
  const { error } = await supabase.from("standing_order_lines").delete().eq("id", lineId);
  if (error) fail(path, dbMessage(error));
  await replan(supabase, id, path);
  redirect(path);
}

export async function setStandingState(id: string, action: "pause" | "resume" | "end") {
  const { supabase } = await requireRole("buyer");
  const path = `${SO}/${id}`;
  const { data, error } = await supabase.rpc("set_standing_order_state", { p_id: id, p_action: action });
  if (error) fail(path, dbMessage(error));
  refresh();
  revalidatePath(path);
  const n = Number(data ?? 0);
  const text =
    action === "resume"
      ? `Resumed. Planned ${n} order${n === 1 ? "" : "s"} for the next 12 months.`
      : `${action === "pause" ? "Paused" : "Ended"}. Removed ${n} planned order${n === 1 ? "" : "s"} nobody had edited.`;
  redirect(msg(path, text));
}

export async function skipOccurrence(poId: string, back: string) {
  const { supabase } = await requireRole("buyer");
  if (!back.startsWith("/") || back.startsWith("//")) back = LIST;
  const { error } = await supabase.rpc("skip_planned_po", { p_po_id: poId });
  if (error) fail(back, dbMessage(error));
  refresh();
  revalidatePath(back);
  redirect(msg(back, "Skipped."));
}
