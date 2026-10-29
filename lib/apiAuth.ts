import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/roles";

/** For API routes: the signed-in staff member (any role but customer), or a JSON error response. */
export async function staffOrError(): Promise<
  { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; profile: Profile } | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile || !profile.active || profile.role === "customer") return { ok: false, res: NextResponse.json({ error: "Not allowed." }, { status: 403 }) };
  return { ok: true, supabase, profile: profile as Profile };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
