"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, str } from "@/lib/forms";
import { categorize, type CategoryRule } from "@/lib/categorize";

const PATH = "/products/categories";

export async function addRule(fd: FormData) {
  const { supabase } = await requireRole("buyer");
  const keyword = str(fd, "keyword")?.toLowerCase();
  const category = str(fd, "category");
  const kind = str(fd, "kind");
  if (!keyword || !category) fail(PATH, "Enter a keyword and a category.");
  const { error } = await supabase
    .from("category_rules")
    .insert({ keyword, category, kind: kind === "flower" || kind === "hard_good" ? kind : null });
  if (error) fail(PATH, error.code === "23505" ? `There's already a rule for "${keyword}".` : dbMessage(error));
  revalidatePath(PATH);
  redirect(`${PATH}?message=${encodeURIComponent(`Added "${keyword}" → ${category}.`)}`);
}

export async function deleteRule(id: string) {
  const { supabase } = await requireRole("buyer");
  const { error } = await supabase.from("category_rules").delete().eq("id", id);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath(PATH);
  redirect(PATH);
}

/** Fill in categories for items that have none, using the rules. */
export async function applyToUncategorized() {
  const { supabase } = await requireRole("buyer");
  const [{ data: items }, { data: rules }] = await Promise.all([
    supabase.from("products").select("id, name").is("category", null),
    supabase.from("category_rules").select("keyword, category, kind, priority"),
  ]);
  let n = 0;
  for (const it of items ?? []) {
    const hit = categorize(it.name, (rules ?? []) as CategoryRule[]);
    if (!hit) continue;
    const { error } = await supabase.from("products").update({ category: hit.category }).eq("id", it.id);
    if (error) fail(PATH, dbMessage(error));
    n++;
  }
  revalidatePath("/products");
  redirect(`${PATH}?message=${encodeURIComponent(n ? `Sorted ${n} uncategorized item${n === 1 ? "" : "s"}.` : "No uncategorized items matched a rule.")}`);
}
