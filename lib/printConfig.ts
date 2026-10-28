/** What the printed paperwork says and shows. One shared setting, edited by the admin. */
export type PrintConfig = {
  header: { name: string; address: string; phone: string; footer: string };
  invoice: { showSku: boolean; showNotes: boolean; showBarcode: boolean; showResale: boolean; terms: string; note: string; customerTitle: string; officeTitle: string };
  pull: { showSku: boolean; showLot: boolean; showNotes: boolean; showBarcode: boolean; showLabelLine: boolean };
  route: { showPhone: boolean; showBoxes: boolean };
  labels: { showAddress: boolean; showRoute: boolean };
};

export const DEFAULT_CONFIG: PrintConfig = {
  header: { name: "DKaydent Wholesale", address: "", phone: "", footer: "" },
  invoice: { showSku: true, showNotes: true, showBarcode: true, showResale: true, terms: "", note: "", customerTitle: "Customer copy", officeTitle: "Office copy" },
  pull: { showSku: true, showLot: true, showNotes: true, showBarcode: true, showLabelLine: true },
  route: { showPhone: true, showBoxes: true },
  labels: { showAddress: true, showRoute: true },
};

type Json = Record<string, unknown>;

/** Fill any missing or wrong-typed setting from the defaults, so old or partial saves never break a printout. */
export function mergeConfig(raw: unknown): PrintConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Json;
  const out: Json = {};
  for (const [group, defs] of Object.entries(DEFAULT_CONFIG)) {
    const src = (r[group] && typeof r[group] === "object" ? r[group] : {}) as Json;
    const g: Json = {};
    for (const [k, d] of Object.entries(defs as Json)) {
      const v = src[k];
      g[k] = typeof d === "boolean" ? (typeof v === "boolean" ? v : d) : typeof v === "string" ? v.slice(0, 500) : d;
    }
    out[group] = g;
  }
  const c = out as PrintConfig;
  if (!c.header.name.trim()) c.header.name = DEFAULT_CONFIG.header.name;
  if (!c.invoice.customerTitle.trim()) c.invoice.customerTitle = DEFAULT_CONFIG.invoice.customerTitle;
  if (!c.invoice.officeTitle.trim()) c.invoice.officeTitle = DEFAULT_CONFIG.invoice.officeTitle;
  return c;
}

/** Read the saved setting; any failure falls back to the defaults so printing always works. */
export async function loadPrintConfig(supabase: { from: (t: string) => any }): Promise<PrintConfig> {
  try {
    const { data } = await supabase.from("print_config").select("config").eq("id", 1).maybeSingle();
    return mergeConfig(data?.config);
  } catch {
    return DEFAULT_CONFIG;
  }
}
