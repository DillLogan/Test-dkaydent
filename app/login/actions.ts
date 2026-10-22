"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail, str } from "@/lib/forms";

export async function signIn(fd: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: str(fd, "email") ?? "",
    password: String(fd.get("password") ?? ""),
  });
  if (error) fail("/login", error.message);
  redirect("/");
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
