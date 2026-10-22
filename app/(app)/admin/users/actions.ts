"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { bool, dbMessage, fail, str } from "@/lib/forms";

const VALID = ["admin", "buyer", "warehouse", "sales"];

export async function updateUser(userId: string, fd: FormData) {
  const { supabase, user } = await requireRole();
  const path = "/admin/users";
  if (userId === user.id) fail(path, "You can't change your own role or access.");
  const role = str(fd, "role");
  if (!role || !VALID.includes(role)) fail(path, "Choose a valid role.");
  const { error } = await supabase
    .from("profiles")
    .update({ role, active: bool(fd, "active"), full_name: str(fd, "full_name") })
    .eq("id", userId);
  if (error) fail(path, dbMessage(error));
  revalidatePath(path);
  redirect(`${path}?message=${encodeURIComponent("User updated.")}`);
}
