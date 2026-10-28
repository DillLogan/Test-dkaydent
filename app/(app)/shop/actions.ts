"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { dbMessage, fail } from "@/lib/forms";

export async function checkout(fd: FormData) {
  const { supabase } = await getSession();
  let lines: unknown;
  try {
    lines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    fail("/shop", "The cart could not be read.");
  }
  const notes = String(fd.get("notes") ?? "");
  const { error } = await supabase.rpc("portal_checkout", { p_lines: lines, p_notes: notes });
  if (error) fail("/shop", dbMessage(error));
  revalidatePath("/shop");
  redirect(`/shop?message=${encodeURIComponent("Thanks. Your order was sent to us for approval.")}`);
}
