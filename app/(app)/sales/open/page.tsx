import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { approve, deny } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function OpenOrdersPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, user } = await requireRole("sales");
  const { data: orders } = await supabase
    .from("sales_orders")
    .select("id, so_number, created_at, payment_type, notes, customers(name, route_code, rep_id), sales_order_lines(qty, unit_price)")
    .eq("source", "portal")
    .eq("status", "draft")
    .order("created_at");
  const repIds = Array.from(new Set((orders ?? []).map((o: any) => o.customers?.rep_id).filter(Boolean)));
  const { data: reps } = repIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", repIds) : { data: [] };
  const repName = (id: string | null) => {
    const r = (reps ?? []).find((x) => x.id === id);
    return r ? r.full_name || r.email : "No rep assigned";
  };
  const mine = (orders ?? []).filter((o: any) => o.customers?.rep_id === user.id).length;

  return (
    <>
      <PageHeader
        title="Open orders"
        subtitle={`Orders customers sent in, waiting for you. ${mine ? `${mine} belong to your customers.` : ""}`}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />
      {(orders ?? []).length === 0 ? (
        <Empty>No customer orders are waiting.</Empty>
      ) : (
        <div className="space-y-3" data-testid="open-orders">
          {(orders ?? []).map((o: any) => {
            const total = (o.sales_order_lines ?? []).reduce((n: number, l: any) => n + Number(l.qty) * Number(l.unit_price), 0);
            const isMine = o.customers?.rep_id === user.id;
            return (
              <div key={o.id} className="card space-y-3" data-order={o.so_number}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/sales/${o.id}`} className="font-medium text-brand-700">
                      {o.so_number}
                    </Link>{" "}
                    <span className="font-medium">{o.customers?.name}</span>
                    {o.customers?.route_code && <span className="ml-2 rounded border border-stone-300 px-1.5 text-xs">{o.customers.route_code}</span>}
                    <div className="text-xs text-stone-500">
                      Rep: <b data-testid="order-rep">{repName(o.customers?.rep_id)}</b>
                      {isMine && " (you)"} · sent {dateTime(o.created_at)} · pays by {o.payment_type ?? "not chosen"}
                    </div>
                    {o.notes && <div className="mt-1 text-sm">“{o.notes}”</div>}
                  </div>
                  <div className="text-lg font-medium">{money(total)}</div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <form action={approve}>
                    <input type="hidden" name="id" value={o.id} />
                    <SubmitButton>Approve</SubmitButton>
                  </form>
                  <Link href={`/sales/${o.id}`} className="btn">
                    Edit
                  </Link>
                  <form action={deny} className="flex flex-1 flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={o.id} />
                    <input name="reason" className="input min-w-48 flex-1" placeholder="Reason for denying (the customer sees this)" required />
                    <button className="btn">Deny</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
