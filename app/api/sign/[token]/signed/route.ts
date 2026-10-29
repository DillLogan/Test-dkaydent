import { NextResponse } from "next/server";
import { requestByToken, signedBytes, signerCheck } from "@/lib/signatures";

/** Public, link + signer gated: the signed PDF, with its certificate page. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await requestByToken(token);
  if (!r) return NextResponse.json({ error: "This link is invalid or has been withdrawn." }, { status: 404 });
  const c = await signerCheck(r, req.headers.get("x-signer-email"));
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  try {
    const bytes = await signedBytes(r);
    const name = (String(r.doc_name || "document").replace(/[^A-Za-z0-9 _.-]/g, "").trim() || "document") + " - signed.pdf";
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
