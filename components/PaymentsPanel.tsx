import type { SupabaseClient } from "@supabase/supabase-js";
import { dateTime, money } from "@/lib/format";
import { loadRequest, METHOD_LABEL } from "@/lib/payments";
import {
  cancelTerminalCharge,
  recordPayment,
  simulateTerminal,
  startTerminalCharge,
  voidPayment,
} from "@/app/(app)/payments/actions";
import { SubmitButton } from "./SubmitButton";
import { TerminalCharge } from "./TerminalCharge";
import { Field, Section } from "./ui";

/**
 * Payments on an order or invoice: what's been paid, what's due, record a
 * payment by hand, or send it to a Valor terminal. All optional.
 */
export async function PaymentsPanel({
  supabase,
  soId,
  total,
  purpose,
  back,
  canSell,
  open,
  chargeId,
  title = "Payments",
}: {
  supabase: SupabaseClient;
  soId: string;
  total: number;
  purpose: "invoice" | "deposit";
  back: string;
  canSell: boolean;
  open: boolean;
  chargeId?: string;
  title?: string;
}) {
  const [{ data: payments }, { data: terminals }, charge] = await Promise.all([
    supabase
      .from("payments")
      .select("id, payment_number, kind, method, amount, tip, reference, card_brand, card_last4, status, received_at, payment_terminals(name)")
      .eq("so_id", soId)
      .order("received_at"),
    supabase.from("payment_terminals").select("id, name, model").eq("active", true).order("name"),
    chargeId ? loadRequest(supabase, chargeId) : Promise.resolve(null),
  ]);
  const rows = payments ?? [];
  const paid = rows.filter((p) => p.status === "completed").reduce((t, p) => t + Number(p.amount), 0);
  const due = Math.max(0, Math.round((total - paid) * 100) / 100);
  const showCharge = charge && charge.so_id === soId;

  if (!rows.length && !open && !showCharge) return null;

  return (
    <Section title={title}>
      <div className="space-y-3">
        {showCharge && (
          <TerminalCharge
            requestId={charge.id}
            initialStatus={charge.status as any}
            initialMessage={charge.message}
            terminalName={charge.payment_terminals?.name ?? "Terminal"}
            amount={money(charge.amount)}
            simulated={charge.provider === "simulator"}
            startedAt={charge.created_at}
            approve={simulateTerminal.bind(null, charge.id, "approved", back)}
            decline={simulateTerminal.bind(null, charge.id, "declined", back)}
            timeout={simulateTerminal.bind(null, charge.id, "timeout", back)}
            cancel={cancelTerminalCharge.bind(null, charge.id, back)}
          />
        )}

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-stone-100 px-3 py-1">Total {money(total)}</span>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">Paid {money(paid)}</span>
          <span className={`rounded-full px-3 py-1 ${due > 0 ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`} data-testid="balance-due">
            Due {money(due)}
          </span>
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>When</th>
                  <th>Method</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  {canSell && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((p: any) => (
                  <tr key={p.id} className={p.status === "voided" ? "text-stone-400 line-through" : ""}>
                    <td>
                      {p.payment_number}
                      {p.kind === "deposit" && <span className="ml-1 text-xs text-stone-500 no-underline">deposit</span>}
                    </td>
                    <td className="whitespace-nowrap">{dateTime(p.received_at)}</td>
                    <td>
                      {METHOD_LABEL[p.method]}
                      {p.card_brand && ` · ${p.card_brand}`}
                      {p.card_last4 && ` ••${p.card_last4}`}
                      {p.payment_terminals?.name && <div className="text-xs text-stone-500">on {p.payment_terminals.name}</div>}
                      {p.reference && <div className="text-xs text-stone-500">{p.reference}</div>}
                    </td>
                    <td className="num">
                      {money(p.amount)}
                      {Number(p.tip) > 0 && <div className="text-xs text-stone-500">+ {money(p.tip)} tip</div>}
                    </td>
                    <td className="text-xs capitalize">{p.status}</td>
                    {canSell && (
                      <td className="text-right">
                        {p.status === "completed" && (
                          <form action={voidPayment.bind(null, p.id, back)}>
                            <SubmitButton className="btn btn-sm" confirm="Void this payment in the app?" pendingText="…">
                              Void
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canSell && open && due > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            <form action={recordPayment.bind(null, soId, back)} className="card space-y-3">
              <h3 className="font-semibold">{purpose === "deposit" ? "Take a deposit" : "Record a payment"}</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Method">
                  <select name="method" className="input" defaultValue="check">
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="card">Card (taken elsewhere)</option>
                    <option value="other">Other (ACH, wire…)</option>
                  </select>
                </Field>
                <Field label="Amount">
                  <input name="amount" type="number" min="0.01" max={due} step="0.01" className="input" defaultValue={purpose === "deposit" ? "" : due} required />
                </Field>
                <Field label="Reference">
                  <input name="reference" className="input" placeholder="Check #, note" />
                </Field>
              </div>
              <SubmitButton pendingText="Recording…">Record payment</SubmitButton>
            </form>

            <form action={startTerminalCharge.bind(null, soId, purpose, back)} className="card space-y-3">
              <h3 className="font-semibold">Charge on a Valor terminal</h3>
              {!terminals?.length ? (
                <p className="text-sm text-stone-500">No terminals set up. An admin can add them under Payments → Terminals.</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Terminal">
                      <select name="terminal_id" className="input" required>
                        {terminals.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.model})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Amount">
                      <input name="amount" type="number" min="0.01" max={due} step="0.01" className="input" defaultValue={purpose === "deposit" ? "" : due} required />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="tip_entry" /> Ask for a tip on the terminal
                  </label>
                  <SubmitButton pendingText="Sending…">Send to terminal</SubmitButton>
                </>
              )}
            </form>
          </div>
        )}
      </div>
    </Section>
  );
}
