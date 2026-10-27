import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, money, qty, today } from "@/lib/format";
import { setInvoiceStatus, voidInvoice } from "../../sales/actions";
import { PrintButton } from "@/components/PrintButton";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section, StatusBadge } from "@/components/ui";
import { PaymentsPanel } from "@/components/PaymentsPanel";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function InvoicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message, charge } = await searchParams;
  const { supabase, profile } = await getSession();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(*), sales_orders(id, so_number, ship_date, notes, delivery_address, shop_layouts(name, address))")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();
  const { data: lines } = await supabase
    .from("sales_order_lines")
    .select("*, products(sku, name), product_units(name)")
    .eq("so_id", inv.so_id)
    .order("created_at");

  const { data: credits } = await supabase
    .from("returns")
    .select("id, return_number, created_at, total, credit_status")
    .eq("so_id", inv.so_id)
    .order("created_at");
  const { data: paidRows } = await supabase.from("payments").select("amount").eq("so_id", inv.so_id).eq("status", "completed");
  const paid = (paidRows ?? []).reduce((t, p) => t + Number(p.amount), 0);
  const canEdit = can(profile, "sales", "orders_manager");
  const so = inv.sales_orders as unknown as { delivery_address: string | null; shop_layouts: { name: string; address: string | null } | null } | null;
  const overdue = inv.status === "open" && inv.due_at < today();
  const c = inv.customers;

  return (
    <>
      <PageHeader title={inv.invoice_number} back={{ href: "/invoices", label: "Invoices" }}>
        <PrintButton />
        {canEdit && inv.status === "open" && (
          <>
            <form action={voidInvoice.bind(null, id, inv.so_id)}>
              <SubmitButton
                className="btn btn-danger"
                confirm="Void this invoice? The order goes back to Completed so you can correct it and invoice again."
                pendingText="…"
              >
                Void
              </SubmitButton>
            </form>
            {paid === 0 && (
              <form action={setInvoiceStatus.bind(null, id, "paid")}>
                <SubmitButton pendingText="…">Mark paid</SubmitButton>
              </form>
            )}
          </>
        )}
        {canEdit && inv.status === "paid" && paid === 0 && (
          <form action={setInvoiceStatus.bind(null, id, "open")}>
            <SubmitButton className="btn" pendingText="…">
              Mark unpaid
            </SubmitButton>
          </form>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <article className="card mx-auto max-w-3xl p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-display text-xl text-brand-700">DKaydent</div>
            <div className="text-xl font-semibold">Wholesale</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold">Invoice</div>
            <div className="tabular-nums">{inv.invoice_number}</div>
            <div className="mt-1 print:hidden">
              <StatusBadge status={overdue ? "overdue" : inv.status} />
            </div>
          </div>
        </header>

        <div className="mb-8 grid gap-6 sm:grid-cols-3" data-testid="invoice-addresses">
          <div>
            <div className="label">Bill to · location</div>
            <div className="font-medium">{c?.name}</div>
            {c?.contact_name && <div>{c.contact_name}</div>}
            {c?.address && <div className="whitespace-pre-line text-sm">{c.address}</div>}
            {c?.email && <div className="text-sm">{c.email}</div>}
            {c?.resale_certificate && <div className="mt-1 text-xs text-stone-500">Resale cert #{c.resale_certificate}</div>}
          </div>
          <div>
            <div className="label">Deliver to</div>
            <div className="whitespace-pre-line text-sm" data-testid="invoice-delivery">
              {so?.delivery_address || c?.delivery_address || c?.address || "Pickup"}
            </div>
            {so?.shop_layouts && (
              <>
                <div className="label mt-3">Ships from</div>
                <div className="text-sm font-medium">{so.shop_layouts.name}</div>
                {so.shop_layouts.address && <div className="whitespace-pre-line text-sm">{so.shop_layouts.address}</div>}
              </>
            )}
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
                  <div className="text-xs text-stone-500 tabular-nums">{l.products?.sku}</div>
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
            <span>{paid > 0 ? "Total" : "Total due"}</span>
            <span className="tabular-nums">{money(inv.total)}</span>
          </div>
          {paid > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-stone-500">Paid</span>
                <span className="tabular-nums">−{money(paid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance due</span>
                <span className="tabular-nums">{money(Math.max(0, Number(inv.total) - paid))}</span>
              </div>
            </>
          )}
        </div>

        {inv.sales_orders?.notes && <p className="mt-8 text-sm text-stone-600">{inv.sales_orders.notes}</p>}
      </article>

      {inv.status !== "void" && (
        <div className="mx-auto mt-8 max-w-3xl print:hidden">
          <PaymentsPanel
            supabase={supabase}
            soId={inv.so_id}
            total={Number(inv.total)}
            purpose="invoice"
            back={`/invoices/${id}`}
            canSell={canEdit}
            open={inv.status === "open"}
            chargeId={charge}
          />
        </div>
      )}

      {(credits ?? []).length > 0 && (
        <Section title="Credits on this order" className="mx-auto mt-8 max-w-3xl print:hidden">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Return</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {(credits ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/sales/${inv.so_id}`} className="link whitespace-nowrap">
                        {c.return_number}
                      </Link>
                    </td>
                    <td>{date(c.created_at)}</td>
                    <td>
                      <StatusBadge status={c.credit_status} />
                    </td>
                    <td className="num">{money(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
