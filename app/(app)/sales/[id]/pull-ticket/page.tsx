import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { date, dateTime } from "@/lib/format";
import { buildPullTicket, ticketQty, type TicketLot } from "@/lib/pullTicket";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

export default async function PullTicketPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await getSession();

  const [{ data: so }, { data: lines }, { data: layouts }] = await Promise.all([
    supabase.from("sales_orders").select("id, so_number, status, ship_date, notes, customers(name)").eq("id", id).maybeSingle(),
    supabase
      .from("sales_order_lines")
      .select("id, product_id, qty, products(sku, name, base_unit), product_units(name, factor)")
      .eq("so_id", id)
      .order("created_at"),
    supabase.from("shop_layouts").select("id, name").order("created_at").order("id"),
  ]);
  if (!so) notFound();

  const productIds = [...new Set((lines ?? []).map((l) => l.product_id))];
  const { data: lots } = productIds.length
    ? await supabase
        .from("lots")
        .select("id, lot_code, product_id, location_id, received_at, created_at, expires_at, qty_on_hand_base, locations(name, layout_id)")
        .in("product_id", productIds)
        .gt("qty_on_hand_base", 0)
    : { data: [] as any[] };

  const ticket = buildPullTicket(
    (lines ?? []).map((l: any) => ({
      id: l.id,
      productId: l.product_id,
      name: l.products.name,
      sku: l.products.sku,
      baseUnit: l.products.base_unit,
      unitName: l.product_units.name,
      factor: Number(l.product_units.factor),
      qty: Number(l.qty),
    })),
    (lots ?? []).map(
      (l: any): TicketLot => ({
        id: l.id,
        lotCode: l.lot_code,
        productId: l.product_id,
        locationId: l.location_id,
        locationName: l.locations.name,
        layoutId: l.locations.layout_id,
        receivedAt: l.received_at,
        createdAt: l.created_at,
        expiresAt: l.expires_at,
        onHandBase: Number(l.qty_on_hand_base),
      }),
    ),
    layouts ?? [],
  );
  const showShop = (layouts?.length ?? 0) > 1;
  const customer = (so.customers as unknown as { name: string } | null)?.name;
  const done = so.status !== "draft" && so.status !== "confirmed";

  return (
    <>
      <style>{`@page { size: letter; margin: 0.5in; } @media print { html, body { background: #fff !important; } .page-in { animation: none !important; transform: none !important; } }`}</style>
      <div className="print:hidden">
        <PageHeader title={`Pull ticket · ${so.so_number}`} subtitle="Items grouped by section, A to Z" back={{ href: `/sales/${id}`, label: so.so_number }}>
          <PrintButton />
        </PageHeader>
        {done && (
          <div role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            This order is {so.status}; the ticket shows where its items are in stock now.
          </div>
        )}
      </div>

      <article className="mx-auto max-w-[8.5in] rounded-lg border border-[#d6d3d1] bg-[#ffffff] p-8 text-[#111111] shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none" data-testid="pull-ticket">
        <header className="mb-5 flex items-start justify-between gap-6 border-b-2 border-[#111111] pb-3">
          <div>
            <div className="text-xs font-semibold tracking-wider text-[#57534e] uppercase">Pull ticket</div>
            <h1 className="text-2xl font-bold">{so.so_number}</h1>
            <div className="text-sm">{customer}</div>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 text-right text-sm">
            <dt className="text-[#57534e]">Ships</dt>
            <dd>{date(so.ship_date)}</dd>
            <dt className="text-[#57534e]">Lines</dt>
            <dd>{lines?.length ?? 0}</dd>
            <dt className="text-[#57534e]">Printed</dt>
            <dd>{dateTime(new Date().toISOString())}</dd>
          </dl>
        </header>
        {so.notes && <p className="mb-4 text-sm text-[#44403c]">Note: {so.notes}</p>}

        {!lines?.length && <p className="text-sm text-[#57534e]">This order has no lines yet.</p>}

        {ticket.shops.map((shop) => (
          <section key={shop.id} className="mb-6">
            {showShop && <h2 className="mb-2 text-lg font-bold">{shop.name}</h2>}
            {shop.sections.map((sec) => (
              <div key={sec.name} className="mb-4 break-inside-avoid" data-section={sec.name}>
                <h3 className="mb-1 bg-[#f5f5f4] px-2 py-1 text-sm font-bold tracking-wide uppercase print:bg-[#eeeeee]">{sec.name}</h3>
                <TicketTable rows={sec.rows} />
              </div>
            ))}
          </section>
        ))}

        {ticket.short.length > 0 && (
          <section className="mb-4 break-inside-avoid" data-section="Not in stock">
            <h3 className="mb-1 bg-[#fef3c7] px-2 py-1 text-sm font-bold tracking-wide uppercase">Not in stock</h3>
            <TicketTable rows={ticket.short} short />
          </section>
        )}
      </article>
    </>
  );
}

function TicketTable({ rows, short }: { rows: ReturnType<typeof buildPullTicket>["short"]; short?: boolean }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        <col className="w-8" />
        <col />
        <col className="w-36" />
        <col className="w-44" />
      </colgroup>
      <thead>
        <tr className="border-b border-[#a8a29e] text-left text-xs text-[#57534e]">
          <th className="w-8 py-1" aria-label="Pulled" />
          <th className="py-1">Item</th>
          <th className="py-1">{short ? "" : "Lot"}</th>
          <th className="py-1 text-right">{short ? "Short by" : "Pull"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.lineId}-${r.lotCode ?? ""}-${i}`} className="border-b border-[#e7e5e4] align-top">
            <td className="py-1.5">
              <span className="inline-block h-4 w-4 border-[1.5px] border-[#111111]" aria-hidden="true" />
            </td>
            <td className="py-1.5">
              <div className="font-medium">{r.name}</div>
              <div className="font-mono text-xs text-[#57534e]">{r.sku}</div>
            </td>
            <td className="py-1.5 font-mono text-xs">
              {short ? "" : r.lotCode ?? "—"}
              {r.expiresAt && <div className="font-sans text-[#57534e]">exp {date(r.expiresAt)}</div>}
            </td>
            <td className="py-1.5 text-right font-semibold whitespace-nowrap tabular-nums">{ticketQty(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
