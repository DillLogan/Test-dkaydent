import type { ThemeSeed } from "./themeGen";

export type PaletteId = "fern" | "peony" | "ranunculus" | "hydrangea" | "dahlia" | "marigold" | "sage" | "ocean" | "copper" | "contrast" | "custom";

/** Built-in palettes made with the same generator as a custom theme, so their text is always readable. */
export const GENERATED: (ThemeSeed & { id: PaletteId; name: string; help: string; sans: string; display: string; weight: number })[] = [
  { id: "dahlia", name: "Dahlia & plum", help: "Soft mauve with deep plum", accent: "#8e3a6b", neutral: "#a08a99", sans: "figtree", display: "newsreader", weight: 500 },
  { id: "marigold", name: "Marigold & cream", help: "Warm cream with marigold", accent: "#a45f00", neutral: "#b0a07a", sans: "nunito-sans", display: "gloock", weight: 400 },
  { id: "sage", name: "Sage & clay", help: "Quiet sage with terracotta", accent: "#b0583a", neutral: "#8a9a86", sans: "outfit", display: "instrument-serif", weight: 400 },
  { id: "ocean", name: "Ocean glass", help: "Cool blue-grey with teal", accent: "#0e7490", neutral: "#7f9aa8", sans: "figtree", display: "instrument-serif", weight: 400 },
  { id: "copper", name: "Charcoal & copper", help: "Graphite with copper", accent: "#b8602d", neutral: "#8a8a8a", sans: "outfit", display: "newsreader", weight: 500 },
  { id: "contrast", name: "High contrast", help: "Strong borders and extra-dark text", accent: "#0b3d91", neutral: "#808080", contrast: true, sans: "figtree", display: "figtree", weight: 600 },
];
