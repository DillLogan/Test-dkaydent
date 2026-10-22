export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "dk-theme";

export type PaletteId = "fern" | "peony" | "ranunculus" | "hydrangea";
export const PALETTE_KEY = "dk-palette";
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
];

/**
 * Runs in <head> before the page paints: applies the saved theme and palette as
 * data-theme / data-palette on <html> (no flash), and keeps following the device
 * while the theme is "system".
 */
export const themeBootScript = `(function(){try{
var k=${JSON.stringify(THEME_KEY)},pk=${JSON.stringify(PALETTE_KEY)},d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");
function get(x,f){try{return localStorage.getItem(x)||f}catch(e){return f}}
function apply(){var p=get(k,"system"),t=p==="system"?(m.matches?"dark":"light"):p;d.dataset.theme=t;d.dataset.themeChoice=p;d.style.colorScheme=t;var pal=get(pk,"fern");if(pal==="fern")delete d.dataset.palette;else d.dataset.palette=pal;}
apply();window.__dkApplyTheme=apply;
m.addEventListener("change",function(){if(get(k,"system")==="system")apply();});
}catch(e){}})();`;
