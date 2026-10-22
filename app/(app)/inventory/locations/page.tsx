import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { money } from "@/lib/format";
import { createLocation, moveLocationShop, toggleLocation } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, PageHeader, Section, StatusBadge } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function LocationsPage({ searchParams }: { searchParams: SP }) {
  const { error } = await searchParams;
  const { supabase, profile } = await getSession();
  const [{ data: locations }, { data: lots }, { data: layouts }] = await Promise.all([
    supabase.from("locations").select("*").order("name"),
    supabase.from("v_lot_aging").select("location_id, value"),
    supabase.from("shop_layouts").select("id, name").order("created_at").order("id"),
  ]);
  const shops = layouts ?? [];
  const multi = shops.length > 1;
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const totals = new Map<string, { value: number; lots: number }>();
  for (const l of lots ?? []) {
    const t = totals.get(l.location_id) ?? { value: 0, lots: 0 };
    t.value += Number(l.value);
    t.lots += 1;
    totals.set(l.location_id, t);
  }
  const canEdit = can(profile, "warehouse");

  return (
    <>
      <PageHeader title="Locations" subtitle="Coolers, shelves and staging areas" back={{ href: "/inventory", label: "Inventory" }} />
      <ErrorBanner error={error} />

      <Section title="All locations">
        {!locations?.length ? (
          <Empty>No locations yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  {multi && <th>Shop</th>}
                  <th>Type</th>
                  <th className="num">Temp °C</th>
                  <th className="num">Lots</th>
                  <th className="num">Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => {
                  const t = totals.get(l.id);
                  return (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/inventory?view=lots&location=${l.id}`} className="link">
                          {l.name}
                        </Link>{" "}
                        {!l.active && <StatusBadge status="inactive" />}
                      </td>
                      {multi && (
                        <td>
                          {canEdit ? (
                            <form action={moveLocationShop.bind(null, l.id)} className="flex items-center gap-1">
                              <select name="layout_id" defaultValue={l.layout_id} className="input w-auto py-1 text-xs" aria-label={`Shop for ${l.name}`}>
                                {shops.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                              <SubmitButton className="btn btn-sm" pendingText="…">
                                Move
                              </SubmitButton>
                            </form>
                          ) : (
                            shopName.get(l.layout_id)
                          )}
                        </td>
                      )}
                      <td className="capitalize">{l.kind}</td>
                      <td className="num">{l.temp_c ?? "—"}</td>
                      <td className="num">{t?.lots ?? 0}</td>
                      <td className="num">{money(t?.value ?? 0)}</td>
                      <td className="text-right">
                        {canEdit && (
                          <form action={toggleLocation.bind(null, l.id, !l.active)}>
                            <SubmitButton className="btn btn-sm" pendingText="…">
                              {l.active ? "Deactivate" : "Activate"}
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {canEdit && (
        <Section title="Add location">
          <form action={createLocation} className="card flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1">
              <span className="label">Name</span>
              <input name="name" className="input" placeholder="Cooler 3" required />
            </label>
            {multi && (
              <label>
                <span className="label">Shop</span>
                <select name="layout_id" className="input w-auto" defaultValue={shops[0]?.id}>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="label">Type</span>
              <select name="kind" className="input w-auto">
                <option value="cooler">Cooler</option>
                <option value="shelf">Shelf</option>
                <option value="dock">Dock / staging</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <span className="label">Temp °C</span>
              <input name="temp_c" type="number" step="0.1" className="input w-24" />
            </label>
            <SubmitButton>Add location</SubmitButton>
          </form>
        </Section>
      )}
    </>
  );
}
