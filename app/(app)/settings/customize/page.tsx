import { ThemePicker } from "@/components/ThemePicker";
import { PageHeader, Section } from "@/components/ui";

export default function CustomizePage() {
  return (
    <>
      <PageHeader title="Customize page" subtitle="Colours, light or dark, and font. Saved on this device for you only" />
      <Section title="Appearance">
        <p className="mb-3 text-sm text-stone-500">
          Pick a colour palette and whether it shows light or dark. System follows your device and switches with it. Invoices, labels and pull
          tickets always print in black and white.
        </p>
        <ThemePicker />
      </Section>
    </>
  );
}
