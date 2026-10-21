import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, money, qty, today } from "@/lib/format";
import { setInvoiceStatus } from "../../sales/actions";
import { PrintButton } from "@/components/PrintButton";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function InvoicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, profile } = await getSession();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(*), sales_orders(id, so_number, ship_date, notes)")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();
  const { data: lines } = await supabase
    .from("sales_order_lines")
    .select("*, products(sku, name), product_units(name)")
    .eq("so_id", inv.so_id)
    .order("created_at");

  const canEdit = can(profile, "sales");
  const overdue = inv.status === "open" && inv.due_at < today();
  const c = inv.customers;

  return (
    <>
      <PageHeader title={inv.invoice_number} back={{ href: "/invoices", label: "Invoices" }}>
        <PrintButton />
        {canEdit && inv.status === "open" && (
          <>
            <form action={setInvoiceStatus.bind(null, id, "void")}>
              <SubmitButton className="btn btn-danger" confirm="Void this invoice?" pendingText="…">
                Void
              </SubmitButton>
            </form>
            <form action={setInvoiceStatus.bind(null, id, "paid")}>
              <SubmitButton pendingText="…">Mark paid</SubmitButton>
            </form>
          </>
        )}
        {canEdit && inv.status === "paid" && (
          <form action={setInvoiceStatus.bind(null, id, "open")}>
            <SubmitButton className="btn" pendingText="…">
              Mark unpaid
            </SubmitButton>
          </form>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <article className="card mx-auto max-w-3xl p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest text-brand-700 uppercase">DKaydent</div>
            <div className="text-xl font-semibold">Wholesale</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold">Invoice</div>
            <div className="font-mono">{inv.invoice_number}</div>
            <div className="mt-1 print:hidden">
              <StatusBadge status={overdue ? "overdue" : inv.status} />
            </div>
          </div>
        </header>

        <div className="mb-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="label">Bill to</div>
            <div className="font-medium">{c?.name}</div>
            {c?.contact_name && <div>{c.contact_name}</div>}
            {c?.address && <div className="whitespace-pre-line text-sm">{c.address}</div>}
            {c?.email && <div className="text-sm">{c.email}</div>}
            {c?.resale_certificate && <div className="mt-1 text-xs text-stone-500">Resale cert #{c.resale_certificate}</div>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:text-right">
            <dt className="text-stone-500">Issued</dt>
            <dd>{date(inv.issued_at)}</dd>
            <dt className="text-stone-500">Due</dt>
            <dd className={overdue ? "font-medium text-red-700" : ""}>{date(inv.due_at)}</dd>
            <dt className="text-stone-500">Terms</dt>
            <dd>Net {c?.payment_terms_days}</dd>
            <dt className="text-stone-500">Order</dt>
            <dd>
              <Link href={`/sales/${inv.so_id}`} className="link print:text-stone-900 print:no-underline">
                {inv.sales_orders?.so_number}
              </Link>
            </dd>
            {inv.paid_at && (
              <>
                <dt className="text-stone-500">Paid</dt>
                <dd>{date(inv.paid_at)}</dd>
              </>
            )}
          </dl>
        </div>

        <table className="table mb-6">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l: any) => (
              <tr key={l.id}>
                <td>
                  {l.products?.name}
                  <div className="font-mono text-xs text-stone-500">{l.products?.sku}</div>
                </td>
                <td className="num">
                  {qty(l.qty)} {l.product_units?.name}
                </td>
                <td className="num">{money(l.unit_price)}</td>
                <td className="num">{money(Number(l.qty) * Number(l.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Subtotal</span>
            <span className="tabular-nums">{money(inv.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Tax ({Number(inv.tax_rate)}%)</span>
            <span className="tabular-nums">{money(inv.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
            <span>Total due</span>
            <span className="tabular-nums">{money(inv.total)}</span>
          </div>
        </div>

        {inv.sales_orders?.notes && <p className="mt-8 text-sm text-stone-600">{inv.sales_orders.notes}</p>}
      </article>
    </>
  );
}
