import { NextResponse } from "next/server";
import { readJson, staffOrError } from "@/lib/apiAuth";
import { BUCKET, cleanBoxes, service } from "@/lib/signatures";

type P = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { data } = await a.supabase.from("signature_docs").select("id, name, page_count, boxes, status").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ doc: { id: data.id, name: data.name, pageCount: data.page_count, boxes: data.boxes ?? [], status: data.status } });
}

/** Save the boxes (where people sign or type), the name, or the page count. */
export async function PATCH(req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const b = await readJson(req);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.boxes !== undefined) patch.boxes = cleanBoxes(b.boxes);
  if (typeof b.name === "string") patch.name = b.name.trim().slice(0, 200) || "Untitled document";
  if (b.pageCount !== undefined) patch.page_count = Math.max(0, Math.min(2000, Math.floor(Number(b.pageCount) || 0)));
  if (b.status === "ready" || b.status === "draft") patch.status = b.status;
  const { error } = await a.supabase.from("signature_docs").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { data } = await a.supabase.from("signature_docs").select("file_path").eq("id", id).maybeSingle();
  const { error } = await a.supabase.from("signature_docs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  // the original stays while sent requests still point at it; it is only removed when none do
  if (data?.file_path) {
    const { count } = await service().from("signature_requests").select("id", { count: "exact", head: true }).eq("source_path", data.file_path).eq("status", "sent");
    if (!count) await service().storage.from(BUCKET).remove([data.file_path]);
  }
  return NextResponse.json({ ok: true });
}
