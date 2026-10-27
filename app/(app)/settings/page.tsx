import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ThemePicker } from "@/components/ThemePicker";
import { PrintSettingsForm } from "@/components/PrintSettingsForm";
import { PageHeader, Section } from "@/components/ui";

export default async function SettingsPage() {
  const { profile } = await getSession();
  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences for this browser" />
      <Section title="Appearance">
        <p className="mb-3 text-sm text-stone-500">
          Pick a colour palette and whether it shows light or dark. System follows your device and switches with it. Saved on this device;
          invoices, labels and pull tickets always print in black and white.
        </p>
        <ThemePicker />
      </Section>
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
      <Section title="Printing">
        <p className="mb-3 text-sm text-stone-500">
          How labels print from this computer. Use Label printer for a thermal or roll label printer, and Regular printer for an office or home
          printer on plain paper. Saved on this computer only, so each workstation can use its own printer.
        </p>
        <PrintSettingsForm />
      </Section>
    </>
  );
}
