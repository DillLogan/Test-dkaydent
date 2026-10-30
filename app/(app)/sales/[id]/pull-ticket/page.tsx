import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { date } from "@/lib/format";
import { buildPullTicket, ticketQty, type TicketLot, type TicketRow } from "@/lib/pullTicket";
import { PageHeader } from "@/components/ui";
import { DocPdf } from "@/components/pdf/Printout";
import { loadPrintouts } from "@/lib/pdfdocs/load";
import { pullData } from "@/lib/pdfdocs/data";

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
  const customer = (so.customers as unknown as { name: string } | null)?.name ?? "";
  const { templates, business } = await loadPrintouts(supabase, ["pull"]);
  const done = so.status !== "draft" && so.status !== "confirmed";
  const row = (r: TicketRow) => ({ name: r.name, sku: r.sku, section: r.section, shelf: r.shelf, lot: r.lotCode, exp: r.expiresAt ? date(r.expiresAt) : null, qty: ticketQty(r) });
  const data = pullData({
    business,
    so: { number: so.so_number, customer, ships: so.ship_date ? date(so.ship_date) : "-", lines: lines?.length ?? 0, notes: so.notes, boxes: so.label_count, mustCheck: !!so.must_check },
    groups: ticket.shops.flatMap((shop) => shop.sections.map((sec) => ({ shop: showShop ? shop.name : undefined, location: sec.name, rows: sec.rows.map(row) }))),
    short: ticket.short.map(row),
  });

  return (
    <>
      <PageHeader title={`Pull ticket · ${so.so_number}`} subtitle="A PDF: items grouped by location, section and shelf" back={{ href: `/sales/${id}`, label: so.so_number }} />
      {done && (
        <div role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          This order is {so.status}; the ticket shows where its items are in stock now.
        </div>
      )}
      <DocPdf template={templates.pull} data={data} filename={`Pull ticket ${so.so_number}.pdf`} title={`Pull ticket ${so.so_number}`} />
    </>
  );
}
