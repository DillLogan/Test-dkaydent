import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { date, dateTime, inUnits, money, qty, today, unitMoney } from "@/lib/format";
import { countLot, setLotSpot, shrinkLot, transferLot } from "../../actions";
import { spotOptions, spotText } from "@/lib/spots";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, ExpiryText, Notice, PageHeader, Section } from "@/components/ui";
import { PhotoUpload } from "@/components/PhotoUpload";
import { MiniMap } from "@/components/MiniMap";
import { VendorReturn } from "@/components/VendorReturn";
import { imageUrl } from "@/lib/images";
import { loadPlan } from "@/lib/plan";
import { removeLotPhoto, uploadLotPhoto } from "../../../photos/actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

const SHRINK_REASONS = ["Spoiled / wilted", "Damaged in handling", "Aged out / dumped", "Broken (hard goods)", "Quality reject", "Other"];

const KIND_LABEL: Record<string, string> = {
  receive: "Received",
  transfer_in: "Transferred in",
  transfer_out: "Transferred out",
  sale: "Sold",
  shrink: "Shrink",
  adjust: "Count adjustment",
  return: "Customer return",
};

export default async function LotPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: lot }, { data: movements }, { data: locations }] = await Promise.all([
    supabase
      .from("lots")
      .select("*, products(id, sku, name, base_unit, kind, image_path, product_homes(layout_id, location_id)), locations(id, name, layout_id), purchase_order_lines(po_id, qty, product_units(name), purchase_orders(po_number, vendors(name, email, contact_name)))")
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
  const vendor = (po as any)?.vendors as { name: string; email: string | null; contact_name: string | null } | null | undefined;
  const pol = lot.purchase_order_lines as any;
  const [{ data: sections }, { data: spot }] = await Promise.all([
    supabase.from("location_sections").select("id, name, shelves").eq("location_id", lot.location_id).order("name"),
    supabase.from("v_lot_spot").select("section_name, shelf, spot_from").eq("lot_id", id).maybeSingle(),
  ]);
  const spotChoices = spotOptions(sections ?? []);
  const spotNow = lot.section_id ? `${lot.section_id}::${lot.shelf ?? ""}` : "";
  const plan = await loadPlan(supabase, lot.locations.layout_id);
  const home =
    ((lot.products.product_homes ?? []) as { layout_id: string; location_id: string }[]).find((h) => h.layout_id === plan.layout.id)
      ?.location_id ?? null;
  const lotMarks: Record<string, "home" | "here" | "both"> = { [lot.location_id]: home === lot.location_id ? "both" : "here" };
  if (home && home !== lot.location_id) lotMarks[home] = "home";
  const homeName = plan.locations.find((l) => l.id === home)?.name;
  const canPhoto = can(profile, "buyer", "warehouse");

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
        title={<span className="tabular-nums">{lot.lot_code}</span>}
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
      >
        <Link href={`/labels?lot=${id}`} className="btn">
          Print label
        </Link>
      </PageHeader>
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

      <Section title="Section and shelf">
        <div className="card space-y-3" data-testid="lot-spot">
          <p className="text-sm">
            {spot?.section_name ? (
              <>
                <b>{spotText(spot.section_name, spot.shelf)}</b> in {lot.locations.name}
                {spot.spot_from === "home" && <span className="text-stone-500"> (the item&apos;s usual spot; this stock has none of its own)</span>}
              </>
            ) : (
              <span className="text-stone-500">Not recorded. Pull tickets show only {lot.locations.name} for this stock.</span>
            )}
          </p>
          {can(profile, "warehouse") &&
            (spotChoices.length ? (
              <form action={setLotSpot.bind(null, id)} className="flex flex-wrap items-end gap-2">
                <label>
                  <span className="label">Where this stock sits</span>
                  <select name="spot" className="input w-auto" defaultValue={spotNow}>
                    <option value="">Not set</option>
                    {spotChoices.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton>Save</SubmitButton>
              </form>
            ) : (
              <p className="text-xs text-stone-500">
                {lot.locations.name} has no sections yet. Add them on{" "}
                <Link href={`/floor-plan?layout=${lot.locations.layout_id}`} className="link">
                  Location in shop
                </Link>
                .
              </p>
            ))}
        </div>
      </Section>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Section title="Delivery photo">
          <PhotoUpload
            current={imageUrl(lot.image_path)}
            alt={`Lot ${lot.lot_code}`}
            label="photo"
            canEdit={canPhoto}
            upload={uploadLotPhoto.bind(null, id)}
            remove={removeLotPhoto.bind(null, id)}
          />
          {!lot.image_path && lot.products.image_path && (
            <p className="mt-2 text-xs text-stone-500">Lists show the item&apos;s main photo until a delivery photo is added.</p>
          )}
        </Section>
        <Section title="Location in shop">
          <MiniMap
            aspect={plan.layout.aspect}
            background={plan.layout.background}
            areas={plan.areas}
            marks={lotMarks}
            href={`/floor-plan?layout=${plan.layout.id}`}
            caption={
              <>
                This lot is in <b>{lot.locations.name}</b>
                {plan.layouts.length > 1 ? ` (${plan.layout.name})` : ""}.{" "}
                {homeName && home !== lot.location_id ? (
                  <span className="font-medium text-amber-700">Its home area is {homeName} (pulsing).</span>
                ) : homeName ? (
                  "That's its home area."
                ) : (
                  "The item has no home area yet."
                )}
              </>
            }
          />
        </Section>
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

      <Section title="Return to vendor">
        <VendorReturn
          info={{
            lotCode: lot.lot_code,
            product: lot.products.name,
            sku: lot.products.sku,
            qtyReceived: `${inUnits(Number(lot.qty_received_base), units ?? [], base)} (${qty(lot.qty_received_base)} ${base})`,
            cost: `${unitMoney(lot.unit_cost_base)} per ${base}`,
            receivedOn: date(lot.received_at),
            expiresOn: lot.expires_at ? date(lot.expires_at) : "",
            po: po?.po_number ?? null,
            poLine: pol ? `${qty(pol.qty)} ${pol.product_units?.name ?? ""}` : null,
            vendor: vendor?.name ?? null,
            vendorEmail: vendor?.email ?? null,
            contact: vendor?.contact_name ?? null,
          }}
        />
      </Section>

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
