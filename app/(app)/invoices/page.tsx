import Link from "next/link";
import { getSession } from "@/lib/auth";
import { date, money, sum, today } from "@/lib/format";
import { Empty, PageHeader, StatusBadge, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function InvoicesPage({ searchParams }: { searchParams: SP }) {
  const { status = "open" } = await searchParams;
  const { supabase } = await getSession();

  let q = supabase
    .from("invoices")
    .select("*, customers(name), sales_orders(so_number)")
    .order("issued_at", { ascending: false })
    .limit(300);
  if (status === "open") q = q.eq("status", "open");
  if (status === "overdue") q = q.eq("status", "open").lt("due_at", today());
  if (status === "paid") q = q.eq("status", "paid");
  if (status === "void") q = q.eq("status", "void");
  const { data: invoices } = await q;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`${invoices?.length ?? 0} shown · ${money(sum(invoices, (i) => i.total))}`}
      >
        <a href="/export/invoices" className="btn">
          Export CSV
        </a>
      </PageHeader>
      <Tabs
        current={status}
        items={["open", "overdue", "paid", "void", "all"].map((k) => ({
          key: k,
          href: `/invoices?status=${k}`,
          label: k[0].toUpperCase() + k.slice(1),
        }))}
      />
      {!invoices?.length ? (
        <Empty>No invoices here. Invoices are created from completed sales orders.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Order</th>
                <th>Status</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i: any) => {
                const overdue = i.status === "open" && i.due_at < today();
                return (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/invoices/${i.id}`} className="link font-medium whitespace-nowrap">
                        {i.invoice_number}
                      </Link>
                    </td>
                    <td>{i.customers?.name}</td>
                    <td>
                      <Link href={`/sales/${i.so_id}`} className="link">
                        {i.sales_orders?.so_number}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={overdue ? "overdue" : i.status} />
                    </td>
                    <td>{date(i.issued_at)}</td>
                    <td className={overdue ? "font-medium text-red-700" : ""}>{date(i.due_at)}</td>
                    <td className="num">{money(i.total)}</td>
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
