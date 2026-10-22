"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";

const LIST = "/sales/recurring";
const msg = (path: string, m: string) =>
  `${path}?message=${encodeURIComponent(m)}`;

export async function createRecurringSale(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const name = str(fd, "name");
  const customer_id = str(fd, "customer_id");
  const start_date = str(fd, "start_date");
  const back = customer_id ? `${LIST}?customer=${customer_id}` : LIST;
  if (!name || !customer_id || !start_date)
    fail(back, "Enter a name, customer and first ship date.");
  const { data, error } = await supabase
    .from("recurring_sales")
    .insert({
      name,
      customer_id,
      start_date,
      cadence: str(fd, "cadence") ?? "weekly",
      end_date: str(fd, "end_date"),
      notes: str(fd, "notes"),
    })
    .select("id")
    .single();
  if (error) fail(back, dbMessage(error));
  revalidatePath(LIST);
  redirect(
    msg(
      `${LIST}/${data.id}`,
      "Recurring order created. Add the items the customer takes each time.",
    ),
  );
}

/** After a change to the template: drop planned drafts nobody edited and plan again. */
async function replan(supabase: any, id: string, path: string) {
  const { data: r } = await supabase
    .from("recurring_sales")
    .select("active")
    .eq("id", id)
    .single();
  const { error: e1 } = await supabase.rpc("clear_untouched_recurring", {
    p_recurring_id: id,
  });
  if (e1) fail(path, dbMessage(e1));
  if (r?.active) {
    const { error: e2 } = await supabase.rpc("generate_recurring_sales", {
      p_recurring_id: id,
    });
    if (e2) fail(path, dbMessage(e2));
  }
  revalidatePath(path);
  revalidatePath("/sales");
}

export async function updateRecurringSale(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `${LIST}/${id}`;
  const { error } = await supabase
    .from("recurring_sales")
    .update({
      name: str(fd, "name"),
      cadence: str(fd, "cadence") ?? "weekly",
      start_date: str(fd, "start_date"),
      end_date: str(fd, "end_date"),
      notes: str(fd, "notes"),
    })
    .eq("id", id);
  if (error) fail(path, dbMessage(error));
  await replan(supabase, id, path);
  redirect(
    msg(
      path,
      "Saved. Planned orders you haven't edited follow the new schedule.",
    ),
  );
}

export async function addRecurringLine(id: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const path = `${LIST}/${id}`;
  const product_id = str(fd, "product_id");
  const unit_id = str(fd, "unit_id");
  const qty = num(fd, "qty");
  if (!product_id || !unit_id || !qty || qty <= 0)
    fail(path, "Choose a product and unit, and enter a quantity.");
  const { error } = await supabase
    .from("recurring_sale_lines")
    .insert({ recurring_id: id, product_id, unit_id, qty });
  if (error) fail(path, dbMessage(error));
  await replan(supabase, id, path);
  redirect(path);
}

export async function removeRecurringLine(id: string, lineId: string) {
  const { supabase } = await requireRole("sales");
  const path = `${LIST}/${id}`;
  const { error } = await supabase
    .from("recurring_sale_lines")
    .delete()
    .eq("id", lineId);
  if (error) fail(path, dbMessage(error));
  await replan(supabase, id, path);
  redirect(path);
}

export async function setRecurringState(
  id: string,
  action: "pause" | "resume" | "end",
) {
  const { supabase } = await requireRole("sales");
  const path = `${LIST}/${id}`;
  const { data, error } = await supabase.rpc("set_recurring_sale_state", {
    p_id: id,
    p_action: action,
  });
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  revalidatePath("/sales");
  const n = Number(data ?? 0);
  redirect(
    msg(
      path,
      action === "resume"
        ? `Resumed. Planned ${n} order${n === 1 ? "" : "s"} for the next 12 months.`
        : `${action === "pause" ? "Paused" : "Ended"}. Removed ${n} planned order${n === 1 ? "" : "s"} nobody had edited.`,
    ),
  );
}

export async function skipRecurringSale(soId: string, back: string) {
  const { supabase } = await requireRole("sales");
  if (!back.startsWith("/") || back.startsWith("//")) back = LIST;
  const { error } = await supabase.rpc("skip_recurring_sale", {
    p_so_id: soId,
  });
  if (error) fail(back, dbMessage(error));
  revalidatePath("/sales");
  revalidatePath(back.split("?")[0]);
  redirect(
    `${back}${back.includes("?") ? "&" : "?"}message=${encodeURIComponent("Skipped.")}`,
  );
}
