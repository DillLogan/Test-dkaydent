import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { IMPORT_ROLE, type Entity } from "@/lib/importSpec";
import { importRows } from "./actions";
import { ImportForm } from "@/components/ImportForm";
import { Empty, ErrorBanner, Notice, PageHeader, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;
const ENTITIES: Entity[] = ["products", "vendors", "customers"];

export default async function ImportPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const entity: Entity = ENTITIES.includes(sp.entity as Entity) ? (sp.entity as Entity) : "products";
  const { supabase, profile } = await getSession();
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
      <PageHeader title="Import data" subtitle="Load products, vendors or customers from a spreadsheet saved as CSV. You'll see a preview before anything is saved." />
      <ErrorBanner error={sp.error} />
      <Notice message={sp.message} />
      <Tabs
        current={entity}
        items={ENTITIES.map((e) => ({ key: e, href: `/import?entity=${e}`, label: e[0].toUpperCase() + e.slice(1) }))}
      />
      {allowed ? (
        <ImportForm key={entity} entity={entity} existing={existing} tiers={tiers} action={importRows.bind(null, entity)} />
      ) : (
        <Empty>Importing {entity} needs the {IMPORT_ROLE[entity]} role.</Empty>
      )}
    </>
  );
}
