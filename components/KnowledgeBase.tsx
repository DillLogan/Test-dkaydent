"use client";

import { useMemo, useState } from "react";
import type { Article } from "@/lib/help";

export function KnowledgeBase({ articles, categories }: { articles: Article[]; categories: string[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      articles.filter((a) => {
        if (cat !== "All" && a.category !== cat) return false;
        const hay = `${a.title} ${a.body.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    [articles, cat, words.join(" ")], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" className="input max-w-md flex-1" placeholder="Search the knowledge base" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the knowledge base" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Category">
          {["All", ...categories].map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} className={`btn btn-sm ${cat === c ? "btn-primary" : ""}`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-stone-500" aria-live="polite">
        {shown.length} article{shown.length === 1 ? "" : "s"}
      </p>
      <div className="space-y-2">
        {shown.map((a) => (
          <details key={a.id} id={a.id} className="card group scroll-mt-20" open={words.length > 0 && shown.length <= 3} data-article={a.id}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
              <span>{a.title}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-600">{a.category}</span>
            </summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-stone-700">
              {a.body.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            {a.images?.map((cap, i) => (
              <figure key={i} className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/help/kb-${a.id}-${i + 1}.jpg`} alt={cap} loading="lazy" className="w-full max-w-2xl rounded-lg border border-stone-200" />
                <figcaption className="mt-1 text-xs text-stone-500">{cap}</figcaption>
              </figure>
            ))}
          </details>
        ))}
        {!shown.length && <p className="card text-sm text-stone-500">Nothing matches. Try fewer words.</p>}
      </div>
    </div>
  );
}
