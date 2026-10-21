import { getSession } from "@/lib/auth";
import { ThemePicker } from "@/components/ThemePicker";
import { PageHeader, Section } from "@/components/ui";

export default async function SettingsPage() {
  await getSession();
  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences for this browser" />
      <Section title="Appearance">
        <p className="mb-3 text-sm text-stone-500">
          Choose how DKaydent Wholesale looks. System follows your device&apos;s light or dark setting and switches with it. Saved on this
          device; invoices and labels always print in light.
        </p>
        <ThemePicker />
      </Section>
    </>
  );
}
