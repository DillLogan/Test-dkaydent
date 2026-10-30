import { requireRole } from "@/lib/auth";
import { loadPrintConfig } from "@/lib/printConfig";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
import { savePrintouts } from "./actions";
import { loadPrintouts } from "@/lib/pdfdocs/load";
import { PrintoutDesigner } from "./PrintoutDesigner";

type SP = Promise<Record<string, string | undefined>>;

function Check({ name, label, on }: { name: string; label: string; on: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} className="h-4 w-4" />
      {label}
    </label>
  );
}
function Text({ name, label, value, rows }: { name: string; label: string; value: string; rows?: number }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {rows ? <textarea name={name} rows={rows} className="input" defaultValue={value} maxLength={500} /> : <input name={name} className="input" defaultValue={value} maxLength={500} />}
    </label>
  );
}

export default async function PrintoutsPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase } = await requireRole("admin");
  const c = await loadPrintConfig(supabase);
  const { templates, defaults, business } = await loadPrintouts(supabase, ["pull", "invoice", "route", "boxlabel", "label"]);
  return (
    <>
      <PageHeader title="Customize printouts" subtitle="Company details, wording, and the PDF layout of every printout. Applies to everyone." back={{ href: "/settings", label: "Settings" }} />
      <ErrorBanner error={error} />
      <Notice message={message} />
      <form action={savePrintouts} className="space-y-6" data-testid="printouts-form">
        <Section title="Company header">
          <div className="card grid gap-3 sm:grid-cols-2">
            <Text name="h_name" label="Business name" value={c.header.name} />
            <Text name="h_phone" label="Phone" value={c.header.phone} />
            <Text name="h_address" label="Address" value={c.header.address} rows={2} />
            <Text name="h_footer" label="Footer text" value={c.header.footer} rows={2} />
            <p className="text-xs text-stone-500 sm:col-span-2">Printed at the top of invoices, pull sheets and route sheets. The footer prints at the bottom.</p>
          </div>
        </Section>
        <Section title="Invoice">
          <div className="card space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Text name="i_customerTitle" label="Customer copy title" value={c.invoice.customerTitle} />
              <Text name="i_officeTitle" label="Office copy title" value={c.invoice.officeTitle} />
              <Text name="i_terms" label="Terms" value={c.invoice.terms} rows={2} />
              <Text name="i_note" label="Note under the totals" value={c.invoice.note} rows={2} />
            </div>
          </div>
        </Section>
        <SubmitButton>Save company details</SubmitButton>
      </form>
      <Section title="PDF layouts" className="mt-10">
        <p className="mb-3 text-sm text-stone-500">
          Every printout is a PDF made from these layouts. Move, resize, add or hide anything; choose columns for the lists; add your logo. Preview PDF shows it with sample data.
        </p>
        <PrintoutDesigner initial={templates} defaults={defaults} business={business} />
      </Section>
    </>
  );
}
