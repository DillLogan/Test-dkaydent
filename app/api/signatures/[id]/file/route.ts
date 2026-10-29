import { NextResponse } from "next/server";
import { staffOrError } from "@/lib/apiAuth";
import { BUCKET, service } from "@/lib/signatures";

/** The prepared PDF's bytes, for the field editor. Staff only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const { data } = await a.supabase.from("signature_docs").select("file_path").eq("id", id).maybeSingle();
  if (!data?.file_path) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: file, error } = await service().storage.from(BUCKET).download(data.file_path);
  if (error || !file) return NextResponse.json({ error: "The PDF couldn't be found." }, { status: 404 });
  return new Response(await file.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
