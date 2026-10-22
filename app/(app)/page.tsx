import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, date, money, pct, qty, sum, today } from "@/lib/format";
import { Empty, ErrorBanner, ExpiryText, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const { error } = await searchParams;
  const { supabase, profile } = await getSession();
  const since = addDays(today(), -30);

  const [lots, stock, openPOs, toFulfill, openInv, sales, inbound] = await Promise.all([
    supabase.from("v_lot_aging").select("lot_id, lot_code, product_name, location_name, qty_on_hand_base, base_unit, value, days_to_expiry"),
    supabase.from("v_product_stock").select("product_id, sku, name, base_unit, qty_on_hand_base, reorder_point_base").eq("active", true),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true }).in("status", ["ordered", "partially_received"]),
    supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    supabase.from("invoices").select("total, due_at").eq("status", "open"),
    supabase.from("v_sales_lines").select("revenue, margin").gte("fulfilled_at", since),
    supabase
      .from("v_shipments")
      .select("id, shipment_number, eta, status, carrier, vendors, value, is_late")
      .in("status", ["planned", "in_transit", "arrived"])
      .lte("eta", addDays(today(), 7))
      .order("eta"),
  ]);
  const inboundRows = inbound.data ?? [];
  const lateShipments = inboundRows.filter((s) => s.is_late);

  const lotRows = lots.data ?? [];
  const stockValue = sum(lotRows, (l) => l.value);
  const expiring = lotRows
    .filter((l) => l.days_to_expiry !== null && l.days_to_expiry <= 3)
    .sort((a, b) => a.days_to_expiry - b.days_to_expiry);
  const low = (stock.data ?? []).filter(
    (p) => Number(p.reorder_point_base) > 0 && Number(p.qty_on_hand_base) <= Number(p.reorder_point_base),
  );
  const invRows = openInv.data ?? [];
  const overdue = invRows.filter((i) => i.due_at < today());
  const revenue = sum(sales.data, (s) => s.revenue);
  const margin = sum(sales.data, (s) => s.margin);

  return (
    <>
      <PageHeader title={`Hello, ${(profile.full_name || "there").split(" ")[0]}`} subtitle="Where things stand today">
        {can(profile, "buyer") && (
          <Link href="/purchasing" className="btn">
            New purchase order
          </Link>
        )}
        {can(profile, "sales") && (
          <Link href="/sales" className="btn btn-primary">
            New sales order
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Inventory value" value={money(stockValue)} hint={`${lotRows.length} lots on hand`} href="/inventory" />
        <Stat
          label="Expiring ≤ 3 days"
          value={expiring.length}
          hint="lots to move or dump"
          href="/inventory?view=lots&sort=expiry"
          tone={expiring.length ? "warn" : undefined}
        />
        <Stat label="Open purchase orders" value={openPOs.count ?? 0} hint="awaiting receipt" href="/purchasing?status=open" />
        <Stat
          label="Shipments this week"
          value={inboundRows.length - lateShipments.length}
          hint={lateShipments.length ? `${lateShipments.length} late` : "due in the next 7 days"}
          href={lateShipments.length ? "/receiving?view=list&status=late" : "/receiving"}
          tone={lateShipments.length ? "bad" : undefined}
        />
        <Stat label="Orders to fulfill" value={toFulfill.count ?? 0} hint="confirmed, not pulled" href="/sales?status=confirmed" />
        <Stat label="Revenue, 30 days" value={money(revenue)} hint={`Gross margin ${pct(revenue ? margin / revenue : null)}`} href="/reports" />
        <Stat label="Gross profit, 30 days" value={money(margin)} href="/reports" />
        <Stat label="Open invoices" value={money(sum(invRows, (i) => i.total))} hint={`${invRows.length} unpaid`} href="/invoices?status=open" />
        <Stat
          label="Overdue invoices"
          value={money(sum(overdue, (i) => i.total))}
          hint={`${overdue.length} past due`}
          href="/invoices?status=overdue"
          tone={overdue.length ? "bad" : undefined}
        />
      </div>

      {inboundRows.length > 0 && (
        <Section title="Incoming shipments" actions={<Link href="/receiving" className="btn">Receiving</Link>}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>ETA</th>
                  <th>Vendors</th>
                  <th className="num">Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {inboundRows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/receiving/${s.id}`} className="link">
                        {s.shipment_number}
                      </Link>
                      {s.carrier && <div className="text-xs text-stone-500">{s.carrier}</div>}
                    </td>
                    <td className={s.is_late ? "font-medium text-red-700" : ""}>
                      {date(s.eta)}
                      {s.is_late && " · late"}
                    </td>
                    <td>{s.vendors || "—"}</td>
                    <td className="num">{money(s.value)}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Expiring soon">
          {expiring.length === 0 ? (
            <Empty>Nothing expires in the next 3 days.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Product</th>
                    <th className="num">On hand</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.slice(0, 10).map((l) => (
                    <tr key={l.lot_id}>
                      <td>
                        <Link href={`/inventory/lots/${l.lot_id}`} className="link">
                          {l.lot_code}
                        </Link>
                        <div className="text-xs text-stone-500">{l.location_name}</div>
                      </td>
                      <td>{l.product_name}</td>
                      <td className="num">
                        {qty(l.qty_on_hand_base)} {l.base_unit}
                      </td>
                      <td>
                        <ExpiryText days={l.days_to_expiry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="At or below reorder point">
          {low.length === 0 ? (
            <Empty>All products are above their reorder points.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">On hand</th>
                    <th className="num">Reorder at</th>
                  </tr>
                </thead>
                <tbody>
                  {low.slice(0, 10).map((p) => (
                    <tr key={p.product_id}>
                      <td>
                        <Link href={`/products/${p.product_id}`} className="link">
                          {p.name}
                        </Link>
                        <div className="text-xs text-stone-500">{p.sku}</div>
                      </td>
                      <td className="num">
                        {qty(p.qty_on_hand_base)} {p.base_unit}
                      </td>
                      <td className="num">{qty(p.reorder_point_base)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
