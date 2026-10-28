import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { barcodeSvg } from "@/components/Barcode";
import { LabelPrintView, type PrintLabel } from "@/components/LabelPrintView";
import { loadPrintConfig } from "@/lib/printConfig";
import { Empty, PageHeader } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

/** One label per box: shop name, ship-to address, route and "Box x of y", with the order's barcode. */
export default async function BoxLabelsPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await getSession();
  const { data: so } = await supabase
    .from("sales_orders")
    .select("id, so_number, label_count, delivery_address, customers(name, address, route_code)")
    .eq("id", id)
    .maybeSingle();
  if (!so) notFound();
  const c = so.customers as unknown as { name: string; address: string | null; route_code: string | null } | null;
  const pc = await loadPrintConfig(supabase);
  const n = so.label_count ?? 0;
  const addr = pc.labels.showAddress ? (so.delivery_address || c?.address || "").replace(/\s*\n\s*/g, ", ") : "";
  const svg = barcodeSvg(so.so_number);
  const labels: PrintLabel[] = Array.from({ length: n }, (_, i) => {
    const box = `Box ${i + 1} of ${n}`;
    const route = pc.labels.showRoute && c?.route_code ? ` · ${c.route_code}` : "";
    return {
      key: `${so.id}-${i + 1}`,
      code: so.so_number,
      title: c?.name ?? "",
      sku: c?.route_code ?? so.so_number,
      lines: [`${box}${route}`, addr].filter(Boolean),
      short: `${box}${route}${addr ? ` · ${addr}` : ""}`,
      svg,
    };
  });
  return (
    <>
      <div className="print:hidden">
        <PageHeader title={`Box labels · ${so.so_number}`} subtitle={`${c?.name ?? ""} · ${n} box${n === 1 ? "" : "es"}`} back={{ href: `/sales/${id}`, label: so.so_number }} />
      </div>
      {n === 0 ? <Empty>No labels yet. Enter how many boxes on the order page.</Empty> : <LabelPrintView labels={labels} initialCopies={1} hideCopies />}
    </>
  );
}
