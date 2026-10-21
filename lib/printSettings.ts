/** Printing preferences, saved per computer (browser localStorage). */
export type PrintMode = "label" | "regular";
export type Paper = "letter" | "a4";
export type PrintSettings = { mode: PrintMode; size: string; w: number; h: number; paper: Paper };

export const PRINT_KEY = "dk-print";

/** Label sizes in inches (width × height as the label comes out of the printer). */
export const LABEL_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: "2.25x1.25", label: "2.25 × 1.25 in (Zebra / Rollo roll)", w: 2.25, h: 1.25 },
  { id: "2x1", label: "2 × 1 in (small SKU / price)", w: 2, h: 1 },
  { id: "3x2", label: "3 × 2 in", w: 3, h: 2 },
  { id: "4x2", label: "4 × 2 in", w: 4, h: 2 },
  { id: "4x6", label: "4 × 6 in (box / bucket tag)", w: 4, h: 6 },
  { id: "dymo30252", label: "DYMO 30252 (3.5 × 1.1 in)", w: 3.5, h: 1.125 },
];

export const PAPERS: Record<Paper, { label: string; w: number; h: number }> = {
  letter: { label: "Letter (8.5 × 11 in)", w: 8.5, h: 11 },
  a4: { label: "A4 (210 × 297 mm)", w: 8.27, h: 11.69 },
};

export const DEFAULT_PRINT: PrintSettings = { mode: "label", size: "2.25x1.25", w: 2.25, h: 1.25, paper: "letter" };

const clampIn = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.5 && n <= 8 ? Math.round(n * 100) / 100 : d;
};

export function readPrintSettings(): PrintSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(PRINT_KEY) || "null");
    if (!raw) return DEFAULT_PRINT;
    const preset = LABEL_SIZES.find((s) => s.id === raw.size);
    return {
      mode: raw.mode === "regular" ? "regular" : "label",
      size: preset ? preset.id : "custom",
      w: preset ? preset.w : clampIn(raw.w, DEFAULT_PRINT.w),
      h: preset ? preset.h : clampIn(raw.h, DEFAULT_PRINT.h),
      paper: raw.paper === "a4" ? "a4" : "letter",
    };
  } catch {
    return DEFAULT_PRINT;
  }
}

export function savePrintSettings(s: PrintSettings) {
  try {
    localStorage.setItem(PRINT_KEY, JSON.stringify(s));
  } catch {}
}

export function withSize(s: PrintSettings, size: string, w?: number, h?: number): PrintSettings {
  const preset = LABEL_SIZES.find((x) => x.id === size);
  return preset ? { ...s, size, w: preset.w, h: preset.h } : { ...s, size: "custom", w: clampIn(w ?? s.w, s.w), h: clampIn(h ?? s.h, s.h) };
}
