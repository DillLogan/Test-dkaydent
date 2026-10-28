"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { loginEmail } from "@/lib/username";
import { str } from "@/lib/forms";

const SAME = "If that username has a login, a reset link was sent, or your sales rep has been asked to approve a reset. Check back with them if you hear nothing.";

/** Always answers the same way, so it cannot be used to find out which usernames exist. */
export async function requestReset(fd: FormData) {
  const typed = str(fd, "username");
  const admin = createServiceClient();
  if (typed && admin) {
    const email = loginEmail(typed);
    const { data: prof } = await admin.from("profiles").select("id, role, active").eq("email", email).maybeSingle();
    if (prof?.role === "customer" && prof.active) {
      const { data: acct } = await admin.from("portal_accounts").select("customer_id").eq("profile_id", prof.id).maybeSingle();
      const { data: cust } = acct
        ? await admin.from("customers").select("id, rep_id, email").eq("id", acct.customer_id).maybeSingle()
        : { data: null };
      const site = process.env.NEXT_PUBLIC_SITE_URL;
      const mailKey = process.env.RESEND_API_KEY;
      let sent = false;
      if (cust?.email && site && mailKey) {
        const { data: link } = await admin.auth.admin.generateLink({ type: "recovery", email });
        const hash = link?.properties?.hashed_token;
        if (hash) {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${mailKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: process.env.MAIL_FROM ?? "DKaydent <no-reply@dkaydent.app>",
              to: cust.email,
              subject: "Reset your DKaydent password",
              text: `Use this link to choose a new password (it expires in an hour):\n${site}/login/reset?token_hash=${hash}\n\nIf you didn't ask for this, ignore this email.`,
            }),
          });
          sent = res.ok;
        }
      }
      if (!sent) {
        const { data: open } = await admin.from("password_requests").select("id").eq("profile_id", prof.id).eq("status", "pending").limit(1);
        if (!open?.length) {
          await admin.from("password_requests").insert({ profile_id: prof.id, customer_id: cust?.id ?? null, rep_id: cust?.rep_id ?? null });
        }
      }
    }
  }
  redirect(`/login?message=${encodeURIComponent(SAME)}`);
}
