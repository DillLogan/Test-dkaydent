import { Field } from "./ui";

type R = Record<string, any> | null;

export function VendorFields({ vendor }: { vendor: R }) {
  const v = (k: string) => vendor?.[k] ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Name" className="sm:col-span-4">
        <input name="name" className="input" defaultValue={v("name")} required />
      </Field>
      <Field label="Type" className="sm:col-span-2">
        <select name="kind" className="input" defaultValue={v("kind") || "grower"}>
          <option value="grower">Grower / farm</option>
          <option value="distributor">Distributor</option>
          <option value="supplier">Hard goods supplier</option>
        </select>
      </Field>
      <Field label="Discount %" className="sm:col-span-2">
        <input name="discount_pct" type="number" min="0" max="100" step="0.01" className="input" defaultValue={v("discount_pct") || 0} />
      </Field>
      <Field label="Contact" className="sm:col-span-2">
        <input name="contact_name" className="input" defaultValue={v("contact_name")} />
      </Field>
      <Field label="Email" className="sm:col-span-2">
        <input name="email" type="email" className="input" defaultValue={v("email")} />
      </Field>
      <Field label="Phone" className="sm:col-span-2">
        <input name="phone" className="input" defaultValue={v("phone")} />
      </Field>
      <Field label="Country" className="sm:col-span-3">
        <input name="country" className="input" defaultValue={v("country")} />
      </Field>
      <Field label="Payment terms" className="sm:col-span-3">
        <input name="payment_terms" className="input" defaultValue={v("payment_terms")} placeholder="Net 15, prepay…" />
      </Field>
      <Field label="Notes" className="sm:col-span-6">
        <textarea name="notes" rows={2} className="input" defaultValue={v("notes")} />
      </Field>
    </div>
  );
}

export function CustomerFields({ customer, tiers }: { customer: R; tiers: { id: string; name: string }[] }) {
  const v = (k: string) => customer?.[k] ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Business name" className="sm:col-span-4">
        <input name="name" className="input" defaultValue={v("name")} required />
      </Field>
      <Field label="Price tier" className="sm:col-span-2">
        <select name="price_tier_id" className="input" defaultValue={v("price_tier_id")}>
          <option value="">None</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contact" className="sm:col-span-2">
        <input name="contact_name" className="input" defaultValue={v("contact_name")} />
      </Field>
      <Field label="Email" className="sm:col-span-2">
        <input name="email" type="email" className="input" defaultValue={v("email")} />
      </Field>
      <Field label="Phone" className="sm:col-span-2">
        <input name="phone" className="input" defaultValue={v("phone")} />
      </Field>
      <Field label="Location address" className="sm:col-span-3">
        <textarea name="address" rows={2} className="input" defaultValue={v("address")} />
      </Field>
      <Field label="Delivery address (if different)" className="sm:col-span-3">
        <textarea name="delivery_address" rows={2} className="input" defaultValue={v("delivery_address")} placeholder="Leave blank to deliver to the location address" />
      </Field>
      <Field label="Payment terms (days)" className="sm:col-span-2">
        <input name="payment_terms_days" type="number" min="0" className="input" defaultValue={v("payment_terms_days") || 30} />
      </Field>
      <Field label="Resale certificate #" className="sm:col-span-4">
        <input name="resale_certificate" className="input" defaultValue={v("resale_certificate")} />
      </Field>
      <Field label="Notes" className="sm:col-span-6">
        <textarea name="notes" rows={2} className="input" defaultValue={v("notes")} />
      </Field>
    </div>
  );
}
