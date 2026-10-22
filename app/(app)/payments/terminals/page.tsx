import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { MODEL_LABEL, TERMINAL_MODELS } from "@/lib/payments";
import { valorConfigured } from "@/lib/valor/provider";
import { saveTerminal, setTerminalActive } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Field, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

function TerminalFields({ t }: { t?: any }) {
  return (
    <>
      <Field label="Name">
        <input name="name" className="input" defaultValue={t?.name ?? ""} placeholder="Front counter" required />
      </Field>
      <Field label="Model">
        <select name="model" className="input" defaultValue={t?.model ?? "VP800"}>
          {TERMINAL_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABEL[m]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="EPI">
        <input name="epi" className="input font-mono" defaultValue={t?.epi ?? ""} placeholder="From the Valor portal" required />
      </Field>
      <Field label="Serial number">
        <input name="serial_no" className="input font-mono" defaultValue={t?.serial_no ?? ""} />
      </Field>
      <Field label="Connection">
        <select name="connection" className="input" defaultValue={t?.connection ?? "cloud"}>
          <option value="cloud">Valor Connect (cloud)</option>
          <option value="lan">Same network (LAN)</option>
        </select>
      </Field>
      <Field label="LAN address (LAN only)">
        <input name="lan_host" className="input font-mono" defaultValue={t?.lan_host ?? ""} placeholder="192.168.1.40" />
      </Field>
    </>
  );
}

export default async function TerminalsPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const isAdmin = can(profile);
  const { data: terminals } = await supabase.from("payment_terminals").select("*").order("active", { ascending: false }).order("name");

  return (
    <>
      <PageHeader
        title="Payment terminals"
        subtitle="Valor devices that can take card payments from the app: VP550, VP800, VL100, VL110, VL500 and VL550."
        back={{ href: "/payments", label: "Payments" }}
      />
      <ErrorBanner error={error} />
      <Notice message={message} />
      {!valorConfigured() && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Running on the simulator. To charge real cards, Valor must enable Valor Connect (cloud) on each terminal in their TMS and give you an
          App ID, App Key and endpoint. Then set VALOR_MODE=live, VALOR_CONNECT_URL, VALOR_APP_ID and VALOR_APP_KEY.
        </div>
      )}

      <Section title="Terminals">
        {!terminals?.length ? (
          <Empty>No terminals yet.</Empty>
        ) : (
          <div className="space-y-3">
            {terminals.map((t) => (
              <div key={t.id} className={`card space-y-3 ${t.active ? "" : "opacity-60"}`}>
                <form action={saveTerminal.bind(null, t.id)}>
                  <fieldset disabled={!isAdmin} className="grid gap-3 sm:grid-cols-3">
                    <TerminalFields t={t} />
                    {isAdmin && (
                      <div className="sm:col-span-3">
                        <SubmitButton className="btn">Save</SubmitButton>
                      </div>
                    )}
                  </fieldset>
                </form>
                {isAdmin && (
                  <form action={setTerminalActive.bind(null, t.id, !t.active)}>
                    <SubmitButton className="btn btn-sm" pendingText="…">
                      {t.active ? "Turn off" : "Turn on"}
                    </SubmitButton>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {isAdmin && (
        <Section title="Add a terminal">
          <form action={saveTerminal.bind(null, null)} className="card grid gap-3 sm:grid-cols-3">
            <TerminalFields />
            <div className="sm:col-span-3">
              <SubmitButton>Add terminal</SubmitButton>
            </div>
          </form>
        </Section>
      )}
    </>
  );
}
