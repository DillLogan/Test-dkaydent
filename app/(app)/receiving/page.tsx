import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, date, money, today, oneYearFrom } from "@/lib/format";
import { createShipment } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section, StatusBadge, Tabs } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

const STATUS_FILTERS: Record<string, string[] | null> = {
  open: ["planned", "in_transit", "arrived"],
  late: ["planned", "in_transit"],
  received: ["received"],
  cancelled: ["cancelled"],
  all: null,
};

const CHIP: Record<string, string> = {
  planned: "border-stone-300 bg-white text-stone-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-800",
  arrived: "border-amber-200 bg-amber-50 text-amber-900",
  received: "border-brand-100 bg-brand-50 text-brand-800",
  cancelled: "border-stone-200 bg-stone-50 text-stone-400 line-through",
};

/** Monday of the week that contains ymd. */
function weekStart(ymd: string) {
  const d = new Date(ymd + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}
const monthKey = (ymd: string) => ymd.slice(0, 7);
const monthLabel = (key: string) =>
  new Date(key + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = (ymd: string) =>
  new Date(ymd + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function ReceivingPage({ searchParams }: { searchParams: SP }) {
  const { view = "plan", status = "open", error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const canPlan = can(profile, "buyer", "warehouse");
  const now = today();
  const horizon = oneYearFrom(now);

  // Roll standing orders forward so the next 12 months are always planned.
  if (can(profile, "buyer")) await supabase.rpc("generate_standing_orders");

  const base = supabase.from("v_shipments").select("*").order("eta").order("shipment_number");
  const [{ data: all }, { data: openPOs }, { count: standingCount }] = await Promise.all([
    view === "list"
      ? (() => {
          let q = base.limit(500);
          const st = STATUS_FILTERS[status] ?? null;
          if (st) q = q.in("status", st);
          if (status === "late") q = q.lt("eta", now);
          return q;
        })()
      : base.gte("eta", weekStart(now)).lte("eta", horizon).neq("status", "cancelled").limit(1000),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, expected_date, vendors(name)")
      .is("shipment_id", null)
      .in("status", ["draft", "ordered", "partially_received"])
      .order("expected_date", { nullsFirst: false })
      .limit(200),
    supabase.from("standing_orders").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const shipments = all ?? [];
  const { data: lateRows } = await supabase.from("v_shipments").select("id").eq("is_late", true);
  const lateCount = lateRows?.length ?? 0;

  // Calendar: weeks grouped by month, from this week to 12 months out
  const weeks: { start: string; items: any[] }[] = [];
  if (view === "plan") {
    for (let w = weekStart(now); w <= horizon; w = addDays(w, 7)) weeks.push({ start: w, items: [] });
    // anything late (before this week) is shown in the first week
    for (const s of shipments) {
      const i = Math.max(0, Math.floor((Date.parse(s.eta) - Date.parse(weeks[0].start)) / (7 * 864e5)));
      weeks[Math.min(i, weeks.length - 1)]?.items.push(s);
    }
    const { data: late } = await supabase.from("v_shipments").select("*").eq("is_late", true).lt("eta", weeks[0].start);
    weeks[0].items.unshift(...(late ?? []));
  }
  const byMonth = new Map<string, typeof weeks>();
  for (const w of weeks) {
    const k = monthKey(w.start < now ? now : w.start);
    byMonth.set(k, [...(byMonth.get(k) ?? []), w]);
  }

  const tabs = [
    { key: "plan", label: "12-month plan", href: "/receiving" },
    { key: "list", label: "All shipments", href: "/receiving?view=list" },
    ...(canPlan ? [{ key: "new", label: "Plan a shipment", href: "/receiving?view=new" }] : []),
  ];

  return (
    <>
      <PageHeader title="Receiving" subtitle="Incoming shipments, planned up to a year out, received all at once when they land">
        <Link href="/receiving/standing" className="btn">
          Standing orders{standingCount ? ` (${standingCount})` : ""}
        </Link>
        {canPlan && (
          <Link href="/receiving?view=new" className="btn btn-primary">
            Plan a shipment
          </Link>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />
      {lateCount > 0 && (
        <div role="status" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {lateCount} shipment{lateCount === 1 ? " is" : "s are"} past {lateCount === 1 ? "its" : "their"} ETA and not received.{" "}
          <Link href="/receiving?view=list&status=late" className="font-medium underline">
            Show late
          </Link>
        </div>
      )}
      <Tabs items={tabs} current={view} />

      {view === "plan" && (
        <div className="space-y-6">
          {[...byMonth.entries()].map(([k, ws]) => {
            const count = ws.reduce((n, w) => n + w.items.length, 0);
            const value = ws.reduce((n, w) => n + w.items.reduce((m, s) => m + Number(s.value), 0), 0);
            return (
              <section key={k}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">{monthLabel(k)}</h2>
                  <span className="text-xs text-stone-500">
                    {count} shipment{count === 1 ? "" : "s"} · {money(value)}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                  {ws.map((w) => (
                    <div key={w.start} className="flex flex-col gap-2 border-b border-stone-100 px-3 py-2 last:border-b-0 sm:flex-row sm:items-start">
                      <div className="w-28 shrink-0 pt-1 text-xs text-stone-500">
                        Week of {shortDay(w.start)}
                        {w.start === weekStart(now) && <span className="ml-1 font-semibold text-brand-700">· now</span>}
                      </div>
                      <div className="flex min-h-7 flex-1 flex-wrap gap-1.5">
                        {w.items.length === 0 && <span className="pt-1 text-xs text-stone-300">—</span>}
                        {w.items.map((s) => (
                          <Link
                            key={s.id}
                            href={`/receiving/${s.id}`}
                            className={`lift inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                              s.is_late ? "border-red-300 bg-red-50 text-red-800" : CHIP[s.status]
                            }`}
                            title={`${s.shipment_number} · ${s.status.replace("_", " ")}`}
                          >
                            <span className="font-medium">{shortDay(s.eta)}</span>
                            <span className="max-w-40 truncate">{s.vendors || "No POs yet"}</span>
                            {s.standing && <span title="From a standing order">↻</span>}
                            {s.is_late && <span className="font-semibold">late</span>}
                            <span className="text-stone-500 tabular-nums">{money(s.value)}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          <p className="text-xs text-stone-500">↻ planned by a standing order. Cancelled shipments are hidden here; see All shipments.</p>
        </div>
      )}

      {view === "list" && (
        <>
          <Tabs
            current={status}
            items={["open", "late", "received", "cancelled", "all"].map((k) => ({
              key: k,
              label: k[0].toUpperCase() + k.slice(1),
              href: `/receiving?view=list&status=${k}`,
            }))}
          />
          {shipments.length === 0 ? (
            <Empty>No shipments here.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th>ETA</th>
                    <th>Vendors</th>
                    <th>Carrier / tracking</th>
                    <th className="num">POs</th>
                    <th className="num">Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/receiving/${s.id}`} className="link">
                          {s.shipment_number}
                        </Link>
                        {s.standing && <span className="ml-1 text-stone-400" title="From a standing order">↻</span>}
                      </td>
                      <td className={s.is_late ? "font-medium text-red-700" : ""}>
                        {date(s.eta)}
                        {s.is_late && <div className="text-xs">late</div>}
                      </td>
                      <td>{s.vendors || <span className="text-stone-400">—</span>}</td>
                      <td>
                        {s.carrier || "—"}
                        {s.tracking && <div className="font-mono text-xs text-stone-500">{s.tracking}</div>}
                      </td>
                      <td className="num">{s.po_count}</td>
                      <td className="num">{money(s.value)}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view === "new" && canPlan && (
        <Section title="Plan a shipment">
          <form action={createShipment} className="card space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="ETA">
                <input name="eta" type="date" className="input" min={addDays(now, -30)} max={horizon} required defaultValue={addDays(now, 7)} />
                <span className="mt-1 block text-xs text-stone-500">Up to one year out ({date(horizon)})</span>
              </Field>
              <Field label="Carrier">
                <input name="carrier" className="input" placeholder="e.g. LATAM Cargo, FedEx" />
              </Field>
              <Field label="AWB / tracking">
                <input name="tracking" className="input font-mono" placeholder="045-1234 5678" />
              </Field>
              <Field label="Notes" className="sm:col-span-3">
                <textarea name="notes" rows={2} className="input" />
              </Field>
            </div>
            <div>
              <div className="label">Purchase orders on this shipment</div>
              {!openPOs?.length ? (
                <p className="text-sm text-stone-500">
                  No open purchase orders without a shipment. You can plan the shipment now and add POs later.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {openPOs.map((po: any) => (
                    <label key={po.id} className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50">
                      <input type="checkbox" name="po_id" value={po.id} />
                      <span className="font-medium">{po.po_number}</span>
                      <span className="truncate text-stone-600">{po.vendors?.name}</span>
                      <span className="ml-auto flex items-center gap-2 text-xs text-stone-500">
                        {po.expected_date && date(po.expected_date)} <StatusBadge status={po.status} />
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <SubmitButton pendingText="Planning…">Plan shipment</SubmitButton>
          </form>
        </Section>
      )}
    </>
  );
}
