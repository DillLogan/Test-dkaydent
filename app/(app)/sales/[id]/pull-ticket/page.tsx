import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { date, dateTime } from "@/lib/format";
import { buildPullTicket, ticketQty, type TicketLot } from "@/lib/pullTicket";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/ui";
import { MustCheck } from "@/components/MustCheck";
import { Barcode } from "@/components/Barcode";
import { loadPrintConfig } from "@/lib/printConfig";

type Props = { params: Promise<{ id: string }> };

export default async function PullTicketPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await getSession();

  const [{ data: so }, { data: lines }, { data: layouts }] = await Promise.all([
    supabase.from("sales_orders").select("id, so_number, status, ship_date, notes, must_check, label_count, customers(name)").eq("id", id).maybeSingle(),
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
  const lotIds = (lots ?? []).map((l: any) => l.id as string);
  const { data: spots } = lotIds.length
    ? await supabase.from("v_lot_spot").select("lot_id, section_name, shelf").in("lot_id", lotIds)
    : { data: [] as { lot_id: string; section_name: string | null; shelf: string | null }[] };
  const spotOf = new Map((spots ?? []).map((s) => [s.lot_id, s]));

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
        section: spotOf.get(l.id)?.section_name ?? null,
        shelf: spotOf.get(l.id)?.shelf ?? null,
      }),
    ),
    layouts ?? [],
  );
  const showShop = (layouts?.length ?? 0) > 1;
  const customer = (so.customers as unknown as { name: string } | null)?.name;
  const pc = await loadPrintConfig(supabase);
  const done = so.status !== "draft" && so.status !== "confirmed";

  return (
    <>
      <style>{`@page { size: letter; margin: 0.5in; } @media print { html, body { background: #fff !important; } html, body, .min-h-screen { min-height: 0 !important; height: auto !important; } .page-in { animation: none !important; transform: none !important; } }`}</style>
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
            <div className="text-xs font-semibold tracking-wider text-[#57534e] uppercase">{pc.header.name} · Pull ticket</div>
            {(pc.header.address || pc.header.phone) && <div className="text-xs text-[#57534e]">{[pc.header.address.replace(/\s*\n\s*/g, ", "), pc.header.phone].filter(Boolean).join(" · ")}</div>}
            <h1 className="text-2xl font-bold">{so.so_number}</h1>
            <div className="text-sm">{customer}</div>
            {pc.pull.showBarcode && <Barcode value={so.so_number} className="mt-2 h-9 w-44" />}
          </div>
          <dl className="ml-auto grid grid-cols-[auto_auto] gap-x-3 text-right text-sm">
            <dt className="text-[#57534e]">Ships</dt>
            <dd>{date(so.ship_date)}</dd>
            <dt className="text-[#57534e]">Lines</dt>
            <dd>{lines?.length ?? 0}</dd>
            <dt className="text-[#57534e]">Printed</dt>
            <dd>{dateTime(new Date().toISOString())}</dd>
          </dl>
          {so.must_check && <MustCheck />}
        </header>
        {pc.pull.showNotes && so.notes && <p className="mb-4 text-sm text-[#44403c]">Note: {so.notes}</p>}

        {!lines?.length && <p className="text-sm text-[#57534e]">This order has no lines yet.</p>}

        {ticket.shops.map((shop) => (
          <section key={shop.id} className="mb-6">
            {showShop && <h2 className="mb-2 text-lg font-bold">{shop.name}</h2>}
            {shop.sections.map((sec) => (
              <div key={sec.name} className="mb-4 break-inside-avoid" data-section={sec.name}>
                <h3 className="mb-1 bg-[#f5f5f4] px-2 py-1 text-sm font-bold tracking-wide uppercase print:bg-[#eeeeee]">{sec.name}</h3>
                <TicketTable rows={sec.rows} pc={pc.pull} />
              </div>
            ))}
          </section>
        ))}

        {ticket.short.length > 0 && (
          <section className="mb-4 break-inside-avoid" data-section="Not in stock">
            <h3 className="mb-1 bg-[#fef3c7] px-2 py-1 text-sm font-bold tracking-wide uppercase">Not in stock</h3>
            <TicketTable rows={ticket.short} short pc={pc.pull} />
          </section>
        )}

        {pc.pull.showLabelLine && (
          <div className="mt-6 flex items-end gap-3 text-sm" data-testid="ticket-labels">
            <span className="font-semibold">Box labels printed:</span>
            <span className="inline-block min-w-16 border-b border-[#111111] text-center">{so.label_count ?? ""}</span>
          </div>
        )}
        <footer className="mt-6 grid break-inside-avoid grid-cols-2 gap-10 text-sm" data-testid="ticket-signatures">
          {["Pulled by", "Packed by"].map((t) => (
            <div key={t}>
              <div className="h-8 border-b border-[#111111]" />
              <div className="mt-1 text-xs font-semibold text-[#57534e]">{t}</div>
            </div>
          ))}
        </footer>
        {pc.header.footer && <p className="mt-4 whitespace-pre-line text-center text-xs text-[#57534e]">{pc.header.footer}</p>}
      </article>
    </>
  );
}

function TicketTable({ rows, short, pc }: { rows: ReturnType<typeof buildPullTicket>["short"]; short?: boolean; pc: { showSku: boolean; showLot: boolean } }) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
    <table className="w-full min-w-[34rem] table-fixed border-collapse text-sm print:min-w-0">
      <colgroup>
        <col className="w-8" />
        <col />
        <col className="w-24" />
        <col className="w-28" />
        <col className="w-36" />
        <col className="w-[4.5rem]" />
        <col className="w-[4.5rem]" />
      </colgroup>
      <thead>
        <tr className="border-b border-[#a8a29e] text-left text-xs text-[#57534e]">
          <th className="w-8 py-1" aria-label="Pulled" />
          <th className="py-1">Item</th>
          <th className="py-1">{short ? "" : "Section · Shelf"}</th>
          <th className="py-1">{short || !pc.showLot ? "" : "Lot"}</th>
          <th className="py-1 text-right">{short ? "Short by" : "Pull"}</th>
          <th className="py-1 pl-3">Pulled</th>
          <th className="py-1 pl-3">Packed</th>
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
              {pc.showSku && <div className="font-mono text-xs text-[#57534e]">{r.sku}</div>}
            </td>
            <td className="py-1.5 text-xs" data-testid="pt-spot">
              {short ? "" : r.section ? (
                <>
                  <div className="font-semibold">{r.section}</div>
                  {r.shelf && <div className="text-[#44403c]">Shelf {r.shelf}</div>}
                </>
              ) : (
                <span className="text-[#a8a29e]">—</span>
              )}
            </td>
            <td className="py-1.5 font-mono text-xs">
              {short || !pc.showLot ? "" : r.lotCode ?? "—"}
              {pc.showLot && r.expiresAt && <div className="font-sans text-[#57534e]">exp {date(r.expiresAt)}</div>}
            </td>
            <td className="py-1.5 text-right font-semibold whitespace-nowrap tabular-nums">{ticketQty(r)}</td>
            <td className="py-1.5 pl-3 align-bottom">
              <span className="block h-5 border-b border-[#57534e]" aria-label="Pulled" />
            </td>
            <td className="py-1.5 pl-3 align-bottom">
              <span className="block h-5 border-b border-[#57534e]" aria-label="Packed" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
