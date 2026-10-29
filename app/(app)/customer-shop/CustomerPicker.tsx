import Link from "next/link";

type C = { id: string; name: string; rep_id: string | null; route_code: string | null; phone: string | null };

/** Pick who you're shopping for: your own customers first, then everyone. */
export function CustomerPicker({ customers, me, current, base }: { customers: C[]; me: string; current?: string; base: string }) {
  const mine = customers.filter((c) => c.rep_id === me);
  const rest = customers.filter((c) => c.rep_id !== me);
  return (
    <form className="card mb-4 flex flex-wrap items-end gap-3" action={base}>
      <label className="min-w-64 flex-1">
        <span className="label">Shopping for</span>
        <select name="c" className="input" defaultValue={current ?? ""} required data-testid="pick-customer">
          <option value="">Choose a customer…</option>
          {mine.length > 0 && (
            <optgroup label="My customers">
              {mine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.route_code ? ` · ${c.route_code}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={mine.length ? "Everyone else" : "Customers"}>
            {rest.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.route_code ? ` · ${c.route_code}` : ""}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <button className="btn btn-primary">Open</button>
      {current && (
        <Link href={base} className="btn">
          Someone else
        </Link>
      )}
    </form>
  );
}
