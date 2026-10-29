import { NextResponse } from "next/server";
import { staffOrError } from "@/lib/apiAuth";

/** Every document sent for signing, newest first. Staff only. */
export async function GET() {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { data, error } = await a.supabase
    .from("signature_requests")
    .select("id, doc_name, recipient_email, status, opened, sent_at, completed_at, sender_name, sender_email, audit")
    .order("sent_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: "Couldn't load sent documents." }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}
