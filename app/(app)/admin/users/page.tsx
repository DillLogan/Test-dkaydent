import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { date } from "@/lib/format";
import { updateUser } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, StatusBadge } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, user } = await requireRole();
  const { data: users } = await supabase.from("profiles").select("*").order("active").order("created_at");

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle="New sign-ups wait here inactive until you assign a role and activate them."
      />
      <ErrorBanner error={error} />
      <Notice message={message} />

      <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r.value} className="card">
            <div className="font-medium">{r.label}</div>
            <div className="text-xs text-stone-500">{r.description}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {(users ?? []).map((u) => {
          const self = u.id === user.id;
          return (
            <form key={u.id} action={updateUser.bind(null, u.id)} className="card flex flex-wrap items-end gap-3">
              <fieldset disabled={self} className="contents">
                <label className="min-w-48 flex-1">
                  <span className="label">Name</span>
                  <input name="full_name" defaultValue={u.full_name ?? ""} className="input" />
                  <span className="mt-1 block text-xs text-stone-500">
                    {u.email} · joined {date(u.created_at)}
                  </span>
                </label>
                <label>
                  <span className="label">Role</span>
                  <select name="role" defaultValue={u.role} className="input w-auto">
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={u.active} /> Active
                </label>
                {!u.active && (
                  <span className="pb-2">
                    <StatusBadge status="inactive" />
                  </span>
                )}
                {self ? (
                  <span className="pb-2 text-xs text-stone-500">That&apos;s you</span>
                ) : (
                  <SubmitButton className="btn">Save</SubmitButton>
                )}
              </fieldset>
            </form>
          );
        })}
      </div>
    </>
  );
}
