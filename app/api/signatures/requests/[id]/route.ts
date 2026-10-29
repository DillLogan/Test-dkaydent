import { NextResponse } from "next/server";
import { staffOrError } from "@/lib/apiAuth";
import { BUCKET, service } from "@/lib/signatures";

type P = { params: Promise<{ id: string }> };

/** Download the signed copy (and mark it seen). Staff only. */
export async function GET(_req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { data } = await a.supabase.from("signature_requests").select("doc_name, completed_path").eq("id", id).maybeSingle();
  if (!data?.completed_path) return NextResponse.json({ error: "Not signed yet." }, { status: 404 });
  const { data: file, error } = await service().storage.from(BUCKET).download(data.completed_path);
  if (error || !file) return NextResponse.json({ error: "The signed copy couldn't be found." }, { status: 404 });
  await service().from("signature_requests").update({ opened: true }).eq("id", id);
  const name = (String(data.doc_name || "document").replace(/[^A-Za-z0-9 _.-]/g, "").trim() || "document") + " - signed.pdf";
  return new Response(await file.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}

/** Withdraw an unsigned request, or remove a signed one and its copy. Staff only. */
export async function DELETE(_req: Request, { params }: P) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { data } = await a.supabase.from("signature_requests").select("completed_path").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (data.completed_path) await service().storage.from(BUCKET).remove([data.completed_path]);
  const { error } = await service().from("signature_requests").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
