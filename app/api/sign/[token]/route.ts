import { NextResponse } from "next/server";
import { requestByToken, signerCheck } from "@/lib/signatures";

/**
 * Public, link-gated. Before the signer is checked it reveals only the document name, who sent it and what's needed
 * (sign in, or type the email). After the check it returns the fields to fill.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await requestByToken(token);
  if (!r) return NextResponse.json({ error: "This link is invalid or has been withdrawn." }, { status: 404 });
  const base = { docName: r.doc_name, status: r.status, sender: r.sender_name || r.sender_email || "DKaydent Wholesale" };
  const c = await signerCheck(r, req.headers.get("x-signer-email"));
  if (!c.ok) {
    if (c.needsLogin || c.needsEmail) return NextResponse.json({ ...base, needsLogin: !!c.needsLogin, needsEmail: !!c.needsEmail, message: c.error });
    return NextResponse.json({ ...base, error: c.error }, { status: c.status });
  }
  return NextResponse.json({ ...base, via: c.via, boxes: r.status === "completed" ? [] : r.boxes });
}
