"use client";

import { useEffect, useRef, useState } from "react";

/** Counts a figure up from zero when it first appears ("$1,234.50", "12", "33.0%"). Text without a number shows as is. */
export function CountUp({ text, ms = 700 }: { text: string; ms?: number }) {
  const m = /^([^\d-]*)(-?[\d,]*\d(?:\.\d+)?)(.*)$/.exec(text);
  const [shown, setShown] = useState(text);
  const done = useRef(false);
  useEffect(() => {
    if (!m || done.current) return;
    done.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const [, pre, num, post] = m;
    const target = Number(num.replace(/,/g, ""));
    const dec = (num.split(".")[1] ?? "").length;
    const commas = num.includes(",");
    const fmt = (v: number) => {
      const s = v.toFixed(dec);
      return pre + (commas ? Number(s).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : s) + post;
    };
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(fmt(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShown(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{shown}</>;
}
