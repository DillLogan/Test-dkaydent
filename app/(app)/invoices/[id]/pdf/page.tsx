import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { date, qty } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { DocPdf } from "@/components/pdf/Printout";
import { loadPrintouts } from "@/lib/pdfdocs/load";
import { invoiceData } from "@/lib/pdfdocs/data";

type Props = { params: Promise<{ id: string }> };

/** The invoice as a PDF: customer copy and office copy, made from the invoice layout. */
export default async function InvoicePdfPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await getSession();
  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customers(*), sales_orders(id, so_number, notes, delivery_address, shop_layouts(name, address))")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();
  const [{ data: lines }, { data: paidRows }, { templates, business, pc }] = await Promise.all([
    supabase.from("sales_order_lines").select("qty, unit_price, products(sku, name), product_units(name)").eq("so_id", inv.so_id).order("created_at"),
    supabase.from("payments").select("amount").eq("so_id", inv.so_id).eq("status", "completed"),
    loadPrintouts(supabase, ["invoice"]),
  ]);
  const paid = (paidRows ?? []).reduce((t, p) => t + Number(p.amount), 0);
  const c = inv.customers as { name: string; contact_name?: string | null; address?: string | null; email?: string | null; resale_certificate?: string | null } | null;
  const so = inv.sales_orders as unknown as { so_number: string; notes: string | null; delivery_address: string | null; shop_layouts: { name: string; address: string | null } | null } | null;
  const billTo = [c?.name, c?.contact_name, c?.address, c?.email].filter(Boolean).join("\n");
  const data = invoiceData({
    business,
    copies: [pc.invoice.customerTitle, pc.invoice.officeTitle],
    inv: {
      number: inv.invoice_number,
      issued: date(inv.issued_at),
      due: date(inv.due_at),
      soNumber: so?.so_number ?? "",
      customer: c?.name ?? "",
      billTo,
      deliverTo: [c?.name, so?.delivery_address || c?.address].filter(Boolean).join("\n"),
      shipsFrom: so?.shop_layouts ? [so.shop_layouts.name, so.shop_layouts.address?.replace(/\s*\n\s*/g, ", ")].filter(Boolean).join(" · ") : "",
      terms: pc.invoice.terms,
      note: pc.invoice.note,
      resale: c?.resale_certificate,
      orderNotes: so?.notes,
      status: inv.status,
    },
    lines: (lines ?? []).map((l: any) => ({ sku: l.products?.sku ?? "", item: l.products?.name ?? "", qty: `${qty(Number(l.qty))} ${l.product_units?.name ?? ""}`.trim(), price: Number(l.unit_price), amount: Math.round(Number(l.qty) * Number(l.unit_price) * 100) / 100 })),
    totals: { subtotal: Number(inv.subtotal), taxRate: Number(inv.tax_rate), tax: Number(inv.tax), cardFeeRate: Number(inv.card_fee_rate ?? 0), cardFee: Number(inv.card_fee ?? 0), total: Number(inv.total), paid },
  });
  return (
    <>
      <PageHeader title={`${inv.invoice_number} · PDF`} subtitle={c?.name ?? undefined} back={{ href: `/invoices/${id}`, label: inv.invoice_number }} />
      <DocPdf template={templates.invoice} data={data} filename={`${inv.invoice_number}.pdf`} title={`Invoice ${inv.invoice_number}`} />
    </>
  );
}
