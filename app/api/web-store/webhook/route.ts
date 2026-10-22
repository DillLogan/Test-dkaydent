import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applyInventory, applyOrders, mapInventory, mapOrders, verifySignature, withDefaults } from "@/lib/webstore";

export const dynamic = "force-dynamic";

/**
 * The web store posts updates here as they happen:
 *   POST /api/web-store/webhook?type=inventory   (stock counts)
 *   POST /api/web-store/webhook?type=order       (a new, changed or cancelled order)
 * The body is the website's own JSON; Settings → Web store maps its fields.
 * Signed with the webhook secret: "X-Signature: sha256=<hex HMAC-SHA256 of the raw body>".
 * Needs SUPABASE_SERVICE_ROLE_KEY. WEBSTORE_WEBHOOK_SECRET, if set, overrides the secret saved in Settings.
 */
export async function POST(req: Request) {
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "Web store webhook isn't configured (SUPABASE_SERVICE_ROLE_KEY missing)" }, { status: 501 });
  const { data: cfg, error } = await db.rpc("web_store_config");
  if (error || !cfg) return NextResponse.json({ error: "Web store isn't set up" }, { status: 501 });
  if (!cfg.enabled) return NextResponse.json({ error: "Web store connection is turned off" }, { status: 503 });
  const secret = process.env.WEBSTORE_WEBHOOK_SECRET || cfg.webhook_secret;
  if (!secret) return NextResponse.json({ error: "Set a webhook secret in Settings → Web store" }, { status: 501 });

  const raw = await req.text();
  const sig = req.headers.get("x-signature") || req.headers.get("x-webhook-signature") || req.headers.get("x-hub-signature-256");
  if (!verifySignature(raw, sig, secret)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const type = (new URL(req.url).searchParams.get("type") || req.headers.get("x-event-type") || "").toLowerCase();
  const m = withDefaults(cfg.field_map);

  if (type.startsWith("inventory") || type.startsWith("stock")) {
    const { rows, problems } = mapInventory(body, m);
    if (!rows.length) return NextResponse.json({ error: problems[0] || "No items" }, { status: 422 });
    const r = await applyInventory(db, rows, "webhook");
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  if (type.startsWith("order")) {
    const { orders, problems } = mapOrders(body, m);
    if (!orders.length) return NextResponse.json({ error: problems[0] || "No orders" }, { status: 422 });
    const r = await applyOrders(db, orders, "webhook");
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  return NextResponse.json({ error: 'Add ?type=inventory or ?type=order to the webhook URL' }, { status: 400 });
}
