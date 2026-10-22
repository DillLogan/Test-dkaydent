import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, dateTime, money, today } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/payments";
import { valorConfigured } from "@/lib/valor/provider";
import { Empty, ErrorBanner, Notice, PageHeader, Stat, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const { view = "payments", error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const since = addDays(today(), -30);

  const [{ data: pays }, { data: reqs }, { count: terminalCount }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, payment_number, kind, method, amount, tip, status, card_brand, card_last4, reference, received_at, so_id, invoice_id, customers(name), sales_orders(so_number, channel), invoices(invoice_number), payment_terminals(name)")
      .order("received_at", { ascending: false })
      .limit(300),
    view === "terminal"
      ? supabase
          .from("terminal_requests")
          .select("id, purpose, amount, status, message, provider, req_txn_id, created_at, so_id, invoice_id, payment_terminals(name), sales_orders(so_number)")
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("payment_terminals").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const rows = (pays ?? []).filter((p: any) => p.status === "completed");
  const recent = rows.filter((p: any) => p.received_at.slice(0, 10) >= since);
  const byMethod = (m: string) => recent.filter((p: any) => p.method === m).reduce((t: number, p: any) => t + Number(p.amount), 0);
  const tips = recent.reduce((t: number, p: any) => t + Number(p.tip), 0);
  const live = valorConfigured();

  return (
    <>
      <PageHeader title="Payments" subtitle="Card, cash, check and other payments, deposits, and Valor terminal activity">
        {can(profile, "sales") && (
          <>
            <Link href="/payments/import" className="btn">
              Sync terminal sales
            </Link>
            <Link href="/counter" className="btn btn-primary">
              Counter sale
            </Link>
          </>
        )}
        {can(profile) && (
          <Link href="/payments/terminals" className="btn">
            Terminals{terminalCount ? ` (${terminalCount})` : ""}
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />
      <div className={`mb-4 rounded-md border px-4 py-2 text-sm ${live ? "border-brand-100 bg-brand-50 text-brand-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {live
          ? "Valor Connect is live: charges go to your real terminals."
          : "Terminal charges use the built-in simulator until Valor Connect credentials are added (see README → Valor terminals)."}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Card, 30 days" value={money(byMethod("card"))} />
        <Stat label="Cash, 30 days" value={money(byMethod("cash"))} />
        <Stat label="Check, 30 days" value={money(byMethod("check"))} />
        <Stat label="Other, 30 days" value={money(byMethod("other"))} />
        <Stat label="Tips, 30 days" value={money(tips)} hint="not part of sales" />
      </div>

      <Tabs
        current={view}
        items={[
          { key: "payments", label: "Payments", href: "/payments" },
          { key: "terminal", label: "Terminal activity", href: "/payments?view=terminal" },
        ]}
      />

      {view === "payments" &&
        (!(pays ?? []).length ? (
          <Empty>No payments yet. Record them on an invoice or order, or ring up a counter sale.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>When</th>
                  <th>Customer</th>
                  <th>For</th>
                  <th>Method</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(pays ?? []).map((p: any) => (
                  <tr key={p.id} className={p.status === "voided" ? "text-stone-400 line-through" : ""}>
                    <td>
                      {p.payment_number}
                      {p.kind === "deposit" && <div className="text-xs text-stone-500">deposit</div>}
                    </td>
                    <td className="whitespace-nowrap">{dateTime(p.received_at)}</td>
                    <td>{p.customers?.name}</td>
                    <td>
                      {p.invoice_id ? (
                        <Link href={`/invoices/${p.invoice_id}`} className="link">
                          {p.invoices?.invoice_number}
                        </Link>
                      ) : (
                        <Link href={`/sales/${p.so_id}`} className="link">
                          {p.sales_orders?.so_number}
                        </Link>
                      )}
                      {p.sales_orders?.channel !== "order" && <div className="text-xs text-stone-500">{p.sales_orders?.channel} sale</div>}
                    </td>
                    <td>
                      {METHOD_LABEL[p.method]}
                      {p.card_brand && ` · ${p.card_brand}`}
                      {p.card_last4 && ` ••${p.card_last4}`}
                      {p.payment_terminals?.name && <div className="text-xs text-stone-500">{p.payment_terminals.name}</div>}
                      {p.reference && <div className="text-xs text-stone-500">{p.reference}</div>}
                    </td>
                    <td className="num">
                      {money(p.amount)}
                      {Number(p.tip) > 0 && <div className="text-xs text-stone-500">+ {money(p.tip)} tip</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === "terminal" &&
        (!(reqs ?? []).length ? (
          <Empty>Nothing has been sent to a terminal yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Terminal</th>
                  <th>For</th>
                  <th className="num">Amount</th>
                  <th>Result</th>
                  <th>REQ_TXN_ID</th>
                </tr>
              </thead>
              <tbody>
                {(reqs ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dateTime(r.created_at)}</td>
                    <td>
                      {r.payment_terminals?.name}
                      {r.provider === "simulator" && <div className="text-xs text-stone-500">simulator</div>}
                    </td>
                    <td>
                      <Link href={r.invoice_id ? `/invoices/${r.invoice_id}` : `/sales/${r.so_id}`} className="link">
                        {r.sales_orders?.so_number}
                      </Link>
                      <div className="text-xs text-stone-500">{r.purpose}</div>
                    </td>
                    <td className="num">{money(r.amount)}</td>
                    <td>
                      <span className={r.status === "approved" ? "text-brand-700" : r.status === "pending" ? "text-blue-700" : "text-red-700"}>
                        {r.status}
                      </span>
                      {r.message && <div className="text-xs text-stone-500">{r.message}</div>}
                    </td>
                    <td className="font-mono text-xs">{r.req_txn_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}
