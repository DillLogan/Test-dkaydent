import { requireRole } from "@/lib/auth";
import { date } from "@/lib/format";
import { createLogin, decideReset, remove, resetPassword, setUp, verify } from "./actions";
import { usernameOf } from "@/lib/username";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function LoginsPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, user } = await requireRole("sales");
  const [{ data: accounts }, { data: waiting }, { data: customers }, { data: resets }] = await Promise.all([
    supabase.from("portal_accounts").select("*, customers(name)").order("set_up_at", { ascending: false }),
    supabase.from("profiles").select("id, email, full_name, created_at").eq("active", false).neq("role", "customer").order("created_at"),
    supabase.from("customers").select("id, name").eq("active", true).order("name"),
    supabase.from("password_requests").select("id, requested_at, profiles!password_requests_profile_id_fkey(full_name, email), customers(name)").eq("status", "pending").order("requested_at"),
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

      {(resets ?? []).length > 0 && (
        <Section title="Password reset requests">
          <div className="space-y-2" data-testid="reset-requests">
            {(resets ?? []).map((r: any) => (
              <form key={r.id} action={decideReset} className="card flex flex-wrap items-center gap-3">
                <input type="hidden" name="id" value={r.id} />
                <div className="min-w-48 flex-1">
                  <div className="font-medium">
                    {r.profiles?.full_name || usernameOf(r.profiles?.email)} <span className="text-stone-500">for</span> {r.customers?.name}
                  </div>
                  <div className="text-xs text-stone-500">Asked {date(r.requested_at)}. After you approve, they choose a new password on the sign-in page.</div>
                </div>
                <button className="btn btn-primary" name="approve" value="1">Approve</button>
                <button className="btn" name="approve" value="0">Deny</button>
              </form>
            ))}
          </div>
        </Section>
      )}

      <Section title="Create a customer login">
        <form action={createLogin} className="card grid gap-3 sm:grid-cols-6" data-testid="create-login">
          <label className="sm:col-span-3">
            <span className="label">Customer</span>
            <select name="customer_id" className="input" required>
              <option value="">Choose</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-3">
            <span className="label">Person&apos;s name</span>
            <input name="full_name" className="input" required />
          </label>
          <label className="sm:col-span-3">
            <span className="label">Username</span>
            <input name="username" className="input" required autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" title="3 to 30 letters, numbers, dots, dashes or underscores" />
          </label>
          <label className="sm:col-span-3">
            <span className="label">Password (give it to the customer)</span>
            <input name="password" type="text" className="input" required minLength={8} autoComplete="off" />
          </label>
          <div className="sm:col-span-6">
            <SubmitButton>Create login</SubmitButton>
            <p className="mt-2 text-xs text-stone-500">The customer account needs a route, address, phone and sales rep first. A different person then verifies the login before it works.</p>
          </div>
        </form>
      </Section>

      <Section title="Set up someone who already has a login">
        <p className="mb-3 text-sm text-stone-500">People who signed up themselves wait here, switched off, until you attach them to a customer.</p>
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
                      {who(a.profile_id)} <span className="font-mono text-xs text-stone-500">({usernameOf((people ?? []).find((x) => x.id === a.profile_id)?.email)})</span> <span className="text-stone-500">for</span> {(a as any).customers?.name}
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
                  <form action={resetPassword} className="flex gap-1">
                    <input type="hidden" name="profile_id" value={a.profile_id} />
                    <input name="password" type="text" minLength={8} className="input w-36" placeholder="New password" required autoComplete="off" aria-label="New password" />
                    <button className="btn">Set</button>
                  </form>
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
