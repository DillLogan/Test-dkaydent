"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; help: string }[] = [
  { value: "light", label: "Light", help: "Always light" },
  { value: "dark", label: "Dark", help: "Always dark" },
  { value: "system", label: "System", help: "Match this device" },
];

/** Miniature of the app in a given palette. */
function Preview({ mode }: { mode: "light" | "dark" | "split" }) {
  const pane = (dark: boolean) => (
    <div className={`flex h-full flex-1 gap-1 p-1.5 ${dark ? "bg-[#121513]" : "bg-[#f6f7f5]"}`}>
      <div className={`w-1/4 rounded-sm ${dark ? "bg-[#1a1e1b]" : "bg-[#ffffff]"}`} />
      <div className="flex flex-1 flex-col gap-1">
        <div className={`h-1.5 w-2/3 rounded-full ${dark ? "bg-[#e9ede8]" : "bg-[#1d221e]"}`} />
        <div className={`flex-1 rounded-sm border ${dark ? "border-[#323933] bg-[#1a1e1b]" : "border-[#dfe3dd] bg-[#ffffff]"}`} />
        <div className={`h-2 w-1/3 rounded-sm ${dark ? "bg-[#7fb487]" : "bg-[#2e5234]"}`} />
      </div>
    </div>
  );
  return (
    <div className="flex h-20 overflow-hidden rounded-md border border-stone-200" aria-hidden="true">
      {mode === "split" ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(mode === "dark")
      )}
    </div>
  );
}

export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {}
    setChoice(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {}
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) root.classList.add("theme-anim");
    (window as any).__dkApplyTheme?.();
    window.setTimeout(() => root.classList.remove("theme-anim"), 350);
  }

  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map((o) => {
        const selected = choice === o.value;
        return (
          <label
            key={o.value}
            className={`lift card flex cursor-pointer flex-col gap-3 ${
              selected ? "border-brand-600 ring-1 ring-brand-600" : "hover:border-stone-300"
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={selected}
              onChange={() => pick(o.value)}
              className="sr-only"
            />
            <Preview mode={o.value === "system" ? "split" : o.value} />
            <span className="flex items-center justify-between gap-2">
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-stone-500">{o.help}</span>
              </span>
              <span
                className={`grid h-4 w-4 place-items-center rounded-full border transition-colors ${
                  selected ? "border-brand-700 bg-brand-700" : "border-stone-300"
                }`}
              >
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
