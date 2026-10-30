import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, money, sum, today } from "@/lib/format";
import { createPO } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { DirectShipBadge } from "@/components/DirectShip";
import { Empty, ErrorBanner, PageHeader, Section, StatusBadge, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

const FILTERS: Record<string, string[] | null> = {
  open: ["draft", "ordered", "partially_received"],
  draft: ["draft"],
  ordered: ["ordered", "partially_received"],
  received: ["received"],
  planned: ["draft"],
  cancelled: ["cancelled"],
  all: null,
};

export default async function PurchasingPage({ searchParams }: { searchParams: SP }) {
  const { status = "open", vendor, error } = await searchParams;
  const { supabase, profile } = await getSession();

  let query = supabase
    .from("purchase_orders")
    .select("id, po_number, status, order_date, expected_date, freight_cost, other_cost, vendors(name), customers(name), purchase_order_lines(qty, unit_cost)")
    .order(status === "planned" ? "expected_date" : "created_at", { ascending: status === "planned" })
    .limit(200);
  const statuses = FILTERS[status] ?? null;
  if (statuses) query = query.in("status", statuses);
  // Standing-order deliveries that haven't been placed yet live under "Planned", not in the open/draft lists.
  if (status === "planned") query = query.not("standing_order_id", "is", null);
  else if (status === "open" || status === "draft") query = query.or("standing_order_id.is.null,status.neq.draft");
  const [{ data: pos }, { data: vendors }, { data: customers }] = await Promise.all([
    query,
    supabase.from("vendors").select("id, name").eq("active", true).order("name"),
    supabase.from("customers").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader title="Purchasing" subtitle="Purchase orders from growers and suppliers, and receiving">
        <a href="/export/purchase-orders" className="btn">
          Export CSV
        </a>
      </PageHeader>
      <ErrorBanner error={error} />

      {can(profile, "buyer") && (
        <Section title="New purchase order">
          {!vendors?.length ? (
            <Empty>
              Add a <Link href="/vendors" className="link">vendor</Link> first.
            </Empty>
          ) : (
            <form action={createPO} className="card flex flex-wrap items-end gap-3">
              <label className="min-w-56 flex-1">
                <span className="label">Vendor</span>
                <select name="vendor_id" className="input" defaultValue={vendor ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Expected</span>
                <input name="expected_date" type="date" className="input" min={today()} />
              </label>
              <label className="min-w-48">
                <span className="label">Direct ship for</span>
                <select name="direct_customer_id" className="input" defaultValue="">
                  <option value="">Not direct ship</option>
                  {(customers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton>Create draft PO</SubmitButton>
            </form>
          )}
        </Section>
      )}

      <Tabs
        current={status}
        items={Object.keys(FILTERS).map((k) => ({
          key: k,
          href: `/purchasing?status=${k}`,
          label: k === "planned" ? "Planned (standing)" : k[0].toUpperCase() + k.slice(1),
        }))}
      />

      {!pos?.length ? (
        <Empty>No purchase orders here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>PO</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Ordered</th>
                <th>Expected</th>
                <th className="num">Landed total</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po: any) => {
                const late =
                  ["ordered", "partially_received"].includes(po.status) && po.expected_date && po.expected_date < today();
                return (
                  <tr key={po.id}>
                    <td>
                      <Link href={`/purchasing/${po.id}`} className="link font-medium whitespace-nowrap">
                        {po.po_number}
                      </Link>
                    </td>
                    <td>
                      {po.vendors?.name}
                      {po.customers?.name && (
                        <div>
                          <DirectShipBadge name={po.customers.name} />
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={po.status} />
                    </td>
                    <td>{date(po.order_date)}</td>
                    <td className={late ? "font-medium text-red-700" : ""}>{date(po.expected_date)}</td>
                    <td className="num">
                      {money(
                        sum(po.purchase_order_lines, (l: any) => l.qty * l.unit_cost) +
                          Number(po.freight_cost) +
                          Number(po.other_cost),
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
