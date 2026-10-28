"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { bool, dbMessage, fail } from "@/lib/forms";
import { mergeConfig } from "@/lib/printConfig";

const PATH = "/settings/printouts";
const t = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function savePrintouts(fd: FormData) {
  const { supabase, user } = await requireRole("admin");
  const config = mergeConfig({
    header: { name: t(fd, "h_name"), address: t(fd, "h_address"), phone: t(fd, "h_phone"), footer: t(fd, "h_footer") },
    invoice: {
      showSku: bool(fd, "i_showSku"), showNotes: bool(fd, "i_showNotes"), showBarcode: bool(fd, "i_showBarcode"), showResale: bool(fd, "i_showResale"),
      terms: t(fd, "i_terms"), note: t(fd, "i_note"), customerTitle: t(fd, "i_customerTitle"), officeTitle: t(fd, "i_officeTitle"),
    },
    pull: { showSku: bool(fd, "p_showSku"), showLot: bool(fd, "p_showLot"), showNotes: bool(fd, "p_showNotes"), showBarcode: bool(fd, "p_showBarcode"), showLabelLine: bool(fd, "p_showLabelLine") },
    route: { showPhone: bool(fd, "r_showPhone"), showBoxes: bool(fd, "r_showBoxes") },
    labels: { showAddress: bool(fd, "l_showAddress"), showRoute: bool(fd, "l_showRoute") },
  });
  const { error } = await supabase.from("print_config").update({ config, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) fail(PATH, dbMessage(error));
  revalidatePath("/", "layout");
  redirect(`${PATH}?message=${encodeURIComponent("Printouts saved.")}`);
}
