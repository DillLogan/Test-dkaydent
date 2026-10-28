"use client";

import { useEffect, useState } from "react";
import { FONT_KEY, FONTS, PALETTE_KEY, PALETTES, THEME_KEY, type PaletteId, type ThemeChoice } from "@/lib/theme";

const MODES: { value: ThemeChoice; label: string; help: string }[] = [
  { value: "light", label: "Light", help: "Always light" },
  { value: "dark", label: "Dark", help: "Always dark" },
  { value: "system", label: "System", help: "Match this device" },
];

/** Miniature of the app: sidebar, title, a card and a button. */
function Mini({ bg, surface, text, accent }: { bg: string; surface: string; text: string; accent: string }) {
  return (
    <div className="flex h-full flex-1 gap-1.5 p-2" style={{ background: bg }}>
      <div className="w-1/4 rounded-md" style={{ background: surface }} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-2 w-2/3 rounded-full" style={{ background: text }} />
        <div className="flex-1 rounded-md" style={{ background: surface }} />
        <div className="h-2.5 w-1/3 rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
        on ? "border-brand-700 bg-brand-700" : "border-stone-300"
      }`}
      aria-hidden="true"
    >
      {on && <span className="h-2 w-2 rounded-full bg-white" />}
    </span>
  );
}

export function ThemePicker() {
  const [mode, setMode] = useState<ThemeChoice | null>(null);
  const [palette, setPalette] = useState<PaletteId | null>(null);
  const [font, setFont] = useState<string | null>(null);

  useEffect(() => {
    let m: string | null = null;
    let p: string | null = null;
    try {
      m = localStorage.getItem(THEME_KEY);
      p = localStorage.getItem(PALETTE_KEY);
      setFont(FONTS.some((x) => x.id === localStorage.getItem(FONT_KEY)) ? localStorage.getItem(FONT_KEY) : "");
    } catch {
      setFont("");
    }
    setMode(m === "light" || m === "dark" ? m : "system");
    setPalette(PALETTES.some((x) => x.id === p) ? (p as PaletteId) : "fern");
  }, []);

  function save(key: string, value: string, fallback: string) {
    try {
      if (value === fallback) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) root.classList.add("theme-anim");
    (window as any).__dkApplyTheme?.();
    window.setTimeout(() => root.classList.remove("theme-anim"), 450);
  }

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="label">Colours</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PALETTES.map((p) => {
            const on = palette === p.id;
            return (
              <label
                key={p.id}
                className={`lift card flex cursor-pointer flex-col gap-3 p-4 ${on ? "border-brand-500 ring-2 ring-brand-500/40" : "hover:border-stone-300"}`}
              >
                <input
                  type="radio"
                  name="palette"
                  value={p.id}
                  checked={on}
                  onChange={() => {
                    setPalette(p.id);
                    save(PALETTE_KEY, p.id, "fern");
                  }}
                  className="sr-only"
                />
                <div className="flex h-20 overflow-hidden rounded-xl border border-stone-200" aria-hidden="true">
                  <Mini bg={p.light[0]} surface={p.light[1]} text={p.light[2]} accent={p.light[3]} />
                  <Mini bg={p.dark[0]} surface={p.dark[0]} text={p.light[0]} accent={p.dark[1]} />
                </div>
                <span className="flex items-center justify-between gap-2">
                  <span>
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-stone-500">{p.help}</span>
                  </span>
                  <Radio on={on} />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Light or dark</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((o) => {
            const on = mode === o.value;
            return (
              <label
                key={o.value}
                className={`lift card flex cursor-pointer items-center justify-between gap-3 p-4 ${on ? "border-brand-500 ring-2 ring-brand-500/40" : "hover:border-stone-300"}`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={o.value}
                  checked={on}
                  onChange={() => {
                    setMode(o.value);
                    save(THEME_KEY, o.value, "system");
                  }}
                  className="sr-only"
                />
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-stone-500">{o.help}</span>
                </span>
                <Radio on={on} />
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Font</legend>
        <p className="mb-3 text-sm text-stone-500">Pick the typeface that is easiest for you to read. This is saved on this device for you only.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="font-picker">
          {[{ id: "", name: "Palette default", family: "", help: "The font that comes with your colours" }, ...FONTS].map((f) => {
            const on = (font ?? "") === f.id;
            return (
              <label
                key={f.id || "default"}
                className={`lift card flex cursor-pointer items-center justify-between gap-3 p-4 ${on ? "border-brand-500 ring-2 ring-brand-500/40" : "hover:border-stone-300"}`}
              >
                <input
                  type="radio"
                  name="font"
                  value={f.id}
                  checked={on}
                  onChange={() => {
                    setFont(f.id);
                    save(FONT_KEY, f.id, "");
                  }}
                  className="sr-only"
                />
                <span className="min-w-0">
                  <span className="block text-base" style={f.family ? { fontFamily: f.family } : undefined}>
                    {f.name}
                  </span>
                  <span className="block truncate text-sm text-stone-600" style={f.family ? { fontFamily: f.family } : undefined}>
                    Pack 12 stems, Aa 0123
                  </span>
                  <span className="block text-xs text-stone-500">{f.help}</span>
                </span>
                <Radio on={on} />
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
