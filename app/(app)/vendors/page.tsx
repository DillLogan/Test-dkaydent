import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { searchTerm } from "@/lib/forms";
import { createVendor } from "./actions";
import { VendorFields } from "@/components/PartyFields";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, PageHeader, Section, StatusBadge } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function VendorsPage({ searchParams }: { searchParams: SP }) {
  const { q, error } = await searchParams;
  const { supabase, profile } = await getSession();
  let query = supabase.from("vendors").select("*").order("name");
  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,country.ilike.%${term}%,contact_name.ilike.%${term}%`);
  const { data: vendors } = await query;

  return (
    <>
      <PageHeader title="Vendors" subtitle="Growers, distributors and hard goods suppliers">
        <a href="/export/vendors" className="btn">
          Export CSV
        </a>
        {can(profile, "buyer") && (
          <Link href="/import?entity=vendors" className="btn">
            Import
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search vendors" className="input max-w-xs" />
        <button className="btn">Search</button>
      </form>

      <Section title="All vendors">
        {!vendors?.length ? (
          <Empty>No vendors yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Country</th>
                  <th>Terms</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/vendors/${v.id}`} className="link">
                        {v.name}
                      </Link>{" "}
                      {!v.active && <StatusBadge status="inactive" />}
                    </td>
                    <td className="capitalize">{v.kind}</td>
                    <td>
                      {v.contact_name ?? "—"}
                      {v.email && <div className="text-xs text-stone-500">{v.email}</div>}
                    </td>
                    <td>{v.country ?? "—"}</td>
                    <td>{v.payment_terms ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {can(profile, "buyer") && (
        <Section title="Add vendor">
          <form action={createVendor} className="card space-y-4">
            <VendorFields vendor={null} />
            <SubmitButton>Add vendor</SubmitButton>
          </form>
        </Section>
      )}
    </>
  );
}
