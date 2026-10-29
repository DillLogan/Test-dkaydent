import { NextResponse } from "next/server";
import { requestByToken, signerCheck, sourceBytes } from "@/lib/signatures";

/** Public, link + signer gated: the original PDF to fill in. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await requestByToken(token);
  if (!r) return NextResponse.json({ error: "This link is invalid or has been withdrawn." }, { status: 404 });
  const c = await signerCheck(r, req.headers.get("x-signer-email"));
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  try {
    const bytes = await sourceBytes(r);
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
