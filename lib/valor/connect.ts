import type { SaleRequest, TerminalInfo, TerminalProvider, TerminalResult } from "./provider";

/**
 * Valor Connect (cloud → terminal) adapter.
 *
 * Coded from Valor's public POS integration docs (ValorPay POS Integration
 * v1.1.9 and valorapi.readme.io). Confirmed fields:
 *   TRAN_MODE "1" + TRAN_CODE "1" = credit sale, AMOUNT in cents, TIP_ENTRY,
 *   INVOICENUMBER (≤ 32 chars), EPI, REQ_TXN_ID, and a STAN number on the
 *   acknowledgment that is used to poll for the result.
 *
 * NOT in the public docs — get these from Valor when they give you
 * developer access, then check every line marked UNCONFIRMED:
 *   - the cloud endpoint URL (VALOR_CONNECT_URL)
 *   - how APP ID / APP KEY are sent (headers below are a best guess)
 *   - the exact status-poll and cancel request shapes
 *   - response field names for approval, card brand, last 4 and auth code
 */

const TIMEOUT = 20_000;

function headers() {
  return {
    "Content-Type": "application/json",
    // UNCONFIRMED: header names for credentials
    "X-APP-ID": process.env.VALOR_APP_ID ?? "",
    "X-APP-KEY": process.env.VALOR_APP_KEY ?? "",
  };
}

async function post(path: string, body: Record<string, unknown>) {
  const url = new URL(path, process.env.VALOR_CONNECT_URL).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`Valor Connect ${res.status}: ${json?.message ?? json?.MSG ?? text.slice(0, 200)}`);
  return json;
}

const cents = (dollars: number) => String(Math.round(dollars * 100));

/** Map a Valor response to our result. UNCONFIRMED field names; several spellings are accepted. */
export function mapValorResponse(json: any): TerminalResult {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (json?.[k] !== undefined && json?.[k] !== null && json?.[k] !== "") return String(json[k]);
    return undefined;
  };
  const code = (pick("RESPONSE_CODE", "HOST_RESPONSE_CODE", "error_no", "STATUS") ?? "").toUpperCase();
  const text = pick("RESPONSE_MESSAGE", "HOST_RESPONSE_MESSAGE", "MSG", "message", "mesg") ?? "";
  const pending = /PENDING|WAIT|PROCESS/i.test(code) || /waiting|in progress/i.test(text);
  if (pending) return { status: "pending", message: text || "Waiting for card" };
  const approved = code === "00" || code === "S00" || /APPROV/i.test(code) || /approved/i.test(text);
  const cancelled = /CANCEL/i.test(code) || /cancel/i.test(text);
  const timeout = /TIMEOUT/i.test(code) || /time ?out/i.test(text);
  const last4 = pick("MASKED_CARD_NUMBER", "MASKED_PAN", "CARD_NO", "LAST4")?.replace(/\D/g, "").slice(-4);
  const tipCents = pick("TIP_AMOUNT", "TIP");
  return {
    status: approved ? "approved" : cancelled ? "cancelled" : timeout ? "timeout" : "declined",
    message: text || (approved ? "Approved" : "Declined"),
    card_brand: pick("CARD_TYPE", "CARD_BRAND", "CARD_SCHEME"),
    card_last4: last4 && last4.length === 4 ? last4 : undefined,
    auth_code: pick("APPROVAL_CODE", "AUTH_CODE", "AUTHCODE"),
    txn_id: pick("RRN", "TXN_ID", "TRANSACTION_ID", "REFERENCE_NUMBER"),
    tip: tipCents ? Number(tipCents) / 100 : undefined,
    provider_ref: pick("STAN_NO", "STAN"),
    raw: json,
  };
}

export const valorConnect: TerminalProvider = {
  name: "valor",

  async startSale(t: TerminalInfo, r: SaleRequest) {
    const ack = await post("sale", {
      // Confirmed fields (public docs)
      EPI: t.epi,
      TRAN_MODE: "1",
      TRAN_CODE: "1",
      AMOUNT: cents(r.amount),
      TIP_ENTRY: r.tipEntry ? "1" : "0",
      INVOICENUMBER: r.invoiceRef.slice(0, 32),
      REQ_TXN_ID: r.reqTxnId,
      ...(t.serial_no ? { SERIAL_NO: t.serial_no } : {}),
    });
    // The acknowledgment carries a STAN used to poll for the outcome; the card result comes later.
    const stan = ack?.STAN_NO ?? ack?.STAN;
    if (!ack?.RESPONSE_CODE && !ack?.HOST_RESPONSE_CODE) return { status: "pending", providerRef: stan, message: "Sent to terminal" };
    const res = mapValorResponse(ack);
    return res.status === "pending" ? { ...res, providerRef: stan } : res;
  },

  async getStatus(t, r) {
    // UNCONFIRMED: poll path and body
    const json = await post("status", { EPI: t.epi, REQ_TXN_ID: r.reqTxnId, ...(r.providerRef ? { STAN_NO: r.providerRef } : {}) });
    return mapValorResponse(json);
  },

  async cancel(t, r) {
    // UNCONFIRMED: cancel path and body
    await post("cancel", { EPI: t.epi, REQ_TXN_ID: r.reqTxnId }).catch(() => {});
  },
};
