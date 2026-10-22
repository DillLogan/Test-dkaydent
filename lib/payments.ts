import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider, TERMINAL_TIMEOUT_MS, type TerminalInfo, type TerminalResult } from "./valor/provider";
import { valorConnect } from "./valor/connect";

export const METHOD_LABEL: Record<string, string> = { card: "Card", cash: "Cash", check: "Check", other: "Other" };
export const TERMINAL_MODELS = ["VP550", "VP800", "VL100", "VL110", "VL500", "VL550", "Other"] as const;
export const MODEL_LABEL: Record<string, string> = {
  VP550: "VP550 (handheld POS)",
  VP800: "VP800 (countertop POS)",
  VL100: "VL100 (countertop)",
  VL110: "VL110 (countertop)",
  VL500: "VL500 (wireless)",
  VL550: "VL550 (wireless)",
  Other: "Other Valor device",
};

export type TerminalRequestRow = {
  id: string;
  terminal_id: string;
  provider: "simulator" | "valor";
  purpose: "invoice" | "deposit" | "counter";
  so_id: string;
  invoice_id: string | null;
  amount: number;
  tip_entry: boolean;
  req_txn_id: string;
  invoice_ref: string | null;
  status: string;
  provider_ref: string | null;
  message: string | null;
  payment_id: string | null;
  created_at: string;
  payment_terminals: TerminalInfo;
};

export async function loadRequest(supabase: SupabaseClient, id: string) {
  const { data } = await supabase
    .from("terminal_requests")
    .select("*, payment_terminals(id, name, epi, serial_no, model)")
    .eq("id", id)
    .maybeSingle();
  return data as TerminalRequestRow | null;
}

const providerFor = (r: TerminalRequestRow) => (r.provider === "valor" ? valorConnect : getProvider());

/** Apply a final result through the database (idempotent). */
export async function finalize(supabase: SupabaseClient, id: string, result: TerminalResult) {
  const { data, error } = await supabase.rpc("finalize_terminal_request", { p_id: id, p_result: result });
  if (error) throw new Error(error.message);
  return data as { status: string; message: string | null; payment_id: string | null };
}

/**
 * Move a pending request forward: ask the terminal for its outcome (live) and
 * time it out after 180s. Returns the request as it now stands.
 */
export async function advance(supabase: SupabaseClient, id: string) {
  const r = await loadRequest(supabase, id);
  if (!r || r.status !== "pending") return r;
  const age = Date.now() - Date.parse(r.created_at);
  const req = { reqTxnId: r.req_txn_id, amount: Number(r.amount), tipEntry: r.tip_entry, invoiceRef: r.invoice_ref ?? "", providerRef: r.provider_ref };
  const provider = providerFor(r);
  if (r.provider === "valor") {
    try {
      const res = await provider.getStatus(r.payment_terminals, req);
      if (res.status !== "pending") {
        await finalize(supabase, id, res);
        return loadRequest(supabase, id);
      }
    } catch (e: any) {
      if (age < TERMINAL_TIMEOUT_MS) return r; // network blip: keep waiting
      await finalize(supabase, id, { status: "error", message: String(e?.message ?? e).slice(0, 300) });
      return loadRequest(supabase, id);
    }
  }
  if (age > TERMINAL_TIMEOUT_MS + 5_000) {
    await provider.cancel(r.payment_terminals, req);
    await finalize(supabase, id, { status: "timeout", message: "No card presented within 3 minutes" });
    return loadRequest(supabase, id);
  }
  return r;
}
