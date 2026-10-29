"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { money, qty as fmtQty } from "@/lib/format";
import type { CatalogItem, HistoryOrder } from "@/components/Cart";
import type { CartRow, ShopMe } from "@/lib/shopData";

type Actions = {
  setCartQty: (unitId: string, qty: number, saved?: boolean) => Promise<{ error?: string; available?: number }>;
  saveCartDetails: (payment: string | null, notes: string) => Promise<{ error?: string }>;
  placeOrder: () => Promise<void>;
};
/** Where the shop and cart pages live, and whether a customer or a rep (shopping for a customer) is using them. */
export type ShopMode = { shopHref: string; cartHref: string; rep?: { pullOnline?: () => Promise<{ error?: string }>; onlineCount: number } };
const CUSTOMER: ShopMode = { shopHref: "/shop", cartHref: "/shop/cart" };

const STATUS_WORDS: Record<string, string> = {
  draft: "Waiting for approval",
  confirmed: "Approved, being pulled",
  fulfilled: "Pulled",
  completed: "Checked",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

/** The saved cart, changed optimistically and confirmed by the server (which also checks stock). */
function useCart(initial: CartRow[], actions: Actions) {
  const router = useRouter();
  const [rows, setRows] = useState<CartRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setRows(initial), [initial]);
  function set(unitId: string, qty: number, saved?: boolean) {
    const before = rows;
    setError(null);
    setRows((rs) => {
      const have = rs.find((r) => r.unit_id === unitId);
      if (qty <= 0) return rs.filter((r) => r.unit_id !== unitId);
      if (have) return rs.map((r) => (r.unit_id === unitId ? { ...r, qty, saved: saved ?? r.saved } : r));
      return [...rs, { unit_id: unitId, qty, saved: !!saved, added_at: new Date().toISOString() }];
    });
    start(async () => {
      const r = await actions.setCartQty(unitId, qty, saved);
      if (r.error) {
        setRows(before);
        setError(r.error);
      } else router.refresh();
    });
  }
  return { rows, set, error, setError };
}

function Stepper({ value, onChange, max, label }: { value: number; onChange: (n: number) => void; max?: number | null; label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-stone-200 bg-white" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" className="h-8 w-8 rounded-full text-lg leading-none hover:bg-stone-100" onClick={() => onChange(value - 1)} aria-label={value === 1 ? `Remove ${label}` : `One fewer ${label}`}>
        {value === 1 ? "×" : "−"}
      </button>
      <input
        className="w-12 border-0 bg-transparent text-center text-sm tabular-nums outline-none"
        value={value}
        inputMode="numeric"
        aria-label={`How many ${label}`}
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0);
          if (n > 0) onChange(n);
        }}
      />
      <button type="button" className="h-8 w-8 rounded-full text-lg leading-none hover:bg-stone-100 disabled:opacity-30" onClick={() => onChange(value + 1)} disabled={max !== null && max !== undefined && value >= max} aria-label={`One more ${label}`}>
        +
      </button>
    </span>
  );
}

function CartButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  const [bump, setBump] = useState(false);
  const prev = useRef(count);
  useEffect(() => {
    if (count !== prev.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 450);
      prev.current = count;
      return () => clearTimeout(t);
    }
  }, [count]);
  return (
    <button type="button" onClick={onOpen} className="btn relative" aria-haspopup="dialog" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`} data-testid="cart-button">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="18" cy="20" r="1.5" />
        <path d="M2 3h3l2.5 12.5a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6" />
      </svg>
      Cart
      <span className={`ml-1 inline-flex min-w-6 justify-center rounded-full bg-brand-700 px-1.5 text-xs font-semibold text-white tabular-nums ${bump ? "pop-in" : ""}`} data-testid="cart-count">
        {count}
      </span>
    </button>
  );
}

/** For a rep: the customer has items in their own online cart; pull them into this one. */
function OnlineCart({ mode, name }: { mode: ShopMode; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm" data-testid="online-cart">
      <span className="flex-1">
        {name} has {mode.rep!.onlineCount} item{mode.rep!.onlineCount === 1 ? "" : "s"} in their own online cart.
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await mode.rep!.pullOnline!();
            setMsg(r.error ?? "Added to this cart.");
            router.refresh();
          })
        }
      >
        Add them to this cart
      </button>
      {msg && <span className="text-xs text-stone-600">{msg}</span>}
    </div>
  );
}

const priceFor = (i: CatalogItem, cashPct: number, pay: string | null) => (pay === "cash" && cashPct ? Math.round(i.price * (1 - cashPct / 100) * 100) / 100 : i.price);

/** Shop: browse at your prices, Add saves to the cart on your account, the cart button slides the cart out, Buy again, past orders. */
export function ShopBrowser({ me, catalog, orders, cart, payment, actions, mode = CUSTOMER }: { me: ShopMe; catalog: CatalogItem[]; orders: HistoryOrder[]; cart: CartRow[]; payment: string | null; actions: Actions; mode?: ShopMode }) {
  const c = useCart(cart, actions);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(false); // the cart slide-out, opened only by the cart button
  const byId = useMemo(() => new Map(catalog.map((i) => [i.unit_id, i])), [catalog]);
  const inCart = c.rows.filter((r) => !r.saved && byId.has(r.unit_id));
  const count = inCart.reduce((n, r) => n + r.qty, 0);
  const pay = payment ?? me.default_payment;
  const subtotal = inCart.reduce((n, r) => n + r.qty * priceFor(byId.get(r.unit_id)!, Number(me.cash_discount_pct), pay), 0);
  const cats = useMemo(() => Array.from(new Set(catalog.map((i) => i.category).filter(Boolean) as string[])).sort(), [catalog]);
  const shown = catalog.filter((i) => (!cat || i.category === cat) && (!q || `${i.name} ${i.sku ?? ""} ${i.kind ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  // Buy again: items from past orders that are still sold, most recent first
  const again = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogItem[] = [];
    for (const o of orders) for (const l of o.lines) if (!seen.has(l.unit_id) && byId.has(l.unit_id)) { seen.add(l.unit_id); out.push(byId.get(l.unit_id)!); }
    return out.slice(0, 10);
  }, [orders, byId]);

  function add(i: CatalogItem) {
    const have = c.rows.find((r) => r.unit_id === i.unit_id && !r.saved);
    c.set(i.unit_id, (have?.qty ?? 0) + 1, false);
  }
  const left = (i: CatalogItem) => (i.available === null ? null : Number(i.available));
  const lowNote = (i: CatalogItem) => {
    const n = left(i);
    return n === null ? null : n <= 0 ? <span className="text-red-700">Out of stock</span> : n <= 5 ? <span className="text-amber-700">Only {fmtQty(n)} left</span> : <>{fmtQty(n)} available</>;
  };
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <div data-testid="shop">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50/90 px-4 py-2 backdrop-blur md:-mx-8 md:px-8">
        <input className="input min-w-40 flex-1" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" data-testid="cart-search" />
        <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <CartButton count={count} onOpen={() => setOpen(true)} />
      </div>
      {mode.rep && mode.rep.onlineCount > 0 && <OnlineCart mode={mode} name={me.name} />}
      {c.error && (
        <div role="alert" className="shake mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {c.error}
        </div>
      )}

      {again.length > 0 && !q && !cat && (
        <section className="mb-6" data-testid="buy-again">
          <h2 className="mb-2 text-lg">Buy again</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {again.map((i) => (
              <div key={i.unit_id} className="card w-48 shrink-0 space-y-1 p-3">
                <div className="truncate text-sm font-medium" title={i.name}>
                  {i.name}
                </div>
                <div className="text-xs text-stone-500">per {i.unit}</div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{money(priceFor(i, Number(me.cash_discount_pct), pay))}</span>
                  <button type="button" className="btn btn-sm" onClick={() => add(i)} disabled={(left(i) ?? 1) <= 0}>
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-2" data-testid="cart-items">
        {shown.length === 0 && <p className="card text-sm text-stone-500">No items match.</p>}
        {shown.map((i) => {
          const row = c.rows.find((r) => r.unit_id === i.unit_id && !r.saved);
          const out = (left(i) ?? 1) <= 0;
          return (
            <div key={i.unit_id} className="card flex flex-wrap items-center justify-between gap-3" data-item={i.unit_id}>
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-stone-500">
                  {[i.sku, i.kind, i.category].filter(Boolean).join(" · ")} · per {i.unit} · {lowNote(i)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{money(priceFor(i, Number(me.cash_discount_pct), pay))}</div>
                {i.list_price !== undefined && Number(i.list_price) !== Number(i.price) && (
                  <div className="text-xs text-stone-500">
                    <s>{money(Number(i.list_price))}</s> {i.special ? "your price" : i.discount_pct ? `${i.discount_pct}% off` : ""}
                  </div>
                )}
              </div>
              {row ? (
                <Stepper value={row.qty} max={left(i)} label={i.name} onChange={(n) => c.set(i.unit_id, n)} />
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => add(i)} disabled={out} data-testid="add">
                  {out ? "Out of stock" : "Add to cart"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <section className="mt-8" data-testid="order-history">
        <h2 className="mb-3 text-lg">Your orders</h2>
        {orders.length === 0 && <p className="text-sm text-stone-500">No orders yet.</p>}
        <div className="space-y-2">
          {orders.map((o) => (
            <details key={o.so_number} className="card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {o.so_number} · {o.order_date} · {o.denied_reason ? <b className="text-red-700">Denied: {o.denied_reason}</b> : STATUS_WORDS[o.status] ?? o.status}
                  {o.payment_type ? ` · ${o.payment_type}` : ""}
                </span>
                <span className="font-medium">{money(o.total)}</span>
              </summary>
              <ul className="mt-3 space-y-1 text-sm">
                {o.lines.map((l, k) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span>
                      {fmtQty(l.qty)} × {l.name} ({l.unit})
                    </span>
                    <span>{money(l.unit_price)}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn mt-3"
                onClick={() => {
                  for (const l of o.lines) {
                    const i = byId.get(l.unit_id);
                    if (!i) continue;
                    const have = c.rows.find((r) => r.unit_id === l.unit_id && !r.saved)?.qty ?? 0;
                    const want = Math.min(have + Number(l.qty), left(i) ?? Infinity);
                    if (want > have) c.set(l.unit_id, want, false);
                  }
                }}
              >
                Add these to the cart
              </button>
            </details>
          ))}
        </div>
      </section>

      {/* the cart slides in from the right when the cart button is pressed */}
      <div className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 flex w-[min(400px,92vw)] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-label="Cart"
        aria-hidden={!open}
        data-testid="cart-drawer"
        inert={!open}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <span className="font-semibold">
            Your cart · {count} item{count === 1 ? "" : "s"}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 text-sm">
          {inCart.length === 0 && <p className="py-6 text-center text-stone-500">Your cart is empty.</p>}
          {inCart.map((r) => {
            const i = byId.get(r.unit_id)!;
            return (
              <div key={r.unit_id} className="flex items-center gap-3 border-b border-stone-100 py-3 last:border-0" data-drawer-line={r.unit_id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={i.name}>
                    {i.name}
                  </div>
                  <div className="text-xs text-stone-500">
                    {money(priceFor(i, Number(me.cash_discount_pct), pay))} per {i.unit}
                  </div>
                </div>
                <Stepper value={r.qty} max={left(i)} label={i.name} onChange={(n) => c.set(r.unit_id, n)} />
                <span className="w-20 text-right tabular-nums">{money(r.qty * priceFor(i, Number(me.cash_discount_pct), pay))}</span>
              </div>
            );
          })}
        </div>
        <div className="space-y-2 border-t border-stone-200 px-4 py-4">
          <div className="flex justify-between font-medium">
            <span>Subtotal</span>
            <span className="tabular-nums" data-testid="drawer-subtotal">
              {money(subtotal)}
            </span>
          </div>
          <Link href={mode.cartHref} className={`btn btn-primary w-full ${inCart.length ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!inCart.length} data-testid="view-cart">
            View cart &amp; order summary
          </Link>
          <button type="button" className="btn w-full" onClick={() => setOpen(false)}>
            Keep shopping
          </button>
        </div>
      </aside>
    </div>
  );
}

/** The cart page: change amounts, save for later, and a live order summary they can check and print before placing the order. */
export function CartView({ me, catalog, cart, payment, notes, actions, placed, placedId, error, mode = CUSTOMER }: { me: ShopMe; catalog: CatalogItem[]; cart: CartRow[]; payment: string | null; notes: string; actions: Actions; placed?: string; placedId?: string; error?: string; mode?: ShopMode }) {
  const c = useCart(cart, actions);
  const [pay, setPay] = useState<string>(payment ?? me.default_payment ?? "");
  const [note, setNote] = useState(notes);
  const [placing, startPlace] = useTransition();
  const byId = useMemo(() => new Map(catalog.map((i) => [i.unit_id, i])), [catalog]);
  const active = c.rows.filter((r) => !r.saved);
  const saved = c.rows.filter((r) => r.saved);
  const gone = c.rows.filter((r) => !byId.has(r.unit_id));
  const lines = active.filter((r) => byId.has(r.unit_id)).map((r) => ({ r, i: byId.get(r.unit_id)! }));
  const cashPct = Number(me.cash_discount_pct) || 0;
  const list = lines.reduce((n, { r, i }) => n + r.qty * Number(i.list_price ?? i.price), 0);
  const yours = lines.reduce((n, { r, i }) => n + r.qty * i.price, 0);
  const cashOff = pay === "cash" && cashPct ? Math.round(lines.reduce((n, { r, i }) => n + r.qty * (i.price - priceFor(i, cashPct, "cash")), 0) * 100) / 100 : 0;
  const total = Math.round((yours - cashOff) * 100) / 100;
  const count = lines.reduce((n, { r }) => n + r.qty, 0);
  const short = lines.filter(({ r, i }) => i.available !== null && r.qty > Number(i.available));
  const stamp = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  // keep payment and notes on the cart, so they're there on any device
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => actions.saveCartDetails(pay || null, note), 500);
    return () => clearTimeout(t);
  }, [pay, note]); // eslint-disable-line react-hooks/exhaustive-deps

  if (placed) {
    return (
      <div className="card pop-in mx-auto max-w-lg space-y-3 text-center" data-testid="order-placed">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-700 text-2xl text-white" aria-hidden="true">
          ✓
        </div>
        <h2 className="text-xl">Order placed{placed ? ` · ${placed}` : ""}</h2>
        {mode.rep ? (
          <p className="text-sm text-stone-600">Approved for {me.name}: it is Ready to pull. The invoice comes after delivery.</p>
        ) : (
          <p className="text-sm text-stone-600">
            It has gone to {me.rep ? me.rep : "your sales rep"} for approval. You can follow it under Your orders on the Shop page. The invoice comes after delivery.
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {mode.rep && placedId && (
            <Link href={`/sales/${placedId}`} className="btn btn-primary" data-testid="go-invoice">
              Go to invoice
            </Link>
          )}
          {mode.rep && placedId && (
            <Link href={`/sales/${placedId}/pull-ticket`} className="btn" data-testid="go-pull">
              Pull ticket
            </Link>
          )}
          <Link href={mode.shopHref} className={mode.rep && placedId ? "btn" : "btn btn-primary"}>
            {mode.rep ? `Keep shopping for ${me.name}` : "Keep shopping"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]" data-testid="cart-page">
      <div className="space-y-4">
        {(c.error || error) && (
          <div role="alert" className="shake rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {c.error || error}
          </div>
        )}
        {mode.rep && mode.rep.onlineCount > 0 && <OnlineCart mode={mode} name={me.name} />}
        <section className="card space-y-1 p-0">
          <h2 className="border-b border-stone-200 px-5 py-3 text-lg">{mode.rep ? `Cart for ${me.name}` : "Shopping cart"}</h2>
          {lines.length === 0 && (
            <p className="px-5 py-6 text-sm text-stone-500">
              Your cart is empty.{" "}
              <Link href={mode.shopHref} className="link">
                Find something to add
              </Link>
              .
            </p>
          )}
          <ul className="divide-y divide-stone-100">
            {lines.map(({ r, i }) => (
              <li key={r.unit_id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-cart-line={r.unit_id}>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-stone-500">
                    {money(i.price)} per {i.unit}
                    {i.available !== null && (Number(i.available) <= 0 ? <span className="text-red-700"> · Out of stock now</span> : r.qty > Number(i.available) ? <span className="text-red-700"> · Only {fmtQty(Number(i.available))} left</span> : Number(i.available) <= 5 ? <span className="text-amber-700"> · Only {fmtQty(Number(i.available))} left</span> : null)}
                  </div>
                  <div className="mt-1 flex gap-3 text-xs">
                    <button type="button" className="link" onClick={() => c.set(r.unit_id, r.qty, true)} data-testid="save-later">
                      Save for later
                    </button>
                    <button type="button" className="link text-red-700" onClick={() => c.set(r.unit_id, 0)}>
                      Remove
                    </button>
                  </div>
                </div>
                <Stepper value={r.qty} max={i.available === null ? null : Number(i.available)} label={i.name} onChange={(n) => c.set(r.unit_id, n)} />
                <div className="w-24 text-right font-medium tabular-nums">{money(r.qty * i.price)}</div>
              </li>
            ))}
          </ul>
          {gone.length > 0 && <p className="px-5 py-3 text-xs text-stone-500">{gone.length} item{gone.length === 1 ? " is" : "s are"} no longer sold and won&apos;t be ordered.</p>}
        </section>

        {saved.length > 0 && (
          <section className="card space-y-1 p-0" data-testid="saved-later">
            <h2 className="border-b border-stone-200 px-5 py-3 text-lg">Saved for later ({saved.length})</h2>
            <ul className="divide-y divide-stone-100">
              {saved.map((r) => {
                const i = byId.get(r.unit_id);
                return (
                  <li key={r.unit_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{i?.name ?? "No longer sold"}</div>
                      {i && (
                        <div className="text-xs text-stone-500">
                          {r.qty} × {money(i.price)} per {i.unit}
                        </div>
                      )}
                    </div>
                    {i && (
                      <button type="button" className="btn btn-sm" onClick={() => c.set(r.unit_id, Math.min(r.qty, i.available === null ? r.qty : Math.max(1, Number(i.available))), false)} disabled={i.available !== null && Number(i.available) <= 0} data-testid="move-to-cart">
                        Move to cart
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => c.set(r.unit_id, 0)}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {/* live order summary: the "invoice" they can check while they shop */}
      <aside className="h-fit space-y-3 lg:sticky lg:top-6">
        <section className="card order-summary space-y-3" data-testid="order-summary">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg">Order summary</h2>
              <div className="text-xs text-stone-500">
                {me.name} · {stamp}
              </div>
            </div>
            <button type="button" className="btn btn-sm print:hidden" onClick={() => window.print()} disabled={!lines.length}>
              Print
            </button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {lines.map(({ r, i }) => (
                <tr key={r.unit_id} className="align-top">
                  <td className="py-0.5 pr-2">
                    {r.qty} × {i.name} <span className="text-stone-500">({i.unit})</span>
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{money(r.qty * i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="space-y-1 border-t border-stone-200 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>
                Items ({count})
              </dt>
              <dd className="tabular-nums">{money(list)}</dd>
            </div>
            {list - yours > 0.004 && (
              <div className="flex justify-between text-brand-700">
                <dt>Your prices save</dt>
                <dd className="tabular-nums">−{money(list - yours)}</dd>
              </div>
            )}
            {cashOff > 0 && (
              <div className="flex justify-between text-brand-700">
                <dt>Cash discount ({cashPct}%)</dt>
                <dd className="tabular-nums">−{money(cashOff)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
              <dt>Estimated total</dt>
              <dd className="tabular-nums" data-testid="summary-total">
                {money(total)}
              </dd>
            </div>
            <p className="text-xs text-stone-500">Tax, if any, and delivery are added on the invoice. Prices are checked again when your rep approves the order.</p>
          </dl>
          <div className="space-y-2 print:hidden">
            <label className="block text-sm">
              <span className="label">Pay by</span>
              <select className="input" value={pay} onChange={(e) => setPay(e.target.value)} data-testid="cart-payment">
                <option value="">Choose…</option>
                <option value="cash">Cash{cashPct ? ` (${cashPct}% off)` : ""}</option>
                <option value="card">Card</option>
                <option value="check">Check</option>
              </select>
            </label>
            <textarea className="input" rows={2} placeholder="Notes for this order (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Notes" />
            {short.length > 0 && <p className="text-xs text-red-700">Lower the amounts marked “Only … left” before placing the order.</p>}
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!lines.length || !pay || short.length > 0 || placing}
              onClick={() =>
                startPlace(async () => {
                  await actions.saveCartDetails(pay || null, note);
                  await actions.placeOrder();
                })
              }
              data-testid="place-order"
            >
              {placing ? "Placing order…" : `${mode.rep ? "Place approved order" : "Place order"} · ${money(total)}`}
            </button>
            {!pay && lines.length > 0 && <p className="text-xs text-stone-500">Choose how you&apos;ll pay to place the order.</p>}
            <Link href={mode.shopHref} className="btn w-full">
              Keep shopping
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
