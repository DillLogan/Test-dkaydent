"use client";

import { useEffect } from "react";

const ITEM = "tbody > tr, ul > li, .card, [data-item], [data-drawer-line], [data-inv-item], [role='alert'], [role='status']";
const FLASH = /total|subtotal|count|fee|due|balance/i;

/**
 * Smooth in-page changes for the whole app: things that appear on the page (a new cart line, a row,
 * a message, an alert) fade and rise in, and totals flash when their value changes.
 * Page changes have their own entrance (template.tsx), so anything arriving with a new page is left alone.
 */
export function Motion() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.querySelector("main");
    if (!root) return;
    let quietUntil = performance.now() + 600; // first paint
    const ease = "cubic-bezier(.22,1,.36,1)";
    const obs = new MutationObserver((records) => {
      if (reduce.matches) return;
      const now = performance.now();
      let n = 0;
      const flashed = new Set<Element>();
      for (const r of records) {
        // text of a total changed
        const host = (r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement)?.closest("[data-testid]");
        if (host && FLASH.test(host.getAttribute("data-testid") || "") && !flashed.has(host) && now > quietUntil) {
          flashed.add(host);
          host.classList.remove("val-flash");
          void (host as HTMLElement).offsetWidth;
          host.classList.add("val-flash");
        }
        for (const node of r.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains("page-in") || node.querySelector(".page-in")) {
            quietUntil = now + 500; // a new page: its own entrance runs
            continue;
          }
          if (now < quietUntil || n > 24) continue;
          const el = node.matches(ITEM) ? node : null;
          if (!el || el.closest(".page-in")?.getAnimations().length) continue;
          const rect = el.getBoundingClientRect();
          if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) continue;
          el.animate([{ opacity: 0, transform: "translateY(6px) scale(.985)" }, { opacity: 1, transform: "none" }], {
            duration: 240,
            easing: ease,
            delay: Math.min(n++, 8) * 18,
            fill: "backwards",
          });
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
