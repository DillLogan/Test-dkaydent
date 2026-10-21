import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mapValorResponse } from "@/lib/valor/connect";

export const dynamic = "force-dynamic";

/**
 * Valor transaction notifications (stub).
 *
 * If Valor sends transaction results to a URL, point it here. Results for
 * payments the app started (matched by REQ_TXN_ID) are applied right away,
 * so a charge completes even if nobody has the page open.
 *
 * UNCONFIRMED: Valor's notification format and signing. Until Valor confirms
 * them, requests must carry the shared secret in the "x-webhook-secret" header.
 * Needs VALOR_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY.
 * Sales rung up on the terminal alone come in through Payments → Sync terminal sales.
 */
export async function POST(req: Request) {
  const secret = process.env.VALOR_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey) return NextResponse.json({ error: "Webhook not configured" }, { status: 501 });
  if (req.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const reqTxnId = body?.REQ_TXN_ID ?? body?.req_txn_id;
  if (!reqTxnId) return NextResponse.json({ ignored: "No REQ_TXN_ID; sync terminal-only sales from the portal export" }, { status: 202 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  const { data: r } = await db.from("terminal_requests").select("id, status").eq("req_txn_id", String(reqTxnId)).maybeSingle();
  if (!r) return NextResponse.json({ ignored: "Unknown REQ_TXN_ID" }, { status: 202 });
  const result = mapValorResponse(body);
  if (result.status === "pending") return NextResponse.json({ ok: true, status: "pending" });
  const { data, error } = await db.rpc("finalize_terminal_request", { p_id: r.id, p_result: result });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}
