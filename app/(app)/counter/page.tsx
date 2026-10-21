import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadCatalog } from "@/lib/catalog";
import { money, qty } from "@/lib/format";
import { loadRequest } from "@/lib/payments";
import {
  cancelTerminalCharge,
  counterCancel,
  counterCheckout,
  counterRetry,
  simulateTerminal,
} from "../payments/actions";
import { CounterRegister, type CounterProduct } from "@/components/CounterRegister";
import { TerminalCharge } from "@/components/TerminalCharge";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function CounterPage({ searchParams }: { searchParams: SP }) {
  const { error, message, sale, charge, done, change } = await searchParams;
  const { supabase, profile } = await getSession();
  const canSell = can(profile, "sales");

  const header = (
    <PageHeader title="Counter sale" subtitle="Ring up walk-in and will-call sales. Take card on a Valor terminal, or cash, check or other.">
      <Link href="/payments" className="btn">
        Payments
      </Link>
    </PageHeader>
  );

  if (!canSell) {
    return (
      <>
        {header}
        <p className="text-sm text-stone-600">Counter sales need the Sales role.</p>
      </>
    );
  }

  // Finished sale: receipt
  const finishedInvoiceId =
    done ??
    (sale
      ? (await supabase.from("invoices").select("id").eq("so_id", sale).neq("status", "void").maybeSingle()).data?.id
      : undefined);
  if (finishedInvoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, invoice_number, total, status, so_id, customers(name)")
      .eq("id", finishedInvoiceId)
      .single();
    const [{ data: lines }, { data: pays }] = await Promise.all([
      supabase.from("sales_order_lines").select("id, qty, unit_price, products(name), product_units(name)").eq("so_id", inv!.so_id).order("created_at"),
      supabase.from("payments").select("id, method, amount, tip, card_brand, card_last4").eq("so_id", inv!.so_id).eq("status", "completed"),
    ]);
    const req = charge ? await loadRequest(supabase, charge) : null;
    return (
      <>
        {header}
        <ErrorBanner error={error} />
        {req && req.message && req.status === "approved" && req.message.startsWith("Paid, but") && <ErrorBanner error={req.message} />}
        <div className="card mx-auto max-w-md space-y-4" data-testid="counter-receipt">
          <div className="text-center">
            <div className="text-xs font-semibold tracking-widest text-brand-700 uppercase">Sale complete</div>
            <div className="text-3xl font-semibold tabular-nums">{money(inv!.total)}</div>
            <div className="text-sm text-stone-500">
              {inv!.invoice_number} · {(inv as any).customers?.name} · {inv!.status === "paid" ? "Paid" : "Balance due"}
            </div>
            {change && <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-lg font-semibold text-amber-900">Change due: {money(change)}</div>}
          </div>
          <ul className="divide-y divide-stone-100 text-sm">
            {(lines ?? []).map((l: any) => (
              <li key={l.id} className="flex justify-between py-1.5">
                <span>
                  {qty(l.qty)} {l.product_units.name} {l.products.name}
                </span>
                <span className="tabular-nums">{money(Number(l.qty) * Number(l.unit_price))}</span>
              </li>
            ))}
          </ul>
          <div className="text-sm text-stone-600">
            {(pays ?? []).map((p) => (
              <div key={p.id}>
                Paid {money(p.amount)} by {p.method}
                {p.card_brand && ` · ${p.card_brand}`}
                {p.card_last4 && ` ••${p.card_last4}`}
                {Number(p.tip) > 0 && ` (+ ${money(p.tip)} tip)`}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/invoices/${inv!.id}`} className="btn">
              Receipt / invoice
            </Link>
            <Link href="/counter" className="btn btn-primary">
              New sale
            </Link>
          </div>
        </div>
      </>
    );
  }

  // Sale waiting on the terminal, or declined
  if (sale) {
    const [{ data: so }, req, { data: terminals }] = await Promise.all([
      supabase.from("sales_orders").select("id, so_number, status, sales_order_lines(qty, unit_price)").eq("id", sale).maybeSingle(),
      charge ? loadRequest(supabase, charge) : Promise.resolve(null),
      supabase.from("payment_terminals").select("id, name, model").eq("active", true).order("name"),
    ]);
    const subtotal = (so?.sales_order_lines ?? []).reduce((t: number, l: any) => t + Number(l.qty) * Number(l.unit_price), 0);
    const back = `/counter?sale=${sale}`;
    return (
      <>
        {header}
        <ErrorBanner error={error} />
        <div className="mx-auto max-w-2xl space-y-4">
          {req && (
            <TerminalCharge
              requestId={req.id}
              initialStatus={req.status as any}
              initialMessage={req.message}
              terminalName={req.payment_terminals?.name ?? "Terminal"}
              amount={money(req.amount)}
              simulated={req.provider === "simulator"}
              startedAt={req.created_at}
              approve={simulateTerminal.bind(null, req.id, "approved", back)}
              decline={simulateTerminal.bind(null, req.id, "declined", back)}
              timeout={simulateTerminal.bind(null, req.id, "timeout", back)}
              cancel={cancelTerminalCharge.bind(null, req.id, back)}
            />
          )}
          {so?.status === "confirmed" && (!req || req.status !== "pending") && (
            <Section title={`${so.so_number} · ${money(subtotal)} before tax`}>
              <form action={counterRetry.bind(null, sale)} className="card space-y-3">
                <p className="text-sm text-stone-600">Nothing has been charged and no stock has been taken yet. Try again, or take another kind of payment.</p>
                <label className="block max-w-40">
                  <span className="label">Sales tax %</span>
                  <input name="tax_rate" type="number" min="0" step="0.001" className="input" defaultValue={req ? Number((req as any).tax_rate ?? 0) : 0} />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {(terminals ?? []).length > 0 && (
                    <>
                      <select name="terminal_id" className="input w-auto" aria-label="Terminal" defaultValue={req?.terminal_id}>
                        {(terminals ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name="tip_entry" defaultChecked={req?.tip_entry} /> Ask for a tip
                      </label>
                      <SubmitButton name="method" value="terminal" pendingText="Sending…">
                        Try terminal again
                      </SubmitButton>
                    </>
                  )}
                  <SubmitButton name="method" value="cash" className="btn" pendingText="…">
                    Paid cash
                  </SubmitButton>
                  <SubmitButton name="method" value="check" className="btn" pendingText="…">
                    Paid by check
                  </SubmitButton>
                </div>
              </form>
              <form action={counterCancel.bind(null, sale)} className="mt-3">
                <SubmitButton className="btn btn-danger" confirm="Cancel this sale?" pendingText="…">
                  Cancel sale
                </SubmitButton>
              </form>
            </Section>
          )}
          {so && !["confirmed", "invoiced"].includes(so.status) && (
            <p className="text-sm text-stone-600">
              This sale is {so.status}.{" "}
              <Link href={`/sales/${so.id}`} className="link">
                Open the order
              </Link>
            </p>
          )}
        </div>
      </>
    );
  }

  // New sale
  const [catalog, { data: images }, { data: lots }, { data: customers }, { data: tiers }, { data: tierPrices }, { data: terminals }] =
    await Promise.all([
      loadCatalog(supabase),
      supabase.from("products").select("id, image_path").eq("active", true),
      supabase.from("lots").select("lot_code, product_id").gt("qty_on_hand_base", 0).limit(5000),
      supabase.from("customers").select("id, name, price_tier_id").eq("active", true).neq("name", "Walk-in").order("name"),
      supabase.from("price_tiers").select("id, markup_pct"),
      supabase.from("tier_prices").select("tier_id, product_unit_id, price"),
      supabase.from("payment_terminals").select("id, name, model").eq("active", true).order("name"),
    ]);
  const img = new Map((images ?? []).map((i) => [i.id, i.image_path]));
  const products: CounterProduct[] = catalog
    .filter((p) => p.units.length)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      base_unit: p.base_unit,
      image_path: img.get(p.id) ?? null,
      onHand: p.onHand,
      avgCost: p.avgCost,
      units: p.units.map((u) => ({ id: u.id, name: u.name, factor: u.factor })),
    }));
  const tp: Record<string, Record<string, number>> = {};
  for (const t of tierPrices ?? []) (tp[t.tier_id] ??= {})[t.product_unit_id] = Number(t.price);

  return (
    <>
      {header}
      <ErrorBanner error={error} />
      <Notice message={message} />
      <CounterRegister
        products={products}
        lotCodes={Object.fromEntries((lots ?? []).map((l) => [l.lot_code.toUpperCase(), l.product_id]))}
        customers={(customers ?? []).map((c) => ({ id: c.id, name: c.name, tier_id: c.price_tier_id }))}
        tiers={(tiers ?? []).map((t) => ({ id: t.id, markup_pct: Number(t.markup_pct) }))}
        tierPrices={tp}
        terminals={terminals ?? []}
        defaultMarkup={35}
        action={counterCheckout}
      />
    </>
  );
}
