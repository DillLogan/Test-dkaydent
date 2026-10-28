import { requireRole } from "@/lib/auth";
import { date } from "@/lib/format";
import { remove, setUp, verify } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function LoginsPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, user } = await requireRole("sales");
  const [{ data: accounts }, { data: waiting }, { data: customers }] = await Promise.all([
    supabase.from("portal_accounts").select("*, customers(name)").order("set_up_at", { ascending: false }),
    supabase.from("profiles").select("id, email, full_name, created_at").eq("active", false).neq("role", "customer").order("created_at"),
    supabase.from("customers").select("id, name").eq("active", true).order("name"),
  ]);
  const ids = (accounts ?? []).flatMap((a) => [a.profile_id, a.set_up_by, a.verified_by]).filter(Boolean);
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, email, full_name").in("id", ids) : { data: [] };
  const who = (id: string | null) => {
    const p = (people ?? []).find((x) => x.id === id);
    return p ? p.full_name || p.email : "—";
  };
  const taken = new Set((accounts ?? []).map((a) => a.profile_id));
  const pending = (waiting ?? []).filter((p) => !taken.has(p.id));

  return (
    <>
      <PageHeader
        title="Customer logins"
        subtitle="A customer can shop only after one person sets up their login and a different person verifies it."
      />
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Set up a login">
        <p className="mb-3 text-sm text-stone-500">The customer signs up on the login page first. They appear here, switched off, until you attach them to a customer.</p>
        {pending.length === 0 ? (
          <Empty>No one is waiting for a login.</Empty>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <form key={p.id} action={setUp} className="card flex flex-wrap items-end gap-3">
                <input type="hidden" name="profile_id" value={p.id} />
                <div className="min-w-48 flex-1">
                  <div className="font-medium">{p.full_name || p.email}</div>
                  <div className="text-xs text-stone-500">
                    {p.email} · signed up {date(p.created_at)}
                  </div>
                </div>
                <label>
                  <span className="label">Customer</span>
                  <select name="customer_id" className="input w-auto" required>
                    <option value="">Choose</option>
                    {(customers ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton>Set up</SubmitButton>
              </form>
            ))}
          </div>
        )}
      </Section>

      <Section title="Customer logins">
        {(accounts ?? []).length === 0 ? (
          <Empty>No customer logins yet.</Empty>
        ) : (
          <div className="space-y-2">
            {(accounts ?? []).map((a) => {
              const mine = a.set_up_by === user.id;
              return (
                <div key={a.profile_id} className="card flex flex-wrap items-center gap-3" data-login={a.profile_id}>
                  <div className="min-w-48 flex-1">
                    <div className="font-medium">
                      {who(a.profile_id)} <span className="text-stone-500">for</span> {(a as any).customers?.name}
                    </div>
                    <div className="text-xs text-stone-500">
                      Set up by {who(a.set_up_by)} on {date(a.set_up_at)}
                      {a.verified_by ? ` · verified by ${who(a.verified_by)} on ${date(a.verified_at)}` : ""}
                    </div>
                  </div>
                  {a.verified_by ? (
                    <span className="badge">Active</span>
                  ) : mine ? (
                    <span className="text-sm text-stone-500">Waiting for someone else to verify</span>
                  ) : (
                    <form action={verify}>
                      <input type="hidden" name="profile_id" value={a.profile_id} />
                      <SubmitButton>Verify</SubmitButton>
                    </form>
                  )}
                  <form action={remove}>
                    <input type="hidden" name="profile_id" value={a.profile_id} />
                    <button className="btn">Remove</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
