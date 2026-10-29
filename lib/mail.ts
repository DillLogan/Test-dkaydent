/**
 * Sends one email through Resend (the same service the password reset uses).
 * Needs RESEND_API_KEY; MAIL_FROM sets the From address. Returns false when mail isn't set up or sending fails,
 * so callers can show the link to copy instead.
 */
export async function sendMail(m: { to: string; subject: string; html: string; text?: string; replyTo?: string | null }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? "DKaydent <no-reply@dkaydent.app>",
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const escHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
