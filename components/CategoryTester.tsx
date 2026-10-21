"use client";

import { useState } from "react";
import { categorize, type CategoryRule } from "@/lib/categorize";

export function CategoryTester({ rules }: { rules: CategoryRule[] }) {
  const [name, setName] = useState("Spray Rose Majolika 40cm");
  const hit = name.trim() ? categorize(name, rules) : null;
  return (
    <div className="card space-y-2">
      <label className="block">
        <span className="label">Try an item name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="text-sm" aria-live="polite">
        {hit ? (
          <>
            → <b>{hit.category}</b>
            {hit.kind && <span className="text-stone-500"> ({hit.kind === "flower" ? "flower" : "hard good"})</span>}{" "}
            <span className="text-stone-500">matched “{hit.keyword}”</span>
          </>
        ) : (
          <span className="text-amber-700">No rule matches. It would be imported as Uncategorized.</span>
        )}
      </p>
    </div>
  );
}
