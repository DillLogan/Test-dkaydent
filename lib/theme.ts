export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "dk-theme";

import { buildTheme, swatches } from "./themeGen";
import { GENERATED } from "./generatedPalettes";
export type { PaletteId } from "./generatedPalettes";

import type { PaletteId } from "./generatedPalettes";
export const PALETTE_KEY = "dk-palette";
/** The saved custom theme: its generated colours (CSS variables) and the colour it was made from. */
export const CUSTOM_KEY = "dk-custom";
export const CUSTOM_SEED_KEY = "dk-custom-seed";

const generated = GENERATED.map((g) => {
  const sw = swatches(buildTheme(g));
  return { id: g.id, name: g.name, help: g.help, light: sw.light, dark: sw.dark };
});

export const PALETTES: {
  id: PaletteId;
  name: string;
  help: string;
  // swatches for the picker: background, surface, text, accent (light) and background, accent (dark)
  light: [string, string, string, string];
  dark: [string, string];
}[] = [
  { id: "fern", name: "Fern", help: "White and green", light: ["#f6f8f5", "#ffffff", "#18211a", "#255e38"], dark: ["#101612", "#7dc191"] },
  { id: "peony", name: "Peony & eucalyptus", help: "Misty green with peony pink", light: ["#eef2ec", "#fbfcfa", "#1f3a2b", "#9e3b5e"], dark: ["#121915", "#e88fb0"] },
  { id: "ranunculus", name: "Ranunculus & linen", help: "Warm linen with buttercup gold", light: ["#f3efe8", "#fffdf9", "#2b1e26", "#8a6214"], dark: ["#181216", "#e8bc5c"] },
  { id: "hydrangea", name: "Hydrangea & stone", help: "Cool stone with periwinkle", light: ["#edf0f4", "#fafbfd", "#1e2a3b", "#4950a3"], dark: ["#111623", "#9ea5ea"] },
  ...generated,
];

export const FONT_KEY = "dk-font";
/** Fonts anyone can pick for themselves. `family` is the CSS font-family value. */
export const FONTS: { id: string; name: string; family: string; help: string }[] = [
  { id: "inter", name: "Inter", family: '"Inter Variable", sans-serif', help: "Clean and neutral" },
  { id: "open-sans", name: "Open Sans", family: '"Open Sans Variable", sans-serif', help: "Friendly and open" },
  { id: "lato", name: "Lato", family: '"Lato", sans-serif', help: "Warm and rounded" },
  { id: "roboto", name: "Roboto", family: '"Roboto", sans-serif', help: "Familiar on phones" },
  { id: "source-sans", name: "Source Sans 3", family: '"Source Sans 3 Variable", sans-serif', help: "Compact and clear" },
  { id: "nunito-sans", name: "Nunito Sans", family: '"Nunito Sans Variable", sans-serif', help: "Soft and easy" },
  { id: "plex-sans", name: "IBM Plex Sans", family: '"IBM Plex Sans", sans-serif', help: "Sharp and technical" },
  { id: "lexend", name: "Lexend", family: '"Lexend Variable", sans-serif', help: "Designed for easier reading" },
  { id: "atkinson", name: "Atkinson Hyperlegible", family: '"Atkinson Hyperlegible", sans-serif', help: "Made for low vision" },
  { id: "opendyslexic", name: "OpenDyslexic", family: '"OpenDyslexic", sans-serif', help: "Weighted letter bottoms for dyslexia" },
  { id: "merriweather", name: "Merriweather", family: '"Merriweather Variable", serif', help: "Serif for long reading" },
  { id: "lora", name: "Lora", family: '"Lora Variable", serif', help: "Elegant serif" },
];

/**
 * Runs in <head> before the page paints: applies the saved theme and palette as
 * data-theme / data-palette on <html> (no flash), and keeps following the device
 * while the theme is "system".
 */
export const themeBootScript = `(function(){try{
var k=${JSON.stringify(THEME_KEY)},pk=${JSON.stringify(PALETTE_KEY)},fk=${JSON.stringify(FONT_KEY)},ck=${JSON.stringify(CUSTOM_KEY)},FF=${JSON.stringify(Object.fromEntries(FONTS.map((f) => [f.id, f.family])))},d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");
function get(x,f){try{return localStorage.getItem(x)||f}catch(e){return f}}
function body(v){var o=[];for(var n in v){if(/^--color-(white|stone-\\d+|brand-\\d+)$/.test(n)&&/^#[0-9a-fA-F]{6}$/.test(v[n]))o.push(n+":"+v[n]);}return o.join(";")}
function custom(){var st=document.getElementById("dk-custom-css");try{var c=JSON.parse(get(ck,"null"));if(c&&c.light&&c.dark){if(!st){st=document.createElement("style");st.id="dk-custom-css";document.head.appendChild(st)}st.textContent='@media screen{:root[data-palette="custom"]{'+body(c.light)+'}:root[data-theme="dark"][data-palette="custom"]{'+body(c.dark)+'}}';return true}}catch(e){}if(st)st.textContent="";return false}
function apply(){var p=get(k,"system"),t=p==="system"?(m.matches?"dark":"light"):p;d.dataset.theme=t;d.dataset.themeChoice=p;d.style.colorScheme=t;var pal=get(pk,"fern");if(pal==="custom"&&!custom())pal="fern";if(pal==="fern")delete d.dataset.palette;else d.dataset.palette=pal;var fo=get(fk,"");if(FF[fo]){d.style.setProperty("--app-sans",FF[fo]);d.style.setProperty("--app-display",FF[fo]);d.dataset.font=fo;}else{d.style.removeProperty("--app-sans");d.style.removeProperty("--app-display");delete d.dataset.font;}}
apply();window.__dkApplyTheme=apply;
m.addEventListener("change",function(){if(get(k,"system")==="system")apply();});
}catch(e){}})();`;
