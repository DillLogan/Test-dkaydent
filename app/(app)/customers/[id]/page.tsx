import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, money, pct, sum, today } from "@/lib/format";
import { updateCustomer } from "../actions";
import { CustomerFields } from "@/components/PartyFields";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function CustomerPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: customer }, { data: tiers }, { data: orders }, { data: invoices }, { data: lines }] = await Promise.all([
    supabase.from("customers").select("*, price_tiers(name)").eq("id", id).maybeSingle(),
    supabase.from("price_tiers").select("id, name").order("name"),
    supabase
      .from("sales_orders")
      .select("id, so_number, status, order_date, ship_date, sales_order_lines(qty, unit_price)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("invoices").select("*").eq("customer_id", id).order("issued_at", { ascending: false }).limit(50),
    supabase.from("v_sales_lines").select("revenue, margin").eq("customer_id", id),
  ]);
  const { data: credits } = await supabase.from("returns").select("total, credit_status").eq("customer_id", id);
  if (!customer) notFound();
  const canEdit = can(profile, "sales");

  const revenue = sum(lines, (l) => l.revenue);
  const open = (invoices ?? []).filter((i) => i.status === "open");

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={`${customer.price_tiers?.name ?? "No tier"} · Net ${customer.payment_terms_days}`}
        back={{ href: "/customers", label: "Customers" }}
      >
        {canEdit && (
          <Link href={`/sales?customer=${id}`} className="btn btn-primary">
            New sales order
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Lifetime revenue" value={money(revenue)} />
        <Stat label="Gross margin" value={pct(revenue ? sum(lines, (l) => l.margin) / revenue : null)} />
        <Stat label="Open balance" value={money(sum(open, (i) => i.total))} hint={`${open.length} open invoices`} />
        <Stat
          label="Overdue"
          value={money(sum(open.filter((i) => i.due_at < today()), (i) => i.total))}
          tone={open.some((i) => i.due_at < today()) ? "bad" : undefined}
        />
        <Stat
          label="Open credits"
          value={money(sum((credits ?? []).filter((c) => c.credit_status === "open"), (c) => c.total))}
          hint={`${(credits ?? []).length} returns total`}
          href="/returns?status=open"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Sales orders">
          {!orders?.length ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/sales/${o.id}`} className="link whitespace-nowrap">
                          {o.so_number}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                      <td>{date(o.order_date)}</td>
                      <td className="num">{money(sum(o.sales_order_lines, (l: any) => l.qty * l.unit_price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <Section title="Invoices">
          {!invoices?.length ? (
            <Empty>No invoices yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/invoices/${i.id}`} className="link whitespace-nowrap">
                          {i.invoice_number}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={i.status === "open" && i.due_at < today() ? "overdue" : i.status} />
                      </td>
                      <td>{date(i.due_at)}</td>
                      <td className="num">{money(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Section title="Details">
        <form action={updateCustomer.bind(null, id)} className="card space-y-4">
          <fieldset disabled={!canEdit} className="space-y-4">
            <CustomerFields customer={customer} tiers={tiers ?? []} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={customer.active} /> Active
            </label>
            {canEdit && <SubmitButton>Save changes</SubmitButton>}
          </fieldset>
        </form>
      </Section>
    </>
  );
}
