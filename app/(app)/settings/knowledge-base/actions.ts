"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ARTICLES } from "@/lib/help";
import { dbMessage } from "@/lib/forms";

type Result = { error?: string; id?: string };
const PATH = "/settings/knowledge-base";

/** Paragraphs are separated by a blank line. */
const paragraphs = (text: string) =>
  String(text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .slice(0, 60);

export type ArticleInput = { id?: string; builtinId?: string; title: string; category: string; text: string };

/** Add an article, edit your own (admin: anyone's), or (admin) change a built-in article's wording. */
export async function saveArticle(a: ArticleInput): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (profile.role === "customer") return { error: "Not allowed." };
  const title = String(a.title ?? "").trim().replace(/\s+/g, " ");
  const category = String(a.category ?? "").trim().replace(/\s+/g, " ");
  const body = paragraphs(a.text);
  if (!title || title.length > 150) return { error: "Give the article a title (up to 150 characters)." };
  if (!category || category.length > 40) return { error: "Choose or type a category (up to 40 characters)." };
  if (!body.length) return { error: "Write the article text." };
  if (body.some((p) => p.length > 2000)) return { error: "Each paragraph can be up to 2,000 characters. Split long ones with a blank line." };
  if (a.builtinId) {
    if (!can(profile)) return { error: "Only admin can change built-in articles." };
    if (!ARTICLES.some((x) => x.id === a.builtinId)) return { error: "Article not found." };
    const { error } = await supabase.from("kb_articles").upsert({ builtin_id: a.builtinId, title, category, body, author_id: profile.id }, { onConflict: "builtin_id" });
    if (error) return { error: dbMessage(error) };
    revalidatePath(PATH);
    return { id: a.builtinId };
  }
  if (a.id) {
    const { data, error } = await supabase.from("kb_articles").update({ title, category, body }).eq("id", a.id).is("builtin_id", null).select("id");
    if (error) return { error: dbMessage(error) };
    if (!data?.length) return { error: "You can only edit articles you wrote." };
    revalidatePath(PATH);
    return { id: `u-${a.id}` };
  }
  const { data, error } = await supabase.from("kb_articles").insert({ title, category, body, author_id: profile.id }).select("id").single();
  if (error) return { error: dbMessage(error) };
  revalidatePath(PATH);
  return { id: `u-${data.id}` };
}

/** Remove an article you wrote (admin: any article written in the app). */
export async function deleteArticle(rowId: string): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (profile.role === "customer") return { error: "Not allowed." };
  const { data, error } = await supabase.from("kb_articles").delete().eq("id", rowId).is("builtin_id", null).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "You can only remove articles you wrote." };
  revalidatePath(PATH);
  return {};
}

/** Admin: hide or show an article (built-in or written in the app). */
export async function setArticleHidden(target: { builtinId?: string; rowId?: string }, hidden: boolean): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (!can(profile)) return { error: "Only admin can hide articles." };
  if (target.builtinId) {
    const base = ARTICLES.find((x) => x.id === target.builtinId);
    if (!base) return { error: "Article not found." };
    const { data: cur } = await supabase.from("kb_articles").select("id").eq("builtin_id", base.id).maybeSingle();
    const { error } = cur
      ? await supabase.from("kb_articles").update({ hidden }).eq("id", cur.id)
      : await supabase.from("kb_articles").insert({ builtin_id: base.id, title: base.title, category: base.category, body: [], hidden, author_id: profile.id });
    if (error) return { error: dbMessage(error) };
  } else if (target.rowId) {
    const { error } = await supabase.from("kb_articles").update({ hidden }).eq("id", target.rowId);
    if (error) return { error: dbMessage(error) };
  }
  revalidatePath(PATH);
  return {};
}

/** Admin: put a built-in article back the way it shipped (and show it again). */
export async function restoreBuiltin(builtinId: string): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (!can(profile)) return { error: "Only admin can restore built-in articles." };
  const { error } = await supabase.from("kb_articles").delete().eq("builtin_id", builtinId);
  if (error) return { error: dbMessage(error) };
  revalidatePath(PATH);
  return {};
}
