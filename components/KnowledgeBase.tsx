"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { KbView } from "@/lib/kb";
import { bestLine, highlight, searchKb, type KbDoc } from "@/lib/kbSearch";

type Result = { error?: string; id?: string };
type Actions = {
  saveArticle: (a: { id?: string; builtinId?: string; title: string; category: string; text: string }) => Promise<Result>;
  deleteArticle: (rowId: string) => Promise<Result>;
  setArticleHidden: (t: { builtinId?: string; rowId?: string }, hidden: boolean) => Promise<Result>;
  restoreBuiltin: (builtinId: string) => Promise<Result>;
};

/** Marks the words that matched the search. */
function Hl({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

/**
 * The knowledge base: ranked search over articles and tutorials (matching words marked), categories,
 * and writing articles. Any staff member adds one and edits their own; admin edits, hides or removes any,
 * and can reword or hide built-in articles (Restore original puts one back as shipped).
 */
export function KnowledgeBase({
  articles,
  categories,
  tutorials,
  me,
  actions,
}: {
  articles: KbView[];
  categories: string[];
  tutorials: KbDoc[];
  me: { id: string; isAdmin: boolean };
  actions: Actions;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<null | { mode: "new" } | { mode: "edit"; a: KbView }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [newCat, setNewCat] = useState(false);

  const visible = articles.filter((a) => showHidden || !a.hidden);
  const byId = new Map(visible.map((a) => [a.id, a]));
  const docs: KbDoc[] = useMemo(
    () => [
      ...visible.filter((a) => cat === "All" || a.category === cat).map((a): KbDoc => ({ id: a.id, kind: "article", title: a.title, category: a.category, text: a.body, custom: a.source === "custom" })),
      ...(cat === "All" || cat === "Tutorials" ? tutorials : []),
    ],
    [visible, cat, tutorials], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const searching = q.trim().length > 0;
  const hits = useMemo(() => (searching ? searchKb(docs, q) : docs.filter((d) => d.kind === "article").map((doc) => ({ doc, score: 0, partial: false, terms: [] as string[] }))), [docs, q, searching]);
  const terms = hits[0]?.terms ?? [];

  const canEdit = (a: KbView) => me.isAdmin || (a.source === "custom" && a.authorId === me.id);

  function run(fn: () => Promise<Result>, after?: (r: Result) => void) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (r.error) return setErr(r.error);
      after?.(r);
      router.refresh();
    });
  }

  function submit(fd: FormData) {
    const category = String(fd.get(newCat ? "newCategory" : "category") ?? "");
    const base = { title: String(fd.get("title") ?? ""), category, text: String(fd.get("text") ?? "") };
    const ed = editing;
    if (!ed) return;
    run(
      () =>
        ed.mode === "new"
          ? actions.saveArticle(base)
          : ed.a.source === "custom"
            ? actions.saveArticle({ ...base, id: ed.a.rowId! })
            : actions.saveArticle({ ...base, builtinId: ed.a.id }),
      (r) => {
        setEditing(null);
        setNewCat(false);
        if (r.id) setTimeout(() => document.getElementById(r.id!)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      },
    );
  }

  return (
    <div data-testid="kb">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input max-w-md flex-1"
          placeholder="Search articles and tutorials"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search the knowledge base"
          data-testid="kb-search"
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setErr(null);
            setNewCat(false);
            setEditing({ mode: "new" });
          }}
          data-testid="kb-new"
        >
          + Write an article
        </button>
      </div>
      <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Category">
        {["All", ...categories, "Tutorials"].map((c) => (
          <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className={`btn btn-sm ${cat === c ? "btn-primary" : ""}`}>
            {c}
          </button>
        ))}
        {me.isAdmin && articles.some((a) => a.hidden) && (
          <label className="ml-2 flex items-center gap-1.5 text-sm text-stone-600">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
          </label>
        )}
      </div>
      {err && !editing && (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}
      <p className="mb-3 text-xs text-stone-500" aria-live="polite" data-testid="kb-count">
        {searching
          ? hits.length
            ? `${hits.length} result${hits.length === 1 ? "" : "s"}, best match first${hits[0].partial ? " (no result has every word; these match most of them)" : ""}`
            : "No results"
          : `${hits.length} article${hits.length === 1 ? "" : "s"}`}
      </p>

      <div className="space-y-2" key={`${cat}|${searching}`}>
        {hits.map(({ doc }, i) => {
          if (doc.kind === "tutorial") {
            return (
              <Link key={`t-${doc.id}`} href={doc.href!} className="card lift block" data-result="tutorial">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    <Hl text={doc.title} terms={terms} />
                  </span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">Tutorial</span>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  <Hl text={bestLine(doc, terms)} terms={terms} />
                </p>
              </Link>
            );
          }
          const a = byId.get(doc.id)!;
          return (
            <details
              key={a.id}
              id={a.id}
              className={`card group scroll-mt-20 open:border-brand-500 open:ring-2 open:ring-brand-500/30 ${a.hidden ? "opacity-60" : ""}`}
              open={searching && i < 2}
              data-article={a.id}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                <span>
                  <Hl text={a.title} terms={terms} />
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {a.hidden && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Hidden</span>}
                  {a.source !== "builtin" && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">{a.source === "custom" ? "Added" : "Edited"}</span>
                  )}
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-600">{a.category}</span>
                </span>
              </summary>
              {searching && (
                <p className="mt-2 text-sm text-stone-500 group-open:hidden">
                  <Hl text={bestLine(doc, terms)} terms={terms} />
                </p>
              )}
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-stone-700">
                {a.body.map((b, j) => (
                  <li key={j}>
                    <Hl text={b} terms={terms} />
                  </li>
                ))}
              </ul>
              {a.images?.map((cap, j) => (
                <figure key={j} className="mt-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/help/kb-${a.id}-${j + 1}.jpg`} alt={cap} loading="lazy" className="w-full max-w-2xl rounded-lg border border-stone-200" />
                  <figcaption className="mt-1 text-xs text-stone-500">{cap}</figcaption>
                </figure>
              ))}
              {(a.authorName || canEdit(a)) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 text-xs text-stone-500">
                  {a.authorName && (
                    <span className="mr-auto">
                      {a.source === "custom" ? "Written by" : "Changed by"} {a.authorName}
                      {a.updatedAt ? ` · ${new Date(a.updatedAt).toLocaleDateString()}` : ""}
                    </span>
                  )}
                  {canEdit(a) && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setErr(null);
                        setNewCat(false);
                        setEditing({ mode: "edit", a });
                      }}
                      data-testid="kb-edit"
                    >
                      Edit
                    </button>
                  )}
                  {me.isAdmin && (
                    <button type="button" className="btn btn-sm" onClick={() => run(() => actions.setArticleHidden(a.source === "custom" ? { rowId: a.rowId! } : { builtinId: a.id }, !a.hidden))} data-testid="kb-hide">
                      {a.hidden ? "Show" : "Hide"}
                    </button>
                  )}
                  {me.isAdmin && a.source === "edited" && (
                    <button type="button" className="btn btn-sm" onClick={() => window.confirm("Put this article back the way it shipped?") && run(() => actions.restoreBuiltin(a.id))}>
                      Restore original
                    </button>
                  )}
                  {a.source === "custom" && canEdit(a) && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => window.confirm("Remove this article?") && run(() => actions.deleteArticle(a.rowId!))} data-testid="kb-delete">
                      Remove
                    </button>
                  )}
                </div>
              )}
            </details>
          );
        })}
        {!hits.length && <p className="card text-sm text-stone-500">Nothing matches. Try fewer or different words.</p>}
      </div>

      {editing && (
        <div className="modal-bg fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-ed-title"
            className="w-full max-w-xl space-y-3 rounded-2xl bg-white p-5 shadow-xl"
            data-testid="kb-editor"
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget));
            }}
          >
            <h2 id="kb-ed-title" className="text-lg font-semibold text-stone-900">
              {editing.mode === "new" ? "Write an article" : editing.a.source === "custom" ? "Edit article" : "Edit built-in article"}
            </h2>
            {editing.mode === "edit" && editing.a.source !== "custom" && (
              <p className="text-xs text-stone-500">Your wording replaces the original for everyone. Restore original brings it back.</p>
            )}
            {err && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {err}
              </div>
            )}
            <label className="block">
              <span className="label">Title</span>
              <input name="title" className="input" required maxLength={150} defaultValue={editing.mode === "edit" ? editing.a.title : ""} placeholder="e.g. Handling rush orders" autoFocus />
            </label>
            <label className="block">
              <span className="label">Category</span>
              {newCat ? (
                <input name="newCategory" className="input" required maxLength={40} placeholder="New category name" autoFocus />
              ) : (
                <select
                  name="category"
                  className="input"
                  defaultValue={editing.mode === "edit" ? editing.a.category : categories[0]}
                  onChange={(e) => e.target.value === "__new" && setNewCat(true)}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="__new">+ New category…</option>
                </select>
              )}
            </label>
            <label className="block">
              <span className="label">Text</span>
              <textarea
                name="text"
                className="input min-h-48"
                required
                defaultValue={editing.mode === "edit" ? editing.a.body.join("\n\n") : ""}
                placeholder={"Write each point as its own paragraph.\n\nLeave a blank line between paragraphs; each one shows as a bullet."}
              />
              <span className="mt-1 block text-xs text-stone-500">Each paragraph (separated by a blank line) shows as a bullet point. Search finds words anywhere in the title or text.</span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending} data-testid="kb-save">
                {pending ? "Saving…" : editing.mode === "new" ? "Add article" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
