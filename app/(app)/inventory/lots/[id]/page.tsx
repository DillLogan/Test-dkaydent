import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, dateTime, inUnits, money, qty, today, unitMoney } from "@/lib/format";
import { countLot, shrinkLot, transferLot } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, ExpiryText, Notice, PageHeader, Section } from "@/components/ui";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

const SHRINK_REASONS = ["Spoiled / wilted", "Damaged in handling", "Aged out / dumped", "Broken (hard goods)", "Quality reject", "Other"];

const KIND_LABEL: Record<string, string> = {
  receive: "Received",
  transfer_in: "Transferred in",
  transfer_out: "Transferred out",
  sale: "Sold",
  shrink: "Shrink",
  adjust: "Count adjustment",
};

export default async function LotPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: lot }, { data: movements }, { data: locations }] = await Promise.all([
    supabase
      .from("lots")
      .select("*, products(id, sku, name, base_unit, kind), locations(id, name), purchase_order_lines(po_id, purchase_orders(po_number))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("stock_movements").select("*, locations(name), profiles(full_name)").eq("lot_id", id).order("created_at"),
    supabase.from("locations").select("id, name").eq("active", true).order("name"),
  ]);
  if (!lot) notFound();
  const { data: units } = await supabase
    .from("product_units")
    .select("id, name, factor")
    .eq("product_id", lot.product_id)
    .order("factor");

  const onHand = Number(lot.qty_on_hand_base);
  const base = lot.products.base_unit;
  const canWork = can(profile, "warehouse") && onHand > 0;
  const daysToExpiry = lot.expires_at
    ? Math.round((Date.parse(lot.expires_at) - Date.parse(today())) / 86400000)
    : null;
  const po = lot.purchase_order_lines?.purchase_orders;

  const UnitSelect = () => (
    <select name="unit_id" className="input w-auto" defaultValue={units?.[0]?.id}>
      {(units ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{lot.lot_code}</span>}
        subtitle={
          <>
            <Link href={`/products/${lot.products.id}`} className="link">
              {lot.products.name}
            </Link>{" "}
            · {lot.locations.name}
            {po && (
              <>
                {" "}
                · from{" "}
                <Link href={`/purchasing/${lot.purchase_order_lines.po_id}`} className="link">
                  {po.po_number}
                </Link>
              </>
            )}
          </>
        }
        back={{ href: "/inventory?view=lots", label: "Inventory" }}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card">
          <div className="label">On hand</div>
          <div className="text-xl font-semibold">{inUnits(onHand, units ?? [], base)}</div>
          <div className="text-xs text-stone-500">
            {qty(onHand)} of {qty(lot.qty_received_base)} {base}
          </div>
        </div>
        <div className="card">
          <div className="label">Landed cost</div>
          <div className="text-xl font-semibold">{unitMoney(lot.unit_cost_base)}</div>
          <div className="text-xs text-stone-500">per {base} · value {money(onHand * Number(lot.unit_cost_base))}</div>
        </div>
        <div className="card">
          <div className="label">Received</div>
          <div className="text-xl font-semibold">{date(lot.received_at)}</div>
        </div>
        <div className="card">
          <div className="label">Expires</div>
          <div className="text-xl font-semibold">{date(lot.expires_at)}</div>
          <div className="text-xs">
            <ExpiryText days={daysToExpiry} />
          </div>
        </div>
      </div>

      {canWork && (
        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          <form action={transferLot.bind(null, id)} className="card space-y-3">
            <h3 className="font-semibold">Transfer</h3>
            <div className="flex gap-2">
              <input name="qty" type="number" min="0" step="any" required className="input" placeholder="Qty" />
              <UnitSelect />
            </div>
            <select name="to_location" className="input" required defaultValue="">
              <option value="" disabled>
                To location…
              </option>
              {(locations ?? [])
                .filter((l) => l.id !== lot.location_id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            <SubmitButton className="btn w-full">Move stock</SubmitButton>
          </form>

          <form action={shrinkLot.bind(null, id)} className="card space-y-3">
            <h3 className="font-semibold">Record shrink</h3>
            <div className="flex gap-2">
              <input name="qty" type="number" min="0" step="any" required className="input" placeholder="Qty" />
              <UnitSelect />
            </div>
            <select name="reason" className="input" required>
              {SHRINK_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input name="note" className="input" placeholder="Note (optional)" />
            <SubmitButton className="btn btn-danger w-full">Write off</SubmitButton>
          </form>

          <form action={countLot.bind(null, id)} className="card space-y-3">
            <h3 className="font-semibold">Cycle count</h3>
            <div className="flex gap-2">
              <input name="qty" type="number" min="0" step="any" required className="input" placeholder="Counted" />
              <UnitSelect />
            </div>
            <input name="reason" className="input" placeholder="Reason" defaultValue="Cycle count" required />
            <SubmitButton className="btn w-full">Set counted qty</SubmitButton>
          </form>
        </div>
      )}

      <Section title="History">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Location</th>
                <th className="num">Qty</th>
                <th>Reference / reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {(movements ?? []).map((m: any) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{dateTime(m.created_at)}</td>
                  <td>{KIND_LABEL[m.kind] ?? m.kind}</td>
                  <td>{m.locations?.name}</td>
                  <td className={`num ${Number(m.qty_base) < 0 ? "text-red-700" : "text-brand-700"}`}>
                    {Number(m.qty_base) > 0 ? "+" : ""}
                    {qty(m.qty_base)} {base}
                  </td>
                  <td>{[m.reference, m.reason].filter(Boolean).join(" · ")}</td>
                  <td>{m.profiles?.full_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
