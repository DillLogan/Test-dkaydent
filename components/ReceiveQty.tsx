"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "all" | "some" | "none";
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

/**
 * What actually came in for one line: All (what's still due), Some (type how many), or None.
 * Posts `qty_<lineId>` like the plain number box it replaces.
 */
export function ReceiveQty({ lineId, remaining, unit, name }: { lineId: string; remaining: number; unit: string; name: string }) {
  const [mode, setMode] = useState<Mode>("all");
  const [some, setSome] = useState(String(remaining));
  const box = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const qty = mode === "all" ? remaining : mode === "none" ? 0 : Number(some) || 0;

  // a line that isn't coming in is dimmed, so the rest of the row is clearly ignored
  useEffect(() => {
    wrap.current?.closest("tr")?.classList.toggle("recv-none", mode === "none");
    wrap.current?.dispatchEvent(new Event("recv-change", { bubbles: true }));
  }, [mode, some]);

  const pick = (m: Mode) => {
    setMode(m);
    if (m === "some") requestAnimationFrame(() => box.current?.select());
  };

  return (
    <div ref={wrap} className="recv-qty" data-recv data-remaining={remaining} data-qty={qty} data-mode={mode}>
      <div className="recv-seg" role="radiogroup" aria-label={`How much of ${name} came in`}>
        {(["all", "some", "none"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? "on" : ""}
            onClick={() => pick(m)}
            data-testid={`recv-${m}-${lineId}`}
          >
            {m === "all" ? "All" : m === "some" ? "Some" : "None"}
          </button>
        ))}
      </div>
      {mode === "some" ? (
        <span className="recv-some">
          <input
            ref={box}
            name={`qty_${lineId}`}
            type="number"
            min="0"
            step="any"
            value={some}
            onChange={(e) => setSome(e.target.value)}
            className="input w-20"
            aria-label={`Received qty for ${name}`}
          />
          <span className="text-xs text-stone-500">
            of {fmt(remaining)} {unit}
          </span>
          {Number(some) > remaining + 1e-9 && <span className="text-xs text-amber-700">more than due</span>}
        </span>
      ) : (
        <>
          <input type="hidden" name={`qty_${lineId}`} value={qty} />
          <span className="text-xs text-stone-500">{mode === "all" ? `${fmt(remaining)} ${unit}` : "not received"}</span>
        </>
      )}
    </div>
  );
}

/** "3 in full · 1 part · 1 not received" for the form it sits in. */
export function ReceiveSummary() {
  const me = useRef<HTMLParagraphElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const form = me.current?.closest("form");
    if (!form) return;
    const count = () => {
      let full = 0,
        part = 0,
        none = 0;
      form.querySelectorAll<HTMLElement>("[data-recv]").forEach((el) => {
        const q = Number(el.dataset.qty),
          r = Number(el.dataset.remaining);
        if (q <= 1e-9) none++;
        else if (q + 1e-9 < r) part++;
        else full++;
      });
      const bits = [full && `${full} in full`, part && `${part} part`, none && `${none} not received`].filter(Boolean);
      setText(
        !full && !part
          ? "Nothing is marked as received yet."
          : `Receiving ${bits.join(" · ")}.${part || none ? " Whatever didn't come stays open to receive later, or close it short." : ""}`,
      );
    };
    count();
    form.addEventListener("recv-change", count);
    form.addEventListener("input", count);
    return () => {
      form.removeEventListener("recv-change", count);
      form.removeEventListener("input", count);
    };
  }, []);
  return (
    <p ref={me} className="text-sm text-stone-600" aria-live="polite" data-testid="recv-summary">
      {text}
    </p>
  );
}
