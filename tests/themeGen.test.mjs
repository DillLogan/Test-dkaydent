// Run: node --experimental-strip-types --no-warnings tests/themeGen.test.mjs
import { buildTheme, contrast, hexToOklch, oklchToHex, suggestSeeds, themeCss, isHex } from "../lib/themeGen.ts";
let pass = 0;
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); pass++; };
const [L, C, h] = hexToOklch("#ff0000");
ok(Math.abs(L - 0.628) < 0.01 && Math.abs(C - 0.258) < 0.01 && Math.abs(h - 29.2) < 1, `red in OKLCH (${L.toFixed(3)}, ${C.toFixed(3)}, ${h.toFixed(1)})`);
for (const hex of ["#255e38", "#9e3b5e", "#4950a3", "#808080", "#ffffff", "#000000"]) {
  const [l, c, hh] = hexToOklch(hex); const back = oklchToHex(l, c, hh);
  ok(contrast(hex, back) < 1.05, `${hex} round trips (${back})`);
}
ok(contrast("#000000", "#ffffff") > 20.9, "black on white is 21");
// every seed, light and dark, normal and high contrast
let seeds = 0;
for (let hue = 0; hue < 360; hue += 12) for (const ch of [0.02, 0.08, 0.15, 0.25]) for (const mode of [false, true]) {
  const accent = oklchToHex(0.55, ch, hue);
  const t = buildTheme({ accent, neutral: oklchToHex(0.6, 0.05, (hue + 40) % 360), contrast: mode });
  seeds++;
  for (const [name, v] of [["light", t.light], ["dark", t.dark]]) {
    const w = v["--color-white"], bg = v["--color-stone-50"];
    for (const [k, x] of Object.entries(v)) ok(isHex(x), `${accent} ${name} ${k} is a hex (${x})`);
    const min = mode ? 7 : 4.5;
    ok(contrast(v["--color-stone-900"], bg) >= (mode ? 15 : 10), `${accent} ${name} main text on page (${contrast(v["--color-stone-900"], bg).toFixed(1)})`);
    ok(contrast(v["--color-stone-900"], w) >= (mode ? 15 : 10), `${accent} ${name} main text on cards`);
    ok(contrast(v["--color-stone-600"], w) >= (mode ? 8.5 : 6), `${accent} ${name} secondary text on cards (${contrast(v["--color-stone-600"], w).toFixed(1)})`);
    ok(contrast(v["--color-stone-500"], w) >= min && contrast(v["--color-stone-500"], bg) >= min, `${accent} ${name} muted text (${contrast(v["--color-stone-500"], w).toFixed(1)})`);
    ok(contrast(v["--color-brand-700"], w) >= min, `${accent} ${name} accent on cards (${contrast(v["--color-brand-700"], w).toFixed(1)})`);
    ok(contrast(v["--color-brand-700"], v["--color-brand-50"]) >= min, `${accent} ${name} accent on tinted background`);
  }
  // light button: white text on brand-700; dark: accent stays distinguishable from the page
  ok(contrast("#ffffff", t.light["--color-brand-700"]) >= 4.5, `${accent} white on accent button`);
  ok(contrast(t.dark["--color-brand-700"], t.dark["--color-stone-50"]) >= 4.5, `${accent} dark accent on page`);
}
const css = themeCss("custom", buildTheme({ accent: "#9e3b5e" }));
ok(css.startsWith("@media screen{") && css.includes('[data-palette="custom"]') && !/[<>]/.test(css), "css is screen-only and clean");
// image colours: a mostly-teal picture with some grey
const px = []; for (let i = 0; i < 400; i++) px.push(...(i % 5 ? [14, 140, 160, 255] : [128, 128, 128, 255]));
for (let i = 0; i < 60; i++) px.push(200, 90, 40, 255);
const picks = suggestSeeds(px);
ok(picks.length === 2 && Math.abs(hexToOklch(picks[0])[2] - hexToOklch("#0e8ca0")[2]) < 15, `teal is the top pick (${picks})`);
ok(suggestSeeds([128, 128, 128, 255, 250, 250, 250, 255]).length === 0, "grey image gives no colours");
console.log(`${pass} checks passed over ${seeds} seed themes`);
