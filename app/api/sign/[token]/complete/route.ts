import { NextResponse } from "next/server";
import { readJson } from "@/lib/apiAuth";
import { escHtml, sendMail } from "@/lib/mail";
import { complete, requestByToken, signerCheck } from "@/lib/signatures";

/** Public, link + signer gated. The IP and device are read here on the server, not reported by the page. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await requestByToken(token);
  if (!r) return NextResponse.json({ error: "This link is invalid or has been withdrawn." }, { status: 404 });
  const c = await signerCheck(r, req.headers.get("x-signer-email"));
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  const b = await readJson(req);
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  const values = b.values && typeof b.values === "object" ? (b.values as Record<string, string>) : {};
  const missing = r.boxes.filter((x) => (x.type === "signature" || x.type === "initials") && !values[x.id]);
  if (missing.length) return NextResponse.json({ error: `Fill every signature and initials box (${missing.length} left).` }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  try {
    const done = await complete(r, values, { name, ip, userAgent: req.headers.get("user-agent") ?? "", via: c.via, signerId: c.signerId });
    // let the sender know at their account email
    if (r.sender_email && done.status === "completed" && r.status !== "completed") {
      await sendMail({
        to: r.sender_email,
        subject: `Signed: ${r.doc_name}`,
        html: `<p><b>${escHtml(name)}</b> (${escHtml(r.recipient_email)}) signed <b>${escHtml(r.doc_name)}</b>. The signed copy is under Documents → Sent.</p>`,
      });
    }
    return NextResponse.json({ ok: true, status: done.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Couldn't finish signing." }, { status: 500 });
  }
}
