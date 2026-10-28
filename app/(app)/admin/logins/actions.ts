"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";

const PATH = "/admin/logins";

async function run(fn: string, args: Record<string, string | null>, ok: string) {
  const { supabase } = await requireRole("sales");
  const { error } = await supabase.rpc(fn, args);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath(PATH);
  redirect(`${PATH}?message=${encodeURIComponent(ok)}`);
}

export async function setUp(fd: FormData) {
  const profile = str(fd, "profile_id");
  const customer = str(fd, "customer_id");
  if (!profile || !customer) fail(PATH, "Choose the person and the customer.");
  await run("portal_set_up", { p_profile_id: profile, p_customer_id: customer }, "Login set up. A different person now needs to verify it.");
}
export async function verify(fd: FormData) {
  await run("portal_verify", { p_profile_id: str(fd, "profile_id") }, "Verified. The customer can shop now.");
}
export async function remove(fd: FormData) {
  await run("portal_remove", { p_profile_id: str(fd, "profile_id") }, "Customer login removed.");
}
