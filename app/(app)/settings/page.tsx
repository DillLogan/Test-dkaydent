import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { PrintSettingsForm } from "@/components/PrintSettingsForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
import { changePassword, setCardFee } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { HINT_MAX } from "@/lib/passwordHint";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error, message } = await searchParams;
  const { profile } = await getSession();
  const isCustomer = profile.role === "customer";
  let hint = "";
  let cardFee = 0;
  if (profile.role === "admin") {
    const supabase = await createClient();
    const { data } = await supabase.from("app_settings").select("card_fee_pct").maybeSingle();
    cardFee = Number(data?.card_fee_pct ?? 0);
  }
  if (isCustomer) {
    const supabase = await createClient();
    const { data } = await supabase.from("password_hints").select("hint").eq("profile_id", profile.id).maybeSingle();
    hint = data?.hint ?? "";
  }
  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences for this browser" />
      <ErrorBanner error={error} />
      <Notice message={message} />
      <Section title="Password">
        <form action={changePassword} className="card grid max-w-xl gap-3 sm:grid-cols-3" data-testid="change-password">
          <label>
            <span className="label">Current password</span>
            <input name="current" type="password" className="input" required autoComplete="current-password" />
          </label>
          <label>
            <span className="label">New password</span>
            <input name="next" type="password" className="input" required={!isCustomer} minLength={8} autoComplete="new-password" />
          </label>
          <label>
            <span className="label">Type it again</span>
            <input name="again" type="password" className="input" required={!isCustomer} minLength={8} autoComplete="new-password" />
          </label>
          {isCustomer && (
            <label className="sm:col-span-3">
              <span className="label">Password hint (optional)</span>
              <input name="hint" className="input" maxLength={HINT_MAX} defaultValue={hint} placeholder="Something only you would understand" data-testid="password-hint" />
              <span className="mt-1 block text-xs text-stone-500">
                Shown on the sign-in page to anyone who types your username, so never put your password in it. To change only the hint, enter your
                current password and leave the new password blank. Clear it to remove it.
              </span>
            </label>
          )}
          <div className="sm:col-span-3">
            <SubmitButton>{isCustomer ? "Save" : "Change password"}</SubmitButton>
          </div>
        </form>
      </Section>
      {profile.role !== "customer" && (<>
      <Section title="Help">
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-stone-500">Step-by-step tutorials for the main jobs, and a searchable knowledge base.</p>
          <div className="flex gap-2">
            <Link href="/settings/tutorials" className="btn">
              Tutorials
            </Link>
            <Link href="/settings/knowledge-base" className="btn">
              Knowledge base
            </Link>
          </div>
        </div>
      </Section>
      {can(profile) && (
        <Section title="Web store">
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-500">Bring stock counts and web orders in from your ordering website.</p>
            <Link href="/settings/web-store" className="btn">
              Set up web store
            </Link>
          </div>
        </Section>
      )}
      {profile.role === "admin" && (
        <Section title="Card processing fee">
          <form action={setCardFee} className="card flex flex-wrap items-end gap-3" data-testid="card-fee-form">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Fee on card orders (%)</span>
              <input name="card_fee_pct" type="number" min="0" max="10" step="0.01" defaultValue={cardFee} className="input w-28" required />
            </label>
            <SubmitButton>Save</SubmitButton>
            <p className="basis-full text-sm text-stone-500">
              Added to orders paid by card, on the subtotal plus tax, as its own line on the invoice. Cash and check orders don&apos;t get it. 0 turns it off. Invoices
              already made keep the rate they were made with.
            </p>
          </form>
        </Section>
      )}
      {profile.role === "admin" && (
        <Section title="Printouts">
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-500">Company header, invoice wording, and what shows on pull sheets, route sheets and box labels.</p>
            <Link href="/settings/printouts" className="btn">
              Customize printouts
            </Link>
          </div>
        </Section>
      )}
      <Section title="Printing">
        <p className="mb-3 text-sm text-stone-500">
          How labels print from this computer. Use Label printer for a thermal or roll label printer, and Regular printer for an office or home
          printer on plain paper. Saved on this computer only, so each workstation can use its own printer.
        </p>
        <PrintSettingsForm />
      </Section>
      </>)}
    </>
  );
}
