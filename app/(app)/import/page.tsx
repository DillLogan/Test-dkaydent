import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { IMPORT_ROLE, type Entity } from "@/lib/importSpec";
import { importRows, importStockBatch } from "./actions";
import { ImportForm } from "@/components/ImportForm";
import { StockBatchForm } from "@/components/StockBatchForm";
import type { CategoryRule } from "@/lib/categorize";
import { today } from "@/lib/format";
import { Empty, ErrorBanner, Notice, PageHeader, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;
const ENTITIES: Entity[] = ["products", "vendors", "customers"];
const TABS = [
  { key: "stock", label: "Stock batch" },
  { key: "products", label: "Items" },
  { key: "vendors", label: "Vendors" },
  { key: "customers", label: "Customers" },
];

export default async function ImportPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.entity) ? (sp.entity as string) : "stock";
  const { supabase, profile } = await getSession();

  const header = (
    <>
      <PageHeader
        title="Import data"
        subtitle="Load stock, items, vendors or customers from a spreadsheet saved as CSV. You'll see a preview before anything is saved."
      />
      <ErrorBanner error={sp.error} />
      <Notice message={sp.message} />
      <Tabs current={tab} items={TABS.map((t) => ({ key: t.key, href: `/import?entity=${t.key}`, label: t.label }))} />
    </>
  );

  if (tab === "stock") {
    if (!can(profile, "buyer", "warehouse")) {
      return (
        <>
          {header}
          <Empty>Receiving a stock batch needs the Buyer or Warehouse role.</Empty>
        </>
      );
    }
    const [{ data: products }, { data: units }, { data: locations }, { data: rules }] = await Promise.all([
      supabase.from("products").select("id, sku, name, base_unit, category"),
      supabase.from("product_units").select("product_id, name"),
      supabase.from("locations").select("name").eq("active", true).order("name"),
      supabase.from("category_rules").select("keyword, category, kind, priority"),
    ]);
    const unitsBy = new Map<string, string[]>();
    for (const u of units ?? []) unitsBy.set(u.product_id, [...(unitsBy.get(u.product_id) ?? []), u.name]);
    return (
      <>
        {header}
        <StockBatchForm
          items={(products ?? []).map((p) => ({ sku: p.sku, name: p.name, baseUnit: p.base_unit, category: p.category, units: unitsBy.get(p.id) ?? [p.base_unit] }))}
          locations={(locations ?? []).map((l) => l.name)}
          rules={(rules ?? []) as CategoryRule[]}
          canCreate={can(profile, "buyer")}
          defaultReference={`BATCH-${today().replace(/-/g, "").slice(2)}`}
          action={importStockBatch}
        />
      </>
    );
  }

  const entity = tab as Entity;
  const allowed = can(profile, IMPORT_ROLE[entity]);
  let existing: string[] = [];
  let tiers: Record<string, string> = {};
  if (allowed) {
    if (entity === "products") {
      const { data } = await supabase.from("products").select("sku");
      existing = (data ?? []).map((p) => p.sku.toUpperCase());
    } else {
      const { data } = await supabase.from(entity).select("name");
      existing = (data ?? []).map((r) => r.name.trim().toLowerCase());
    }
    const { data: t } = await supabase.from("price_tiers").select("id, name");
    tiers = Object.fromEntries((t ?? []).map((x) => [x.name.trim().toLowerCase(), x.id]));
  }
  return (
    <>
      {header}
      {allowed ? (
        <ImportForm key={entity} entity={entity} existing={existing} tiers={tiers} action={importRows.bind(null, entity)} />
      ) : (
        <Empty>Importing {entity} needs the {IMPORT_ROLE[entity]} role.</Empty>
      )}
    </>
  );
}
