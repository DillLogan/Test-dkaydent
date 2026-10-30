import { loadPrintConfig, type PrintConfig } from "@/lib/printConfig";
import { cleanTemplate, defaultTemplate } from "./defaults";
import type { DocType, Template } from "./types";

const legacy = (pc: PrintConfig) => ({ invoice: pc.invoice, pull: pc.pull, route: pc.route, labels: pc.labels });

/** The layouts to print with (saved, else built in) and the company details. */
export async function loadPrintouts(supabase: { from: (t: string) => any }, docs: DocType[]) {
  const pc = await loadPrintConfig(supabase);
  let rows: { doc: DocType; layout: unknown }[] = [];
  try {
    const { data } = await supabase.from("pdf_templates").select("doc, layout").in("doc", docs);
    rows = data ?? [];
  } catch {}
  const templates = Object.fromEntries(docs.map((d) => [d, cleanTemplate(d, rows.find((r) => r.doc === d)?.layout, legacy(pc))])) as Record<DocType, Template>;
  const defaults = Object.fromEntries(docs.map((d) => [d, defaultTemplate(d, legacy(pc))])) as Record<DocType, Template>;
  const business = { name: pc.header.name, address: pc.header.address, phone: pc.header.phone, footer: pc.header.footer };
  return { pc, templates, defaults, business };
}
