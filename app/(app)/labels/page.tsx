import Link from "next/link";
import { getSession } from "@/lib/auth";
import { searchTerm } from "@/lib/forms";
import { date, qty } from "@/lib/format";
import { barcodeSvg } from "@/components/Barcode";
import { LabelPrintView } from "@/components/LabelPrintView";
import { Empty, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

type Label = {
  key: string;
  code: string;
  title: string;
  sku: string;
  lines: string[];
};

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const raw = await searchParams;
  // product ids come as ?products=a,b or as repeated ?pid= from the Products list
  const pids = [raw.products, raw.pid]
    .flat()
    .filter(Boolean)
    .flatMap((v) => String(v).split(","))
    .filter(Boolean);
  const sp = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string | undefined>;
  const { supabase } = await getSession();
  const copies = Math.min(50, Math.max(1, Number(sp.copies) || 1));
  let labels: Label[] = [];
  let source = "";
  let back = { href: "/inventory?view=lots", label: "Inventory" };

  if (sp.test) {
    labels = [
      {
        key: "test",
        code: "TEST-LABEL",
        title: "Test label",
        sku: "TEST-LABEL",
        lines: [
          "If this fits the label, the size is right",
          "DKaydent Wholesale",
        ],
      },
    ];
    source = "Test label";
    back = { href: "/settings", label: "Settings" };
  } else if (sp.from === "products" && !pids.length) {
    source = "No products selected";
    back = { href: "/products", label: "Products" };
  } else if (pids.length) {
    const { data } = await supabase
      .from("products")
      .select(
        "id, sku, name, base_unit, category, color, stem_length_cm, grade",
      )
      .in("id", pids);
    const order = new Map(pids.map((id, i) => [id, i]));
    labels = (data ?? [])
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((p) => ({
        key: p.id,
        code: p.sku,
        title: p.name,
        sku: p.sku,
        lines: [
          [
            p.category,
            p.color,
            p.stem_length_cm ? `${p.stem_length_cm}cm` : null,
            p.grade,
          ]
            .filter(Boolean)
            .join(" · "),
          `Sold by ${p.base_unit}`,
        ].filter(Boolean),
      }));
    source = pids.length === 1 ? "Product label" : "Product labels";
    back =
      pids.length === 1
        ? { href: `/products/${pids[0]}`, label: "Product" }
        : { href: "/products", label: "Products" };
  } else {
    let lotIds: string[] | null = null;
    if (sp.lot) {
      lotIds = [sp.lot];
      source = "Lot label";
      back = { href: `/inventory/lots/${sp.lot}`, label: "Lot" };
    } else if (sp.po) {
      const { data: po } = await supabase
        .from("purchase_orders")
        .select("po_number")
        .eq("id", sp.po)
        .single();
      const { data: moves } = await supabase
        .from("stock_movements")
        .select("lot_id")
        .eq("kind", "receive")
        .eq("reference", po?.po_number ?? "-");
      lotIds = (moves ?? []).map((m) => m.lot_id);
      source = `Lots received on ${po?.po_number}`;
      back = {
        href: `/purchasing/${sp.po}`,
        label: po?.po_number ?? "Purchase order",
      };
    }

    let q = supabase.from("v_lot_aging").select("*").order("product_name");
    if (lotIds) {
      q = supabase
        .from("v_lot_aging")
        .select("*")
        .in(
          "lot_id",
          lotIds.length ? lotIds : ["00000000-0000-0000-0000-000000000000"],
        );
    } else {
      const term = searchTerm(sp.q);
      if (term)
        q = q.or(
          `sku.ilike.%${term}%,product_name.ilike.%${term}%,lot_code.ilike.%${term}%`,
        );
      if (sp.location) q = q.eq("location_id", sp.location);
      if (sp.product) q = q.eq("product_id", sp.product);
      if (sp.kind === "flower" || sp.kind === "hard_good")
        q = q.eq("kind", sp.kind);
      source = "Lots on hand (current inventory filter)";
    }
    const { data } = await q.limit(500);

    // A lot that's been fully used up isn't in v_lot_aging; still allow its label
    let rows = data ?? [];
    if (sp.lot && rows.length === 0) {
      const { data: l } = await supabase
        .from("lots")
        .select(
          "id, lot_code, received_at, expires_at, qty_on_hand_base, products(sku, name, base_unit), locations(name)",
        )
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

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Print labels"
          subtitle={`${source} · ${labels.length} label${labels.length === 1 ? "" : "s"}`}
          back={back}
        />
        <p className="mb-4 text-sm text-stone-500">
          Code 128 barcodes. Scan them on the{" "}
          <Link href="/scan" className="link">
            Scan
          </Link>{" "}
          page or into an order&apos;s pick list.
        </p>
      </div>
      {labels.length === 0 ? (
        <Empty>No labels to print.</Empty>
      ) : (
        <LabelPrintView
          labels={labels.map((l) => ({ ...l, svg: barcodeSvg(l.code) }))}
          initialCopies={copies}
        />
      )}
    </>
  );
}
