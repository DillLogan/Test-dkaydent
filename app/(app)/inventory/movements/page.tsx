import Link from "next/link";
import { getSession } from "@/lib/auth";
import { dateTime, qty } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

const KINDS: Record<string, string> = {
  receive: "Received",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  sale: "Sold",
  shrink: "Shrink",
  adjust: "Count adjustment",
};

export default async function MovementsPage({ searchParams }: { searchParams: SP }) {
  const { kind } = await searchParams;
  const { supabase } = await getSession();
  let q = supabase
    .from("stock_movements")
    .select("*, lots(lot_code), products(name, base_unit), locations(name), profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (kind && KINDS[kind]) q = q.eq("kind", kind);
  const { data: rows } = await q;

  return (
    <>
      <PageHeader title="Movement log" subtitle="Every change to stock, newest first" back={{ href: "/inventory", label: "Inventory" }} />
      <form className="mb-4 flex gap-2">
        <select name="kind" defaultValue={kind ?? ""} className="input w-auto">
          <option value="">All movements</option>
          {Object.entries(KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>
      {!rows?.length ? (
        <Empty>No movements yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Product</th>
                <th>Lot</th>
                <th>Location</th>
                <th className="num">Qty</th>
                <th>Reference / reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m: any) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{dateTime(m.created_at)}</td>
                  <td>{KINDS[m.kind]}</td>
                  <td>{m.products?.name}</td>
                  <td>
                    <Link href={`/inventory/lots/${m.lot_id}`} className="link font-mono text-xs">
                      {m.lots?.lot_code}
                    </Link>
                  </td>
                  <td>{m.locations?.name}</td>
                  <td className={`num ${Number(m.qty_base) < 0 ? "text-red-700" : "text-brand-700"}`}>
                    {Number(m.qty_base) > 0 ? "+" : ""}
                    {qty(m.qty_base)} {m.products?.base_unit}
                  </td>
                  <td>{[m.reference, m.reason].filter(Boolean).join(" · ")}</td>
                  <td>{m.profiles?.full_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
