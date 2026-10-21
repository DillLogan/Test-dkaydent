import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, money, sum } from "@/lib/format";
import { updateVendor } from "../actions";
import { VendorFields } from "@/components/PartyFields";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function VendorPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: vendor }, { data: pos }] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, order_date, expected_date, freight_cost, other_cost, purchase_order_lines(qty, unit_cost)")
      .eq("vendor_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (!vendor) notFound();
  const canEdit = can(profile, "buyer");

  return (
    <>
      <PageHeader title={vendor.name} subtitle={<span className="capitalize">{vendor.kind}</span>} back={{ href: "/vendors", label: "Vendors" }}>
        {canEdit && (
          <Link href={`/purchasing?vendor=${id}`} className="btn btn-primary">
            New PO for this vendor
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Purchase orders">
        {!pos?.length ? (
          <Empty>No purchase orders yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Status</th>
                  <th>Ordered</th>
                  <th>Expected</th>
                  <th className="num">Landed total</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <Link href={`/purchasing/${po.id}`} className="link whitespace-nowrap">
                        {po.po_number}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={po.status} />
                    </td>
                    <td>{date(po.order_date)}</td>
                    <td>{date(po.expected_date)}</td>
                    <td className="num">
                      {money(
                        sum(po.purchase_order_lines, (l: any) => l.qty * l.unit_cost) +
                          Number(po.freight_cost) +
                          Number(po.other_cost),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Details">
        <form action={updateVendor.bind(null, id)} className="card space-y-4">
          <fieldset disabled={!canEdit} className="space-y-4">
            <VendorFields vendor={vendor} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={vendor.active} /> Active
            </label>
            {canEdit && <SubmitButton>Save changes</SubmitButton>}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
