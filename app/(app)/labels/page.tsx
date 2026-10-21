import Link from "next/link";
import { getSession } from "@/lib/auth";
import { searchTerm } from "@/lib/forms";
import { date, qty } from "@/lib/format";
import { Barcode } from "@/components/Barcode";
import { PrintButton } from "@/components/PrintButton";
import { Empty, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

type Label = {
  key: string;
  code: string;
  title: string;
  sku: string;
  lines: string[];
};

export default async function LabelsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase } = await getSession();
  const copies = Math.min(10, Math.max(1, Number(sp.copies) || 1));
  let labels: Label[] = [];
  let source = "";
  let back = { href: "/inventory?view=lots", label: "Inventory" };

  if (sp.products) {
    const ids = sp.products.split(",").filter(Boolean);
    const { data } = await supabase.from("products").select("id, sku, name, base_unit, category").in("id", ids);
    labels = (data ?? []).map((p) => ({
      key: p.id,
      code: p.sku,
      title: p.name,
      sku: p.sku,
      lines: [p.category ?? "", `Sold by ${p.base_unit}`].filter(Boolean),
    }));
    source = "Product SKU labels";
    if (ids.length === 1) back = { href: `/products/${ids[0]}`, label: "Product" };
  } else {
    let lotIds: string[] | null = null;
    if (sp.lot) {
      lotIds = [sp.lot];
      source = "Lot label";
      back = { href: `/inventory/lots/${sp.lot}`, label: "Lot" };
    } else if (sp.po) {
      const { data: po } = await supabase.from("purchase_orders").select("po_number").eq("id", sp.po).single();
      const { data: moves } = await supabase.from("stock_movements").select("lot_id").eq("kind", "receive").eq("reference", po?.po_number ?? "-");
      lotIds = (moves ?? []).map((m) => m.lot_id);
      source = `Lots received on ${po?.po_number}`;
      back = { href: `/purchasing/${sp.po}`, label: po?.po_number ?? "Purchase order" };
    }

    let q = supabase.from("v_lot_aging").select("*").order("product_name");
    if (lotIds) {
      q = supabase.from("v_lot_aging").select("*").in("lot_id", lotIds.length ? lotIds : ["00000000-0000-0000-0000-000000000000"]);
    } else {
      const term = searchTerm(sp.q);
      if (term) q = q.or(`sku.ilike.%${term}%,product_name.ilike.%${term}%,lot_code.ilike.%${term}%`);
      if (sp.location) q = q.eq("location_id", sp.location);
      if (sp.product) q = q.eq("product_id", sp.product);
      if (sp.kind === "flower" || sp.kind === "hard_good") q = q.eq("kind", sp.kind);
      source = "Lots on hand (current inventory filter)";
    }
    const { data } = await q.limit(500);

    // A lot that's been fully used up isn't in v_lot_aging; still allow its label
    let rows = data ?? [];
    if (sp.lot && rows.length === 0) {
      const { data: l } = await supabase
        .from("lots")
        .select("id, lot_code, received_at, expires_at, qty_on_hand_base, products(sku, name, base_unit), locations(name)")
        .eq("id", sp.lot)
        .maybeSingle();
      if (l) {
        const lot: any = l;
        rows = [
          {
            lot_id: lot.id,
            lot_code: lot.lot_code,
            sku: lot.products?.sku,
            product_name: lot.products?.name,
            base_unit: lot.products?.base_unit,
            location_name: lot.locations?.name,
            received_at: lot.received_at,
            expires_at: lot.expires_at,
            qty_on_hand_base: lot.qty_on_hand_base,
          },
        ];
      }
    }
    labels = rows.map((l) => ({
      key: l.lot_id,
      code: l.lot_code,
      title: l.product_name,
      sku: l.sku,
      lines: [
        `${qty(l.qty_on_hand_base)} ${l.base_unit} · ${l.location_name}`,
        `Rcvd ${date(l.received_at)}${l.expires_at ? ` · Exp ${date(l.expires_at)}` : ""}`,
      ],
    }));
  }

  const all = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.key}-${i}` })));

  return (
    <>
      <style>{`@media print { @page { margin: 0.35in; } }`}</style>
      <div className="print:hidden">
        <PageHeader title="Print labels" subtitle={`${source} · ${labels.length} label${labels.length === 1 ? "" : "s"}`} back={back}>
          <form className="flex items-center gap-2">
            {Object.entries(sp)
              .filter(([k, v]) => v && k !== "copies")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <label className="text-sm text-stone-600">Copies each</label>
            <select name="copies" defaultValue={String(copies)} className="input w-20">
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <button className="btn">Update</button>
          </form>
          <PrintButton />
        </PageHeader>
        <p className="mb-4 text-sm text-stone-500">
          Code 128 barcodes. Scan them on the <Link href="/scan" className="link">Scan</Link> page or into an order&apos;s pick list. Print on
          plain paper or 3-across label sheets.
        </p>
      </div>

      {all.length === 0 ? (
        <Empty>No labels to print.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-2">
          {all.map((l) => (
            <div
              key={l.key}
              className="lift flex break-inside-avoid flex-col rounded-md border border-[#d6d3d1] bg-[#ffffff] p-3 text-[#1c1917] print:rounded-none print:border-[#a8a29e] print:p-2"
            >
              <div className="truncate text-sm leading-tight font-semibold">{l.title}</div>
              <div className="mb-1 font-mono text-[11px] text-[#78716c]">{l.sku}</div>
              <Barcode value={l.code} className="h-12 w-full" />
              <div className="mt-1 text-center font-mono text-sm font-semibold tracking-wider">{l.code}</div>
              {l.lines.map((line, i) => (
                <div key={i} className="truncate text-[11px] text-[#57534e]">
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
