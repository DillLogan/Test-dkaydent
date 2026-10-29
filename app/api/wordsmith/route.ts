import { NextResponse } from "next/server";
import { readJson, staffOrError } from "@/lib/apiAuth";
import { BadInput, cleanDoc, LIST_COLS } from "@/lib/wordsmith";

/** My documents: list, and create one. Staff only; each person sees only their own. */
export async function GET() {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { data, error } = await a.supabase.from("wordsmith_docs").select(LIST_COLS).eq("owner_id", a.profile.id).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Couldn't load your documents." }, { status: 500 });
  return NextResponse.json({ docs: data ?? [] });
}

export async function POST(req: Request) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  try {
    const row = { ...cleanDoc(await readJson(req), false), owner_id: a.profile.id };
    const { data, error } = await a.supabase.from("wordsmith_docs").insert(row).select("*").single();
    if (error) return NextResponse.json({ error: "Couldn't create the document." }, { status: 500 });
    return NextResponse.json({ doc: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof BadInput ? e.message : "Couldn't create the document." }, { status: 400 });
  }
}
