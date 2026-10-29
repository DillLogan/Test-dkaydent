import { NextResponse } from "next/server";
import { readJson, staffOrError } from "@/lib/apiAuth";
import { escHtml, sendMail } from "@/lib/mail";
import { cleanBoxes, newToken, service } from "@/lib/signatures";

/**
 * Send a prepared document to one email. The request records who sent it (their account email is the reply-to).
 * Returns the signing link, and whether the email went out (when mail isn't set up, copy the link instead).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await staffOrError();
  if (!a.ok) return a.res;
  const { id } = await params;
  const b = await readJson(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  const { data: doc } = await a.supabase.from("signature_docs").select("id, name, boxes, file_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const boxes = cleanBoxes(doc.boxes);
  if (!boxes.length) return NextResponse.json({ error: "Add at least one field before sending." }, { status: 400 });
  if (!doc.file_path) return NextResponse.json({ error: "This document has no PDF." }, { status: 400 });
  const token = newToken();
  const senderEmail = a.profile.email ?? null;
  const senderName = a.profile.full_name ?? null;
  const { error } = await service()
    .from("signature_requests")
    .insert({ doc_id: doc.id, doc_name: doc.name, token, recipient_email: email, boxes, source_path: doc.file_path, sender_id: a.profile.id, sender_email: senderEmail, sender_name: senderName });
  if (error) return NextResponse.json({ error: "Couldn't create the request." }, { status: 500 });
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const link = `${origin}/sign/${token}`;
  const { data: hasLogin } = await service().from("profiles").select("id").eq("email", email).eq("active", true).maybeSingle();
  const from = [senderName, senderEmail].filter(Boolean).join(" · ") || "DKaydent Wholesale";
  const mailed = await sendMail({
    to: email,
    replyTo: senderEmail,
    subject: `Please review and sign: ${doc.name}`,
    html: `<p>${escHtml(from)} has asked you to review and sign <b>${escHtml(doc.name)}</b>.</p>
<p><a href="${link}">Open the document to sign</a></p>
<p>${hasLogin ? "You'll be asked to sign in to your DKaydent account first." : "You'll be asked for this email address to open it."}</p>
<p>Or paste this link into your browser:<br>${link}</p><p>Questions? Reply to this email to reach ${escHtml(senderName || senderEmail || "the sender")}.</p>`,
  });
  return NextResponse.json({ ok: true, link, mailed, needsLogin: !!hasLogin });
}
