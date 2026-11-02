import { Field } from "@/components/ui";

export type DirectCustomer = { id: string; name: string };

// empty = regular stock
export function DirectShipField({ customers, value, className }: { customers: DirectCustomer[]; value?: string | null; className?: string }) {
  return (
    <Field label="Direct ship for" className={className}>
      <select name="direct_customer_id" className="input" defaultValue={value ?? ""} data-testid="direct-customer">
        <option value="">Not direct ship (our stock)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function DirectShipBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <span className="inline-block rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-violet-700" data-testid="direct-badge">
      Direct ship → {name}
    </span>
  );
}
