import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { advance } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Status of a terminal payment; polled by the charge panel. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const r = await advance(supabase, id);
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ status: r.status, message: r.message, payment_id: r.payment_id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
