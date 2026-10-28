import { requireRole } from "@/lib/auth";
import { loadPrintConfig } from "@/lib/printConfig";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
import { savePrintouts } from "./actions";

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
  return (
    <>
      <PageHeader title="Customize printouts" subtitle="What invoices, pull sheets, route sheets and box labels say and show. Applies to everyone." back={{ href: "/settings", label: "Settings" }} />
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
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Check name="i_showSku" label="Item SKU" on={c.invoice.showSku} />
              <Check name="i_showNotes" label="Order notes" on={c.invoice.showNotes} />
              <Check name="i_showBarcode" label="Barcode" on={c.invoice.showBarcode} />
              <Check name="i_showResale" label="Resale certificate" on={c.invoice.showResale} />
            </div>
          </div>
        </Section>
        <Section title="Pull sheet">
          <div className="card flex flex-wrap gap-x-6 gap-y-2">
            <Check name="p_showSku" label="Item SKU" on={c.pull.showSku} />
            <Check name="p_showLot" label="Lot and expiry" on={c.pull.showLot} />
            <Check name="p_showNotes" label="Order notes" on={c.pull.showNotes} />
            <Check name="p_showBarcode" label="Barcode" on={c.pull.showBarcode} />
            <Check name="p_showLabelLine" label="“Box labels printed” line" on={c.pull.showLabelLine} />
          </div>
        </Section>
        <Section title="Route sheet">
          <div className="card flex flex-wrap gap-x-6 gap-y-2">
            <Check name="r_showPhone" label="Customer phone" on={c.route.showPhone} />
            <Check name="r_showBoxes" label="Expected box count" on={c.route.showBoxes} />
          </div>
        </Section>
        <Section title="Box labels">
          <div className="card flex flex-wrap gap-x-6 gap-y-2">
            <Check name="l_showAddress" label="Ship-to address" on={c.labels.showAddress} />
            <Check name="l_showRoute" label="Route code" on={c.labels.showRoute} />
            <p className="w-full text-xs text-stone-500">The shop name, “Box x of y” and the barcode always print. Label size and printers are set under Settings → Printing, on each computer.</p>
          </div>
        </Section>
        <SubmitButton>Save printouts</SubmitButton>
      </form>
    </>
  );
}
