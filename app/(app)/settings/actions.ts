"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, fail } from "@/lib/forms";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { hintProblem } from "@/lib/passwordHint";

const PATH = "/settings";

/**
 * Any signed-in person changes their own password; the current one must be right.
 * Customers can also set an optional hint. Leave the new password blank to change only the hint.
 */
export async function changePassword(fd: FormData) {
  const { user, profile } = await getSession();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const again = String(fd.get("again") ?? "");
  const isCustomer = profile.role === "customer";
  const hint = isCustomer ? String(fd.get("hint") ?? "").trim() : "";
  const hintOnly = isCustomer && !next && !again;
  if (!hintOnly) {
    if (next.length < 8) fail(PATH, "The new password needs at least 8 characters.");
    if (next !== again) fail(PATH, "The two new passwords don't match.");
    if (next === current) fail(PATH, "Choose a password different from the current one.");
  }
  const problem = isCustomer ? hintProblem(hint, hintOnly ? current : next) : null;
  if (problem) fail(PATH, problem);
  const supabase = await createClient();
  const { error: badCurrent } = await supabase.auth.signInWithPassword({ email: user.email ?? "", password: current });
  if (badCurrent) fail(PATH, "The current password is not right.");
  if (!hintOnly) {
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) fail(PATH, error.message);
  }
  if (isCustomer) {
    const { error } = hint
      ? await supabase.from("password_hints").upsert({ profile_id: profile.id, hint, updated_at: new Date().toISOString() })
      : await supabase.from("password_hints").delete().eq("profile_id", profile.id);
    if (error) fail(PATH, "Password saved, but the hint could not be saved.");
  }
  redirect(`${PATH}?message=${encodeURIComponent(hintOnly ? "Hint saved." : "Password changed.")}`);
}

/** Admin: the card processing fee added to orders paid by card (0 turns it off). */
export async function setCardFee(fd: FormData) {
  const { supabase } = await requireRole();
  const raw = String(fd.get("card_fee_pct") ?? "").trim();
  const pct = Number(raw);
  if (raw === "" || !Number.isFinite(pct) || pct < 0 || pct > 10) fail(PATH, "Enter a card fee between 0 and 10 percent.");
  const { error } = await supabase.from("app_settings").update({ card_fee_pct: Math.round(pct * 100) / 100, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath("/", "layout");
  redirect(`${PATH}?message=${encodeURIComponent(pct ? `Card processing fee set to ${pct}%.` : "Card processing fee turned off.")}`);
}
