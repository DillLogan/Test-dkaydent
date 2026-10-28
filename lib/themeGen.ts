/**
 * Builds a full colour theme (the same CSS variables every palette sets) from one or two colours.
 * Works in OKLCH so lightness steps look even, then nudges any step that would make text hard to read.
 * Pure functions, no dependencies: the same file runs in the app, the demo and the tests.
 */
export type Vars = Record<string, string>;
export type Theme = { light: Vars; dark: Vars };
export type ThemeSeed = { accent: string; neutral?: string; contrast?: boolean };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function isHex(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [L, C, h] with L 0..1, C about 0..0.4, h in degrees. */
export function hexToOklch(hex: string): [number, number, number] {
  const [R, G, B] = hexToRgb(hex).map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, b);
  return [L, C, C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Colour to hex; if it falls outside what a screen can show, chroma is reduced until it fits. */
export function oklchToHex(L: number, C: number, h: number): string {
  let c = C;
  for (let i = 0; i < 40; i++) {
    const lin = oklchToLinear(L, c, h);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return "#" + lin.map((v) => Math.round(clamp(fromLin(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0")).join("");
    }
    c *= 0.93;
  }
  const g = Math.round(clamp(fromLin(clamp(L * L * L, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0");
  return "#" + g + g + g;
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => toLin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Move a colour's lightness (toward dark or light) until it reaches the contrast target against every background given. */
function solve(L: number, C: number, h: number, against: string[], target: number, dir: 1 | -1) {
  let l = L;
  for (let i = 0; i < 120; i++) {
    const hex = oklchToHex(l, C, h);
    if (against.every((bg) => contrast(hex, bg) >= target)) return { hex, L: l };
    l = clamp(l + dir * 0.008, 0, 1);
  }
  return { hex: oklchToHex(l, C, h), L: l };
}

const STONE = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;

/** The CSS variables for one palette, light and dark. Names match globals.css. */
export function buildTheme(seed: ThemeSeed): Theme {
  const [, cA0, hA] = hexToOklch(isHex(seed.accent) ? seed.accent : "#255e38");
  const cA = clamp(cA0, 0.06, 0.17);
  let hN = hA;
  let cN = 0.014;
  if (seed.neutral && isHex(seed.neutral)) {
    const [, c, h] = hexToOklch(seed.neutral);
    hN = h;
    cN = clamp(c * 0.22, 0, 0.03);
  }
  const hi = !!seed.contrast;
  const k = cA / 0.12; // scale for tinted accent surfaces

  // ----- light -----
  const lightWhite = oklchToHex(0.997, cN * 0.25, hN);
  const lS: Record<string, number> = hi
    ? { "50": 0.965, "100": 0.93, "200": 0.78, "300": 0.66, "400": 0.55, "500": 0.44, "600": 0.35, "700": 0.27, "800": 0.19, "900": 0.1 }
    : { "50": 0.962, "100": 0.936, "200": 0.896, "300": 0.835, "400": 0.7, "500": 0.55, "600": 0.44, "700": 0.36, "800": 0.29, "900": 0.22 };
  const light: Vars = { "--color-white": lightWhite };
  for (const s of STONE) light[`--color-stone-${s}`] = oklchToHex(lS[s], s === "50" ? cN * 0.7 : cN, hN);
  light["--color-stone-500"] = solve(lS["500"], cN, hN, [lightWhite, light["--color-stone-50"]], hi ? 7 : 4.6, -1).hex;
  light["--color-stone-600"] = solve(lS["600"], cN, hN, [lightWhite, light["--color-stone-50"]], hi ? 9 : 6.5, -1).hex;
  light["--color-stone-900"] = solve(lS["900"], cN, hN, [light["--color-stone-50"]], hi ? 17 : 12, -1).hex;
  light["--color-brand-50"] = oklchToHex(0.965, 0.028 * k, hA);
  light["--color-brand-100"] = oklchToHex(0.925, 0.045 * k, hA);
  const b7 = solve(hi ? 0.4 : 0.47, cA, hA, [lightWhite, light["--color-brand-50"]], hi ? 7.5 : 4.9, -1);
  light["--color-brand-700"] = b7.hex;
  light["--color-brand-800"] = oklchToHex(Math.max(0.2, b7.L - 0.09), cA * 0.92, hA);
  light["--color-brand-600"] = oklchToHex(b7.L + 0.07, cA, hA);
  light["--color-brand-500"] = oklchToHex(b7.L + 0.16, cA, hA);

  // ----- dark -----
  const darkWhite = oklchToHex(0.225, cN * 1.1, hN);
  const dS: Record<string, number> = hi
    ? { "50": 0.13, "100": 0.2, "200": 0.32, "300": 0.44, "400": 0.58, "500": 0.78, "600": 0.87, "700": 0.93, "800": 0.96, "900": 0.99 }
    : { "50": 0.17, "100": 0.255, "200": 0.31, "300": 0.375, "400": 0.53, "500": 0.72, "600": 0.81, "700": 0.87, "800": 0.92, "900": 0.95 };
  const dark: Vars = { "--color-white": darkWhite };
  for (const s of STONE) dark[`--color-stone-${s}`] = oklchToHex(dS[s], s === "900" || s === "800" ? cN * 0.6 : cN, hN);
  dark["--color-stone-500"] = solve(dS["500"], cN, hN, [darkWhite, dark["--color-stone-50"]], hi ? 7 : 4.6, 1).hex;
  dark["--color-stone-600"] = solve(dS["600"], cN, hN, [darkWhite, dark["--color-stone-50"]], hi ? 9 : 6.5, 1).hex;
  dark["--color-stone-900"] = solve(dS["900"], cN, hN, [dark["--color-stone-50"]], hi ? 17 : 12, 1).hex;
  dark["--color-brand-50"] = oklchToHex(0.265, 0.045 * k, hA);
  dark["--color-brand-100"] = oklchToHex(0.325, 0.06 * k, hA);
  const d7 = solve(hi ? 0.84 : 0.78, cA, hA, [darkWhite, dark["--color-brand-50"]], hi ? 8 : 5, 1);
  dark["--color-brand-700"] = d7.hex;
  dark["--color-brand-600"] = oklchToHex(Math.min(0.93, d7.L + 0.05), cA * 0.9, hA);
  dark["--color-brand-800"] = oklchToHex(Math.min(0.96, d7.L + 0.1), cA * 0.7, hA);
  dark["--color-brand-500"] = oklchToHex(d7.L - 0.12, cA, hA);
  return { light, dark };
}

/** Screen-only CSS for a palette id (print stays black and white). */
export function themeCss(id: string, t: Theme): string {
  const body = (v: Vars) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");
  return `@media screen{:root[data-palette="${id}"]{${body(t.light)}}:root[data-theme="dark"][data-palette="${id}"]{${body(t.dark)}}}`;
}

/** Swatches for the picker cards, the same four the built-in palettes show. */
export function swatches(t: Theme): { light: [string, string, string, string]; dark: [string, string] } {
  return {
    light: [t.light["--color-stone-50"], t.light["--color-white"], t.light["--color-stone-900"], t.light["--color-brand-700"]],
    dark: [t.dark["--color-stone-50"], t.dark["--color-brand-700"]],
  };
}

/**
 * Pick up to 5 theme colours from an image's pixels (RGBA bytes from a small canvas).
 * Colours are grouped by hue; each group is scored by how many pixels it holds and how vivid they are,
 * so a photo's dominant colours win over grey backgrounds.
 */
export function suggestSeeds(data: ArrayLike<number>): string[] {
  const BINS = 18;
  const bins = Array.from({ length: BINS }, () => ({ n: 0, L: 0, C: 0, x: 0, y: 0 }));
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const hex = "#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    const [L, C, h] = hexToOklch(hex);
    if (C < 0.045 || L < 0.2 || L > 0.92) continue;
    const b = bins[Math.floor(h / (360 / BINS)) % BINS];
    b.n++; b.L += L; b.C += C;
    b.x += Math.cos((h * Math.PI) / 180);
    b.y += Math.sin((h * Math.PI) / 180);
  }
  return bins
    .map((b) => ({ b, score: b.n * (b.C / Math.max(1, b.n) + 0.05) }))
    .filter((o) => o.b.n > 0)
    .sort((p, q) => q.score - p.score)
    .slice(0, 5)
    .map(({ b }) => oklchToHex(clamp(b.L / b.n, 0.4, 0.7), clamp(b.C / b.n, 0.06, 0.17), ((Math.atan2(b.y, b.x) * 180) / Math.PI + 360) % 360));
}
