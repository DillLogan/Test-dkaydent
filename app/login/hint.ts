"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { loginEmail } from "@/lib/username";

const NONE = "No hint has been set for this login.";

/** The hint for a customer login. Same answer for unknown usernames and logins without a hint. */
export async function passwordHint(typed: string): Promise<string> {
  const t = String(typed ?? "").trim().slice(0, 200);
  const admin = createServiceClient();
  if (!t || !admin) return NONE;
  const { data: prof } = await admin.from("profiles").select("id, role, active").eq("email", loginEmail(t)).maybeSingle();
  if (!prof || prof.role !== "customer" || !prof.active) return NONE;
  const { data } = await admin.from("password_hints").select("hint").eq("profile_id", prof.id).maybeSingle();
  return data?.hint ? `Hint: ${data.hint}` : NONE;
}
