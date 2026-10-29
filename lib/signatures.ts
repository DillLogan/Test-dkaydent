import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

/**
 * PDF signing (ported from the BrightStar CRM handoff).
 * Staff prepare a PDF (signature / initials / text / checkbox boxes) and send it to an email.
 * The request records the sender's account email (used as reply-to).
 * Signing: if the recipient email belongs to a DKaydent login, they must be signed in as that login;
 * otherwise they confirm the email on the link. The server stamps the values into the PDF and adds a certificate page.
 */
export const BUCKET = "signature-docs";
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type Box = { id: string; page: number; x: number; y: number; w: number; h: number; type: "signature" | "initials" | "text" | "checkbox"; label?: string; fill?: boolean; underline?: boolean };
export type RequestRow = {
  id: string;
  doc_id: string | null;
  doc_name: string;
  token: string;
  recipient_email: string;
  boxes: Box[];
  source_path: string | null;
  values: Record<string, string>;
  completed_path: string | null;
  status: "sent" | "completed";
  opened: boolean;
  sender_id: string | null;
  sender_email: string | null;
  sender_name: string | null;
  signer_id: string | null;
  audit: Record<string, string>;
  sent_at: string;
  completed_at: string | null;
};

const TYPES = new Set(["signature", "initials", "text", "checkbox"]);
const num01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));

/** Keep only well-formed boxes (fractions of the page), at most 200. */
export function cleanBoxes(raw: unknown): Box[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).flatMap((b): Box[] => {
    if (!b || typeof b !== "object") return [];
    const o = b as Record<string, unknown>;
    const type = String(o.type);
    if (!TYPES.has(type)) return [];
    return [
      {
        id: String(o.id ?? crypto.randomUUID()).slice(0, 40),
        page: Math.max(1, Math.min(500, Math.floor(Number(o.page) || 1))),
        x: num01(o.x),
        y: num01(o.y),
        w: Math.max(0.01, num01(o.w)),
        h: Math.max(0.01, num01(o.h)),
        type: type as Box["type"],
        label: String(o.label ?? "").slice(0, 40),
        fill: !!o.fill,
        underline: !!o.underline,
      },
    ];
  });
}

export function service() {
  const s = createServiceClient();
  if (!s) throw new Error("Document signing needs SUPABASE_SERVICE_ROLE_KEY on the server.");
  return s;
}

export const newToken = () => crypto.randomBytes(24).toString("base64url");
export const sameEmail = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The request behind a public signing link, or null. */
export async function requestByToken(token: string): Promise<RequestRow | null> {
  if (!token || token.length > 100) return null;
  const { data } = await service().from("signature_requests").select("*").eq("token", token).maybeSingle();
  return (data as RequestRow) ?? null;
}

/**
 * Who may sign this request right now.
 *  - recipient email belongs to an active DKaydent login → only when signed in as that login ("account").
 *  - otherwise → the signer must type the same email ("email").
 */
export async function signerCheck(r: RequestRow, typedEmail: string | null): Promise<
  { ok: true; via: "account" | "email"; signerId: string | null } | { ok: false; status: number; error: string; needsLogin?: boolean; needsEmail?: boolean }
> {
  const svc = service();
  const { data: owner } = await svc.from("profiles").select("id, active").eq("email", r.recipient_email.trim().toLowerCase()).maybeSingle();
  if (owner && owner.active) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, status: 401, needsLogin: true, error: "This document was sent to your DKaydent account. Sign in to open it." };
    if (!sameEmail(user.email, r.recipient_email)) {
      return { ok: false, status: 403, error: "This document was sent to a different account. Sign in with the account it was sent to." };
    }
    return { ok: true, via: "account", signerId: user.id };
  }
  if (!typedEmail) return { ok: false, status: 401, needsEmail: true, error: "Enter the email address this document was sent to." };
  if (!sameEmail(typedEmail, r.recipient_email)) return { ok: false, status: 403, error: "That email doesn't match the address this document was sent to." };
  return { ok: true, via: "email", signerId: null };
}

async function download(path: string) {
  const { data, error } = await service().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("The document file couldn't be found.");
  return new Uint8Array(await data.arrayBuffer());
}
export const sourceBytes = (r: RequestRow) => (r.source_path ? download(r.source_path) : Promise.reject(new Error("This request has no document attached.")));
export const signedBytes = (r: RequestRow) => (r.completed_path ? download(r.completed_path) : Promise.reject(new Error("This document hasn't been signed yet.")));

async function flatten(src: Uint8Array, boxes: Box[], values: Record<string, string>) {
  const pdf = await PDFDocument.load(src);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const obliq = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pages = pdf.getPages();
  for (const b of boxes) {
    const val = values[b.id];
    if (!val) continue;
    const page = pages[(b.page || 1) - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const bx = b.x * pw;
    const bw = b.w * pw;
    const bh = b.h * ph;
    const yBottom = ph - b.y * ph - bh;
    if (val.startsWith("data:image/png")) {
      try {
        const png = await pdf.embedPng(val);
        const ar = png.width / png.height;
        let w = bw;
        let h = w / ar;
        if (h > bh) {
          h = bh;
          w = h * ar;
        }
        page.drawImage(png, { x: bx + (bw - w) / 2, y: yBottom + (bh - h) / 2, width: w, height: h });
      } catch {
        /* an unreadable drawing is skipped */
      }
    } else {
      const size = Math.min(Math.max(bh * 0.55, 8), 20);
      const font = b.type === "signature" || b.type === "initials" ? obliq : helv;
      const safe = val.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "?").slice(0, 300);
      page.drawText(safe, { x: bx + 3, y: yBottom + (bh - size) / 2 + size * 0.15, size, font, color: rgb(0.1, 0.1, 0.16) });
    }
  }
  return pdf;
}

async function certificate(pdf: PDFDocument, info: Record<string, string>) {
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const safe = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "?");
  let y = 740;
  page.drawText("Signing certificate", { x: 54, y, size: 20, font: bold, color: rgb(0.15, 0.37, 0.22) });
  y -= 34;
  const rows: [string, string][] = [
    ["Document", info.docName],
    ["Signer name (as entered)", info.name],
    ["Signer email", info.email],
    ["How the signer was checked", info.via === "account" ? "Signed in to their DKaydent account with this email" : "Typed the email this document was sent to"],
    ["Sent by", [info.senderName, info.senderEmail].filter(Boolean).join(" - ")],
    ["IP address", info.ip],
    ["Device / browser", info.userAgent],
    ["Signed at (UTC)", info.signedAt],
    ["Request ID", info.requestId],
  ];
  for (const [label, value] of rows) {
    page.drawText(safe(label), { x: 54, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.4) });
    y -= 15;
    const text = safe(value) || "-";
    for (let i = 0; i < text.length; i += 88) {
      page.drawText(text.slice(i, i + 88), { x: 54, y, size: 11, font: helv, color: rgb(0.1, 0.1, 0.16) });
      y -= 15;
    }
    y -= 9;
  }
}

/** Fill, flatten, add the certificate, store the signed copy and mark the request complete. */
export async function complete(r: RequestRow, values: Record<string, string>, audit: { name: string; ip: string; userAgent: string; via: "account" | "email"; signerId: string | null }) {
  if (r.status === "completed") return r;
  // only values for this request's boxes, and sensible sizes (a drawn signature is a PNG data URL)
  const clean: Record<string, string> = {};
  for (const b of r.boxes) {
    const v = values?.[b.id];
    if (typeof v !== "string" || !v) continue;
    if (v.startsWith("data:image/png;base64,") ? v.length > 400_000 : v.length > 300) continue;
    clean[b.id] = v;
  }
  const signedAt = new Date().toISOString();
  const pdf = await flatten(await sourceBytes(r), r.boxes, clean);
  const full = {
    name: audit.name.trim().slice(0, 120),
    email: r.recipient_email,
    via: audit.via,
    ip: audit.ip.slice(0, 100),
    userAgent: audit.userAgent.slice(0, 400),
    signedAt,
  };
  await certificate(pdf, { ...full, docName: r.doc_name, requestId: r.id, senderName: r.sender_name ?? "", senderEmail: r.sender_email ?? "" });
  const bytes = await pdf.save();
  const path = `completed/${r.id}.pdf`;
  const svc = service();
  const up = await svc.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error("Couldn't save the signed copy.");
  const { data, error } = await svc
    .from("signature_requests")
    .update({ values: clean, completed_path: path, status: "completed", completed_at: signedAt, audit: full, signer_id: audit.signerId })
    .eq("id", r.id)
    .eq("status", "sent")
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Couldn't finish signing.");
  return (data as RequestRow) ?? r;
}
