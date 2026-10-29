"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail, str } from "@/lib/forms";
import { loginEmail } from "@/lib/username";

export async function signIn(fd: FormData) {
  const supabase = await createClient();
  const typed = str(fd, "email") ?? "";
  const { error } = await supabase.auth.signInWithPassword({
    email: loginEmail(typed),
    password: String(fd.get("password") ?? ""),
  });
  const next = String(fd.get("next") ?? "");
  // only a path on this site (e.g. a signing link), never another address
  const safeNext = /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : "/";
  if (error) fail(`/login?u=${encodeURIComponent(typed.slice(0, 200))}${safeNext !== "/" ? `&next=${encodeURIComponent(safeNext)}` : ""}`, error.message);
  redirect(safeNext);
}

export async function signUp(fd: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: str(fd, "email") ?? "",
    password: String(fd.get("password") ?? ""),
    options: { data: { full_name: str(fd, "full_name") } },
  });
  if (error) fail("/login?mode=signup", error.message);
  if (!data.session) {
    redirect(
      "/login?message=" +
        encodeURIComponent("Check your email to confirm your address, then sign in."),
    );
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
