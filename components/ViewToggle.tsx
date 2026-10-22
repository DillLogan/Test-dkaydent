"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Switch a list between photo cards and a table; the choice is remembered in this browser. */
export function ViewToggle({ list, view }: { list: string; view: "cards" | "table" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function pick(next: "cards" | "table") {
    if (next === view) return;
    document.cookie = `dk-view-${list}=${next}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  }
  return (
    <div role="group" aria-label="Show as" className={`inline-flex rounded-full border border-stone-200 bg-white p-0.5 ${pending ? "opacity-70" : ""}`}>
      {(["cards", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => pick(v)}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${view === v ? "bg-brand-700 text-white" : "text-stone-600 hover:text-stone-900"}`}
        >
          {v === "cards" ? "Cards" : "Table"}
        </button>
      ))}
    </div>
  );
}
