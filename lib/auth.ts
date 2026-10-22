import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { can, type Profile, type Role } from "./roles";

export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile || !profile.active) {
    redirect("/login?inactive=1");
  }
  return { supabase, user, profile: profile as Profile };
}

export async function requireRole(...roles: Role[]) {
  const session = await getSession();
  if (!can(session.profile, ...roles)) {
    redirect("/?error=" + encodeURIComponent("You don't have access to that page."));
  }
  return session;
}
