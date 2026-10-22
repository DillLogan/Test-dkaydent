import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog } from "@/lib/catalog";
import { importTerminalSales } from "../actions";
import { TerminalSyncForm } from "@/components/TerminalSyncForm";
import { ErrorBanner, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function TerminalSyncPage({ searchParams }: { searchParams: SP }) {
  const { error } = await searchParams;
  const { supabase, profile } = await getSession();
  if (!can(profile, "sales")) {
    return <PageHeader title="Sync terminal sales" subtitle="Needs the Sales role." back={{ href: "/payments", label: "Payments" }} />;
  }
  const [catalog, { data: map }, { data: invs }, { data: sos }, { data: synced }] = await Promise.all([
    loadCatalog(supabase),
    supabase.from("terminal_item_map").select("item_key, product_id, unit_id"),
    supabase.from("invoices").select("invoice_number").eq("status", "open"),
    supabase.from("sales_orders").select("so_number").in("status", ["draft", "confirmed", "fulfilled"]),
    supabase.from("payments").select("external_txn_id").not("external_txn_id", "is", null).limit(10000),
  ]);
  return (
    <>
      <PageHeader
        title="Sync terminal sales"
        subtitle="Bring in sales rung up on Valor terminals: apply payments to invoices, and turn itemized sales into counter sales."
        back={{ href: "/payments", label: "Payments" }}
      />
      <ErrorBanner error={error} />
      <TerminalSyncForm
        products={catalog.filter((p) => p.units.length).map((p) => ({ id: p.id, sku: p.sku, name: p.name, units: p.units }))}
        savedMap={Object.fromEntries((map ?? []).map((m) => [m.item_key, { product_id: m.product_id, unit_id: m.unit_id }]))}
        openRefs={[...(invs ?? []).map((i) => i.invoice_number), ...(sos ?? []).map((s) => s.so_number)].map((x) => x.toUpperCase())}
        knownTxnIds={(synced ?? []).map((s) => s.external_txn_id as string)}
        action={importTerminalSales}
      />
    </>
  );
}
