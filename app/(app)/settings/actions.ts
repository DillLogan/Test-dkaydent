"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/forms";

const PATH = "/settings";

/** Any signed-in person changes their own password; the current one must be right. */
export async function changePassword(fd: FormData) {
  const { user } = await getSession();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const again = String(fd.get("again") ?? "");
  if (next.length < 8) fail(PATH, "The new password needs at least 8 characters.");
  if (next !== again) fail(PATH, "The two new passwords don't match.");
  if (next === current) fail(PATH, "Choose a password different from the current one.");
  const supabase = await createClient();
  const { error: badCurrent } = await supabase.auth.signInWithPassword({ email: user.email ?? "", password: current });
  if (badCurrent) fail(PATH, "The current password is not right.");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) fail(PATH, error.message);
  redirect(`${PATH}?message=${encodeURIComponent("Password changed.")}`);
}
