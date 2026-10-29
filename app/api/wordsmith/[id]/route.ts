import { NextResponse } from "next/server";
import { readJson, staffOrError } from "@/lib/apiAuth";
import { BadInput, cleanDoc, LIST_COLS } from "@/lib/wordsmith";

type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { data } = await a.supabase.from("wordsmith_docs").select("*").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ doc: data });
}

/** Saves only if nobody saved since `base` (the updated_at the editor loaded); 409 otherwise. */
export async function PUT(req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const b = await readJson(req);
  let patch: Record<string, unknown>;
  try {
    patch = { ...cleanDoc(b, true), updated_at: new Date().toISOString() };
  } catch (e) {
    return NextResponse.json({ error: e instanceof BadInput ? e.message : "Couldn't save." }, { status: 400 });
  }
  let q = a.supabase.from("wordsmith_docs").update(patch).eq("id", id);
  if (typeof b.base === "string") q = q.eq("updated_at", b.base);
  const { data, error } = await q.select(LIST_COLS);
  if (error) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  if (data?.length) return NextResponse.json({ doc: data[0] });
  const { data: exists } = await a.supabase.from("wordsmith_docs").select("id").eq("id", id).maybeSingle();
  if (!exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ error: "This document was changed in another window. Reload it to keep working." }, { status: 409 });
}

export async function DELETE(_req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { error } = await a.supabase.from("wordsmith_docs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
