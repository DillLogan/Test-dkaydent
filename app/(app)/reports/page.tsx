import Link from "next/link";
import { getSession } from "@/lib/auth";
import { addDays, date, money, pct, qty, sum, today } from "@/lib/format";
import { Empty, PageHeader, Section, Stat } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

type Agg = { key: string; label: string; sub?: string; qty: number; revenue: number; cost: number; unit?: string };

function group<T>(rows: T[], key: (r: T) => string, init: (r: T) => Agg, add: (a: Agg, r: T) => void) {
  const m = new Map<string, Agg>();
  for (const r of rows) {
    const k = key(r);
    const a = m.get(k) ?? init(r);
    add(a, r);
    m.set(k, a);
  }
  return [...m.values()];
}

const AGE_BUCKETS = [
  { label: "0–2 days", max: 2 },
  { label: "3–5 days", max: 5 },
  { label: "6–10 days", max: 10 },
  { label: "11–30 days", max: 30 },
  { label: "31+ days", max: Infinity },
];

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const to = sp.to ?? today();
  const from = sp.from ?? addDays(to, -29);
  const toExclusive = addDays(to, 1);
  const { supabase } = await getSession();

  const [{ data: sales }, { data: moves }, { data: shrink }, { data: lots }] = await Promise.all([
    supabase.from("v_sales_lines").select("*").gte("fulfilled_at", from).lt("fulfilled_at", toExclusive).limit(10000),
    supabase
      .from("stock_movements")
      .select("product_id, kind, qty_base, products(sku, name, base_unit)")
      .in("kind", ["receive", "sale", "shrink"])
      .gte("created_at", from)
      .lt("created_at", toExclusive)
      .limit(20000),
    supabase.from("v_shrink").select("*").gte("created_at", from).lt("created_at", toExclusive).limit(10000),
    supabase.from("v_lot_aging").select("kind, age_days, value"),
  ]);

  const revenue = sum(sales, (s) => s.revenue);
  const cogs = sum(sales, (s) => s.cost);
  const shrinkValue = sum(shrink, (s) => s.value);
  const invValue = sum(lots, (l) => l.value);

  const byProduct = group(
    sales ?? [],
    (s) => s.product_id,
    (s) => ({ key: s.product_id, label: s.product_name, sub: s.sku, unit: s.base_unit, qty: 0, revenue: 0, cost: 0 }),
    (a, s) => {
      a.qty += Number(s.qty_base);
      a.revenue += Number(s.revenue);
      a.cost += Number(s.cost);
    },
  ).sort((a, b) => b.revenue - a.revenue);

  const byCustomer = group(
    sales ?? [],
    (s) => s.customer_id,
    (s) => ({ key: s.customer_id, label: s.customer_name, qty: 0, revenue: 0, cost: 0 }),
    (a, s) => {
      a.qty += 1;
      a.revenue += Number(s.revenue);
      a.cost += Number(s.cost);
    },
  ).sort((a, b) => b.revenue - a.revenue);

  // Sell-through: sold ÷ received in the period, per product
  const flow = new Map<string, { name: string; sku: string; unit: string; received: number; sold: number; shrunk: number }>();
  for (const m of (moves ?? []) as any[]) {
    const f = flow.get(m.product_id) ?? { name: m.products?.name, sku: m.products?.sku, unit: m.products?.base_unit, received: 0, sold: 0, shrunk: 0 };
    const q = Math.abs(Number(m.qty_base));
    if (m.kind === "receive") f.received += q;
    if (m.kind === "sale") f.sold += q;
    if (m.kind === "shrink") f.shrunk += q;
    flow.set(m.product_id, f);
  }
  const sellThrough = [...flow.entries()].sort((a, b) => b[1].received - a[1].received);

  const shrinkByReason = new Map<string, number>();
  for (const s of shrink ?? []) {
    const reason = (s.reason ?? "Unspecified").split(" — ")[0];
    shrinkByReason.set(reason, (shrinkByReason.get(reason) ?? 0) + Number(s.value));
  }

  const aging = AGE_BUCKETS.map((b, i) => {
    const min = i === 0 ? -Infinity : AGE_BUCKETS[i - 1].max;
    const inBucket = (lots ?? []).filter((l) => l.age_days > min && l.age_days <= b.max);
    return {
      label: b.label,
      flowers: sum(inBucket.filter((l) => l.kind === "flower"), (l) => l.value),
      hard: sum(inBucket.filter((l) => l.kind === "hard_good"), (l) => l.value),
      lots: inBucket.length,
    };
  });

  return (
    <>
      <PageHeader title="Reports" subtitle={`${date(from)} – ${date(to)}`} />

      <form className="mb-6 flex flex-wrap items-end gap-2 print:hidden">
        <label>
          <span className="label">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <button className="btn">Run</button>
        <Link className="btn" href={`/reports?from=${addDays(today(), -6)}&to=${today()}`}>
          Last 7 days
        </Link>
        <Link className="btn" href={`/reports?from=${today().slice(0, 8)}01&to=${today()}`}>
          Month to date
        </Link>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Revenue" value={money(revenue)} hint="fulfilled in period" />
        <Stat label="COGS (FIFO)" value={money(cogs)} />
        <Stat label="Gross margin" value={money(revenue - cogs)} hint={pct(revenue ? (revenue - cogs) / revenue : null)} />
        <Stat label="Shrink" value={money(shrinkValue)} hint={pct(cogs + shrinkValue ? shrinkValue / (cogs + shrinkValue) : null) + " of goods out"} tone={shrinkValue ? "warn" : undefined} />
        <Stat label="Inventory now" value={money(invValue)} />
      </div>

      <Section title="Margin by product">
        {byProduct.length === 0 ? (
          <Empty>No fulfilled sales in this period.</Empty>
        ) : (
          <MarginTable rows={byProduct} qtyLabel="Qty sold" linkBase="/products/" />
        )}
      </Section>

      <Section title="Margin by customer">
        {byCustomer.length === 0 ? (
          <Empty>No fulfilled sales in this period.</Empty>
        ) : (
          <MarginTable rows={byCustomer} qtyLabel="Lines" linkBase="/customers/" />
        )}
      </Section>

      <Section title="Sell-through">
        {sellThrough.length === 0 ? (
          <Empty>No stock movement in this period.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Received</th>
                  <th className="num">Sold</th>
                  <th className="num">Shrink</th>
                  <th className="num">Sell-through</th>
                  <th className="num">Shrink rate</th>
                </tr>
              </thead>
              <tbody>
                {sellThrough.map(([id, f]) => (
                  <tr key={id}>
                    <td>
                      <Link href={`/products/${id}`} className="link">
                        {f.name}
                      </Link>
                      <div className="font-mono text-xs text-stone-500">{f.sku}</div>
                    </td>
                    <td className="num">
                      {qty(f.received)} {f.unit}
                    </td>
                    <td className="num">{qty(f.sold)}</td>
                    <td className="num">{qty(f.shrunk)}</td>
                    <td className="num">{pct(f.received ? f.sold / f.received : null)}</td>
                    <td className={`num ${f.received && f.shrunk / f.received > 0.1 ? "font-medium text-red-700" : ""}`}>
                      {pct(f.received ? f.shrunk / f.received : null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Inventory aging (now)">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Age since receipt</th>
                  <th className="num">Lots</th>
                  <th className="num">Flowers</th>
                  <th className="num">Hard goods</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((a) => (
                  <tr key={a.label}>
                    <td>{a.label}</td>
                    <td className="num">{a.lots}</td>
                    <td className="num">{money(a.flowers)}</td>
                    <td className="num">{money(a.hard)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Shrink by reason">
          {shrinkByReason.size === 0 ? (
            <Empty>No shrink recorded in this period.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th className="num">Value</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {[...shrinkByReason.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, v]) => (
                      <tr key={reason}>
                        <td>{reason}</td>
                        <td className="num">{money(v)}</td>
                        <td className="num">{pct(shrinkValue ? v / shrinkValue : null)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function MarginTable({ rows, qtyLabel, linkBase }: { rows: Agg[]; qtyLabel: string; linkBase: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">{qtyLabel}</th>
            <th className="num">Revenue</th>
            <th className="num">Cost</th>
            <th className="num">Margin</th>
            <th className="num">Margin %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <Link href={`${linkBase}${r.key}`} className="link">
                  {r.label}
                </Link>
                {r.sub && <div className="font-mono text-xs text-stone-500">{r.sub}</div>}
              </td>
              <td className="num">
                {qty(r.qty)} {r.unit ?? ""}
              </td>
              <td className="num">{money(r.revenue)}</td>
              <td className="num">{money(r.cost)}</td>
              <td className="num">{money(r.revenue - r.cost)}</td>
              <td className={`num ${r.revenue && (r.revenue - r.cost) / r.revenue < 0.15 ? "font-medium text-amber-700" : ""}`}>
                {pct(r.revenue ? (r.revenue - r.cost) / r.revenue : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
