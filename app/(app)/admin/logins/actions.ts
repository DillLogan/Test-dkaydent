"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";
import { createServiceClient } from "@/lib/supabase/service";
import { CUSTOMER_DOMAIN, isValidUsername } from "@/lib/username";

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

/** Sales or admin creates the customer's login: a username and a password they hand to the customer. */
export async function createLogin(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const customer = str(fd, "customer_id");
  const name = str(fd, "full_name");
  const username = (str(fd, "username") ?? "").toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!customer || !name) fail(PATH, "Choose the customer and enter the person's name.");
  if (!isValidUsername(username)) fail(PATH, "A username is 3 to 30 letters, numbers, dots, dashes or underscores.");
  if (password.length < 8) fail(PATH, "The password needs at least 8 characters.");
  const admin = createServiceClient();
  if (!admin) fail(PATH, "Creating logins needs SUPABASE_SERVICE_ROLE_KEY to be set on the server.");
  const { data, error } = await admin.auth.admin.createUser({
    email: `${username}@${CUSTOMER_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) fail(PATH, error?.message.includes("already") ? "That username is taken." : (error?.message ?? "Could not create the login."));
  const { error: setErr } = await supabase.rpc("portal_set_up", { p_profile_id: data.user.id, p_customer_id: customer });
  if (setErr) {
    await admin.auth.admin.deleteUser(data.user.id); // do not leave a half-made login behind
    fail(PATH, dbMessage(setErr));
  }
  revalidatePath(PATH);
  redirect(`${PATH}?message=${encodeURIComponent(`Login ${username} created. A different person now needs to verify it.`)}`);
}

export async function resetPassword(fd: FormData) {
  await requireRole("sales");
  const profile = str(fd, "profile_id");
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) fail(PATH, "The password needs at least 8 characters.");
  const { supabase } = await requireRole("sales");
  const { data: acct } = await supabase.from("portal_accounts").select("profile_id").eq("profile_id", profile ?? "").maybeSingle();
  if (!acct) fail(PATH, "That is not a customer login.");
  const admin = createServiceClient();
  if (!admin) fail(PATH, "Resetting passwords needs SUPABASE_SERVICE_ROLE_KEY to be set on the server.");
  const { error } = await admin.auth.admin.updateUserById(profile!, { password });
  if (error) fail(PATH, error.message);
  redirect(`${PATH}?message=${encodeURIComponent("New password saved.")}`);
}
