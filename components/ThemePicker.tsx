"use client";

import { useEffect, useState } from "react";
import { CUSTOM_KEY, CUSTOM_SEED_KEY, FONT_KEY, FONTS, PALETTE_KEY, PALETTES, THEME_KEY, type PaletteId, type ThemeChoice } from "@/lib/theme";
import { buildTheme, isHex, suggestSeeds, swatches } from "@/lib/themeGen";

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

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Read a photo in the browser and suggest theme colours from it. The photo is never uploaded or saved. */
async function coloursFromFile(file: File): Promise<string[]> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Choose a JPG, PNG, WebP or GIF picture.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That picture is over 10 MB. Choose a smaller one.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error("That picture could not be opened."));
      img.src = url;
    });
    const size = 64;
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser can't read pictures.");
    ctx.drawImage(img, 0, 0, w, h);
    const found = suggestSeeds(ctx.getImageData(0, 0, w, h).data);
    if (!found.length) throw new Error("No strong colours found in that picture. Try another, or pick a colour yourself.");
    return found;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CustomTheme({ active, onUse }: { active: boolean; onUse: () => void }) {
  const [accent, setAccent] = useState("#255e38");
  const [hex, setHex] = useState("#255e38");
  const [hi, setHi] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(CUSTOM_SEED_KEY) || "null");
      if (raw && isHex(raw.accent)) {
        setAccent(raw.accent);
        setHex(raw.accent);
        setHi(!!raw.contrast);
      }
    } catch {}
  }, []);

  const theme = buildTheme({ accent, contrast: hi });
  const sw = swatches(theme);

  function choose(v: string) {
    setAccent(v);
    setHex(v);
  }
  function saveIt() {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(theme));
      localStorage.setItem(CUSTOM_SEED_KEY, JSON.stringify({ accent, contrast: hi }));
    } catch {
      setMsg("This browser wouldn't save the theme (private mode?). It will last until you close the tab.");
    }
    onUse();
    setMsg("Custom theme saved on this device.");
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMsg("");
    try {
      const found = await coloursFromFile(f);
      setPicks(found);
      choose(found[0]);
    } catch (err) {
      setPicks([]);
      setMsg(err instanceof Error ? err.message : "That picture could not be used.");
    }
  }

  return (
    <div className="card space-y-4 p-4" data-testid="custom-theme">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Make your own</div>
          <div className="text-xs text-stone-500">Pick one colour (or take it from a photo). The rest is worked out, with text kept easy to read.</div>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Close" : active ? "Edit custom theme" : "Create custom theme"}
        </button>
      </div>
      {open && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label">Main colour</span>
                <input type="color" value={accent} onChange={(e) => choose(e.target.value)} className="h-10 w-16 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5" aria-label="Main colour" />
              </label>
              <label className="block">
                <span className="label">Hex code</span>
                <input
                  className="input w-32 font-mono"
                  value={hex}
                  maxLength={7}
                  spellCheck={false}
                  onChange={(e) => {
                    const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
                    setHex(v);
                    if (isHex(v)) setAccent(v.toLowerCase());
                  }}
                  aria-label="Hex code"
                />
              </label>
              <label className="block">
                <span className="label">From a photo</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onFile} className="block text-sm" aria-label="Choose a photo to take colours from" />
              </label>
            </div>
            {picks.length > 0 && (
              <div>
                <div className="label">Colours found in your photo</div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Colours from your photo">
                  {picks.map((c) => (
                    <button key={c} type="button" onClick={() => choose(c)} className={`h-10 w-10 rounded-full border-2 ${c === accent ? "border-stone-900" : "border-stone-200"}`} style={{ background: c }} aria-label={`Use ${c}`} aria-pressed={c === accent} />
                  ))}
                </div>
                <p className="mt-1 text-xs text-stone-500">The photo is read in your browser and is not uploaded or kept.</p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hi} onChange={(e) => setHi(e.target.checked)} className="h-4 w-4" />
              High contrast (stronger borders, extra-dark text)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={saveIt} data-testid="use-custom">
                Use this theme
              </button>
              <span className="text-sm text-brand-700" aria-live="polite">{msg}</span>
            </div>
          </div>
          <div className="flex h-24 overflow-hidden rounded-xl border border-stone-200 self-start" aria-hidden="true" data-testid="custom-preview">
            <Mini bg={sw.light[0]} surface={sw.light[1]} text={sw.light[2]} accent={sw.light[3]} />
            <Mini bg={sw.dark[0]} surface={sw.dark[0]} text={sw.light[0]} accent={sw.dark[1]} />
          </div>
        </div>
      )}
    </div>
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
    setPalette(PALETTES.some((x) => x.id === p) || p === "custom" ? (p as PaletteId) : "fern");
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
        <div className="mt-3">
          <CustomTheme
            active={palette === "custom"}
            onUse={() => {
              setPalette("custom");
              save(PALETTE_KEY, "custom", "fern");
            }}
          />
        </div>
        {palette === "custom" && (
          <button
            type="button"
            className="btn mt-3"
            onClick={() => {
              setPalette("fern");
              save(PALETTE_KEY, "fern", "fern");
            }}
          >
            Go back to the default colours
          </button>
        )}
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
