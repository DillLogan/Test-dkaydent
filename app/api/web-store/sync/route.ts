import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { pullFromWebsite } from "@/lib/webstore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled full sync (vercel.json cron, or any scheduler): pulls inventory and
 * new orders from the website's URLs. Vercel sends "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET;
  if (!cron || req.headers.get("authorization") !== `Bearer ${cron}`) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 501 });
  const { data: cfg } = await db.rpc("web_store_config");
  if (!cfg?.enabled) return NextResponse.json({ skipped: "Web store connection is turned off" });
  try {
    return NextResponse.json({ results: await pullFromWebsite(db, "pull") });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
