import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createTier, updateTier } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function TiersPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const [{ data: tiers }, { data: customers }] = await Promise.all([
    supabase.from("price_tiers").select("*").order("name"),
    supabase.from("customers").select("price_tier_id"),
  ]);
  const canEdit = can(profile, "sales");
  const counts = new Map<string, number>();
  for (const c of customers ?? []) if (c.price_tier_id) counts.set(c.price_tier_id, (counts.get(c.price_tier_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Price tiers"
        subtitle="Each customer belongs to a tier. Set exact prices per product on the product page; otherwise the tier markup over average landed cost is suggested."
        back={{ href: "/customers", label: "Customers" }}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Tiers">
        {!tiers?.length ? (
          <Empty>No tiers yet.</Empty>
        ) : (
          <div className="space-y-2">
            {tiers.map((t) => (
              <form key={t.id} action={updateTier.bind(null, t.id)} className="card flex flex-wrap items-end gap-3">
                <fieldset disabled={!canEdit} className="contents">
                  <label className="min-w-48 flex-1">
                    <span className="label">Name</span>
                    <input name="name" defaultValue={t.name} className="input" required />
                  </label>
                  <label>
                    <span className="label">Markup %</span>
                    <input name="markup_pct" type="number" step="0.1" defaultValue={t.markup_pct} className="input w-28" required />
                  </label>
                  <div className="pb-2 text-sm text-stone-500">{counts.get(t.id) ?? 0} customers</div>
                  {canEdit && <SubmitButton className="btn">Save</SubmitButton>}
                </fieldset>
              </form>
            ))}
          </div>
        )}
      </Section>

      {canEdit && (
        <Section title="Add tier">
          <form action={createTier} className="card flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1">
              <span className="label">Name</span>
              <input name="name" className="input" placeholder="Event Designer" required />
            </label>
            <label>
              <span className="label">Markup %</span>
              <input name="markup_pct" type="number" step="0.1" defaultValue={35} className="input w-28" required />
            </label>
            <SubmitButton>Add tier</SubmitButton>
          </form>
        </Section>
      )}
    </>
  );
}
