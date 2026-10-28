"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fail, str } from "@/lib/forms";
import { loginEmail } from "@/lib/username";

const OK = "Password changed. Sign in with the new one.";
const APPROVAL_HOURS = 24;

function checkPasswords(path: string, fd: FormData) {
  const next = String(fd.get("next") ?? "");
  if (next.length < 8) fail(path, "The new password needs at least 8 characters.");
  if (next !== String(fd.get("again") ?? "")) fail(path, "The two passwords don't match.");
  return next;
}

/** From the emailed link. */
export async function resetWithToken(fd: FormData) {
  const hash = str(fd, "token_hash") ?? "";
  const path = `/login/reset?token_hash=${encodeURIComponent(hash)}`;
  const next = checkPasswords(path, fd);
  const supabase = await createClient();
  const { error: bad } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: hash });
  if (bad) fail("/login/forgot", "That link has expired. Ask for a new one.");
  const { error } = await supabase.auth.updateUser({ password: next });
  await supabase.auth.signOut();
  if (error) fail("/login/forgot", error.message);
  redirect(`/login?message=${encodeURIComponent(OK)}`);
}

/** After sales or admin approved the request. */
export async function resetApproved(fd: FormData) {
  const path = "/login/reset";
  const typed = str(fd, "username");
  const next = checkPasswords(path, fd);
  const admin = createServiceClient();
  if (!typed || !admin) fail(path, "Resetting needs the server key to be set up.");
  const { data: prof } = await admin.from("profiles").select("id").eq("email", loginEmail(typed)).eq("role", "customer").maybeSingle();
  const since = new Date(Date.now() - APPROVAL_HOURS * 3600_000).toISOString();
  const { data: req } = prof
    ? await admin.from("password_requests").select("id").eq("profile_id", prof.id).eq("status", "approved").gte("decided_at", since).order("decided_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  if (!prof || !req) fail(path, "No approved reset found for that username. Ask your sales rep to approve it (it stays valid for 24 hours).");
  const { error } = await admin.auth.admin.updateUserById(prof.id, { password: next });
  if (error) fail(path, error.message);
  await admin.from("password_requests").update({ status: "used", used_at: new Date().toISOString() }).eq("id", req.id);
  redirect(`/login?message=${encodeURIComponent(OK)}`);
}
