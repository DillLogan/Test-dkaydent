"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";

const PATH = "/sales/open";

export async function approve(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const id = str(fd, "id");
  if (!id) fail(PATH, "Pick an order.");
  const { error } = await supabase.from("sales_orders").update({ status: "confirmed" }).eq("id", id).eq("status", "draft");
  if (error) fail(PATH, dbMessage(error));
  revalidatePath(PATH);
  revalidatePath("/sales");
  redirect(`${PATH}?message=${encodeURIComponent("Approved. It is ready to pull.")}`);
}

export async function deny(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const { error } = await supabase.rpc("deny_order", { p_so_id: str(fd, "id"), p_reason: str(fd, "reason") ?? "" });
  if (error) fail(PATH, dbMessage(error));
  revalidatePath(PATH);
  revalidatePath("/sales");
  redirect(`${PATH}?message=${encodeURIComponent("Denied. The customer can see your reason.")}`);
}
