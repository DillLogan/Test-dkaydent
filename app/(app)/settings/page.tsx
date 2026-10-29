import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { PrintSettingsForm } from "@/components/PrintSettingsForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
import { changePassword } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error, message } = await searchParams;
  const { profile } = await getSession();
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
            <input name="next" type="password" className="input" required minLength={8} autoComplete="new-password" />
          </label>
          <label>
            <span className="label">Type it again</span>
            <input name="again" type="password" className="input" required minLength={8} autoComplete="new-password" />
          </label>
          <div className="sm:col-span-3">
            <SubmitButton>Change password</SubmitButton>
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
