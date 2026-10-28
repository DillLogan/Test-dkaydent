import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { searchTerm } from "@/lib/forms";
import { createCustomer } from "./actions";
import { CustomerFields } from "@/components/PartyFields";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, PageHeader, Section, StatusBadge } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function CustomersPage({ searchParams }: { searchParams: SP }) {
  const { q, error } = await searchParams;
  const { supabase, profile } = await getSession();
  let query = supabase.from("customers").select("*, price_tiers(name)").order("name");
  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,contact_name.ilike.%${term}%,email.ilike.%${term}%`);
  const [{ data: customers }, { data: tiers }] = await Promise.all([
    query,
    supabase.from("price_tiers").select("id, name").order("name"),
  ]);

  const { data: reps } = await supabase.from("profiles").select("id, full_name, email, role").eq("active", true).in("role", ["sales", "admin"]).order("full_name");
  const repList = (reps ?? []).map((r) => ({ id: r.id, name: r.full_name || r.email || "" }));

  return (
    <>
      <PageHeader title="Customers" subtitle="Florists, designers and resellers you sell to">
        <Link href="/customers/tiers" className="btn">
          Price tiers
        </Link>
        <a href="/export/customers" className="btn">
          Export CSV
        </a>
        {can(profile, "sales") && (
          <Link href="/import?entity=customers" className="btn">
            Import
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search customers" className="input max-w-xs" />
        <button className="btn">Search</button>
      </form>

      <Section title="All customers">
        {!customers?.length ? (
          <Empty>No customers yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Tier</th>
                  <th>Contact</th>
                  <th className="num">Terms</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.id}`} className="link">
                        {c.name}
                      </Link>{" "}
                      {!c.active && <StatusBadge status="inactive" />}
                    </td>
                    <td>{c.price_tiers?.name ?? "—"}</td>
                    <td>
                      {c.contact_name ?? "—"}
                      {c.email && <div className="text-xs text-stone-500">{c.email}</div>}
                    </td>
                    <td className="num">Net {c.payment_terms_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {can(profile, "sales") && (
        <Section title="Add customer">
          <form action={createCustomer} className="card space-y-4">
            <CustomerFields customer={null} tiers={tiers ?? []} reps={repList} />
            <SubmitButton>Add customer</SubmitButton>
          </form>
        </Section>
      )}
    </>
  );
}
