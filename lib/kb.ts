import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTICLES, KB_CATEGORIES, TUTORIALS } from "./help";
import type { KbDoc } from "./kbSearch";

/** One article as people see it: a built-in (as shipped, or as admin changed it) or one written in the app. */
export type KbView = {
  id: string; // built-in id, or "u-<row id>" for articles written in the app
  rowId: string | null;
  source: "builtin" | "edited" | "custom";
  category: string;
  title: string;
  body: string[];
  images?: string[];
  hidden: boolean;
  authorId: string | null;
  authorName: string | null;
  updatedAt: string | null;
};

type Row = { id: string; builtin_id: string | null; category: string; title: string; body: string[]; hidden: boolean; author_id: string | null; updated_at: string; profiles: { full_name: string | null; email: string | null } | null };

export async function loadKb(supabase: SupabaseClient) {
  const { data } = await supabase.from("kb_articles").select("id, builtin_id, category, title, body, hidden, author_id, updated_at, profiles:author_id(full_name, email)").order("created_at");
  const rows = (data ?? []) as unknown as Row[];
  const over = new Map(rows.filter((r) => r.builtin_id).map((r) => [r.builtin_id!, r]));
  const name = (r: Row) => r.profiles?.full_name || r.profiles?.email || null;
  const articles: KbView[] = [
    ...ARTICLES.map((a): KbView => {
      const o = over.get(a.id);
      return o
        ? { id: a.id, rowId: o.id, source: "edited", category: o.category, title: o.title, body: o.body.length ? o.body : a.body, images: a.images, hidden: o.hidden, authorId: o.author_id, authorName: name(o), updatedAt: o.updated_at }
        : { id: a.id, rowId: null, source: "builtin", category: a.category, title: a.title, body: a.body, images: a.images, hidden: false, authorId: null, authorName: null, updatedAt: null };
    }),
    ...rows
      .filter((r) => !r.builtin_id)
      .map((r): KbView => ({ id: `u-${r.id}`, rowId: r.id, source: "custom", category: r.category, title: r.title, body: r.body, hidden: r.hidden, authorId: r.author_id, authorName: name(r), updatedAt: r.updated_at })),
  ];
  const categories = [...KB_CATEGORIES, ...[...new Set(articles.map((a) => a.category))].filter((c) => !KB_CATEGORIES.includes(c)).sort()];
  return { articles, categories };
}

/** Tutorials as search results (they open on the Tutorials page). */
export const tutorialDocs = (): KbDoc[] =>
  TUTORIALS.map((t) => ({ id: t.id, kind: "tutorial", title: t.title, category: "Tutorial", text: [t.summary, ...t.steps.map((s) => s.text), ...(t.tip ? [t.tip] : [])], href: `/settings/tutorials#${t.id}` }));
