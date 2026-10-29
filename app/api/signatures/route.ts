import { NextResponse } from "next/server";
import { staffOrError } from "@/lib/apiAuth";
import { BUCKET, MAX_PDF_BYTES, service } from "@/lib/signatures";

/** Documents prepared for signing: list, and add one by uploading a PDF. Staff only. */
export async function GET() {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { data, error } = await a.supabase.from("signature_docs").select("id, name, page_count, status, created_at, boxes").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Couldn't load documents." }, { status: 500 });
  return NextResponse.json({
    docs: (data ?? []).map((d) => ({ id: d.id, name: d.name, pageCount: d.page_count, status: d.status, createdAt: d.created_at, fields: Array.isArray(d.boxes) ? d.boxes.length : 0 })),
  });
}

export async function POST(req: Request) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF." }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "That PDF is over 10 MB. Use a smaller or compressed PDF." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return NextResponse.json({ error: "That file isn't a PDF." }, { status: 400 });
  const name = String(fd?.get("name") ?? file.name).replace(/\.pdf$/i, "").trim().slice(0, 200) || "Untitled document";
  const { data: doc, error } = await a.supabase.from("signature_docs").insert({ name, owner_id: a.profile.id }).select("id, name").single();
  if (error || !doc) return NextResponse.json({ error: "Couldn't add the document." }, { status: 500 });
  const path = `docs/${doc.id}.pdf`;
  const up = await service().storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) {
    await a.supabase.from("signature_docs").delete().eq("id", doc.id);
    return NextResponse.json({ error: "Couldn't store the PDF." }, { status: 500 });
  }
  await a.supabase.from("signature_docs").update({ file_path: path }).eq("id", doc.id);
  return NextResponse.json({ doc: { id: doc.id, name: doc.name } });
}
