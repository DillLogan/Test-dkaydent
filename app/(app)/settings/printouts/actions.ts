"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail } from "@/lib/forms";
import { loadPrintConfig, mergeConfig } from "@/lib/printConfig";
import { cleanTemplate } from "@/lib/pdfdocs/defaults";
import type { DocType, Template } from "@/lib/pdfdocs/types";

const PATH = "/settings/printouts";
const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function savePrintouts(fd: FormData) {
  const { supabase, user } = await requireRole("admin");
  // what shows on each printout is now set in the layout designer; keep the old switches as they were
  const cur = await loadPrintConfig(supabase);
  const config = mergeConfig({
    ...cur,
    header: { name: t(fd, "h_name"), address: t(fd, "h_address"), phone: t(fd, "h_phone"), footer: t(fd, "h_footer") },
    invoice: { ...cur.invoice, terms: t(fd, "i_terms"), note: t(fd, "i_note"), customerTitle: t(fd, "i_customerTitle"), officeTitle: t(fd, "i_officeTitle") },
  });
  const { error } = await supabase.from("print_config").update({ config, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath("/", "layout");
  redirect(`${PATH}?message=${encodeURIComponent("Company details saved.")}`);
}

const DOC_TYPES: DocType[] = ["pull", "invoice", "route", "label", "boxlabel"];

/** Save one printout's PDF layout (checked, so a broken layout can't be stored). */
export async function savePdfTemplate(doc: DocType, layout: Template): Promise<{ error?: string }> {
  const { supabase } = await requireRole("admin");
  if (!DOC_TYPES.includes(doc)) return { error: "Unknown printout." };
  const clean = cleanTemplate(doc, layout);
  const size = JSON.stringify(clean).length;
  if (size > 850_000) return { error: "The layout is too large. Use a smaller logo picture." };
  const { error } = await supabase.from("pdf_templates").upsert({ doc, layout: clean, updated_at: new Date().toISOString() });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/", "layout");
  return {};
}

/** Back to the built-in layout. */
export async function resetPdfTemplate(doc: DocType): Promise<{ error?: string }> {
  const { supabase } = await requireRole("admin");
  const { error } = await supabase.from("pdf_templates").delete().eq("doc", doc);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/", "layout");
  return {};
}
