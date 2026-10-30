import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LabelsPdf } from "@/components/pdf/Printout";
import { loadPrintouts } from "@/lib/pdfdocs/load";
import { boxLabels } from "@/lib/pdfdocs/data";
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
  const { templates, business } = await loadPrintouts(supabase, ["boxlabel"]);
  const n = so.label_count ?? 0;
  const labels = boxLabels(business, { customer: c?.name ?? "", address: (so.delivery_address || c?.address || "").trim(), route: c?.route_code, code: so.so_number, count: n });
  return (
    <>
      <PageHeader title={`Box labels · ${so.so_number}`} subtitle={`${c?.name ?? ""} · ${n} box${n === 1 ? "" : "es"}`} back={{ href: `/sales/${id}`, label: so.so_number }} />
      {n === 0 ? <Empty>No labels yet. Enter how many boxes on the order page.</Empty> : <LabelsPdf template={templates.boxlabel} labels={labels} filename={`Box labels ${so.so_number}.pdf`} hideCopies />}
    </>
  );
}
