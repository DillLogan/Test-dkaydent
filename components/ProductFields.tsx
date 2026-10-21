import { Field } from "./ui";

type P = Record<string, any> | null;

export function ProductFields({ product, isNew }: { product: P; isNew?: boolean }) {
  const v = (k: string) => product?.[k] ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Type" className="sm:col-span-2">
        <select name="kind" className="input" defaultValue={v("kind") || "flower"} required>
          <option value="flower">Flower / greens</option>
          <option value="hard_good">Hard good</option>
        </select>
      </Field>
      <Field label="SKU" className="sm:col-span-2">
        <input name="sku" className="input uppercase" defaultValue={v("sku")} required />
      </Field>
      <Field label="Category" className="sm:col-span-2">
        <input name="category" className="input" defaultValue={v("category")} placeholder="Roses, Greens, Vases…" />
      </Field>
      <Field label="Name" className="sm:col-span-6">
        <input name="name" className="input" defaultValue={v("name")} required placeholder="Rose Freedom 60cm" />
      </Field>

      <Field label="Variety" className="sm:col-span-2">
        <input name="variety" className="input" defaultValue={v("variety")} />
      </Field>
      <Field label="Color" className="sm:col-span-2">
        <input name="color" className="input" defaultValue={v("color")} />
      </Field>
      <Field label="Grade" className="sm:col-span-1">
        <input name="grade" className="input" defaultValue={v("grade")} />
      </Field>
      <Field label="Stem cm" className="sm:col-span-1">
        <input name="stem_length_cm" type="number" min="0" className="input" defaultValue={v("stem_length_cm")} />
      </Field>

      {isNew ? (
        <>
          <Field label="Base unit (smallest you track)" className="sm:col-span-2">
            <input name="base_unit" className="input" list="base-units" defaultValue="stem" required />
            <datalist id="base-units">
              <option value="stem" />
              <option value="each" />
              <option value="roll" />
              <option value="lb" />
            </datalist>
          </Field>
          <Field label="Pack unit (optional)" className="sm:col-span-2">
            <input name="pack_name" className="input" list="pack-units" placeholder="bunch, box, case" />
            <datalist id="pack-units">
              <option value="bunch" />
              <option value="box" />
              <option value="case" />
            </datalist>
          </Field>
          <Field label="Base units per pack" className="sm:col-span-2">
            <input name="pack_factor" type="number" min="0" step="any" className="input" placeholder="25" />
          </Field>
        </>
      ) : (
        <Field label="Base unit" className="sm:col-span-2">
          <input className="input" value={v("base_unit")} disabled readOnly />
        </Field>
      )}

      <Field label="Shelf life (days)" className="sm:col-span-2">
        <input name="shelf_life_days" type="number" min="0" className="input" defaultValue={v("shelf_life_days")} placeholder="Sets default expiry on receipt" />
      </Field>
      <Field label="Reorder point (base units)" className="sm:col-span-2">
        <input name="reorder_point_base" type="number" min="0" step="any" className="input" defaultValue={v("reorder_point_base")} />
      </Field>
      <Field label="Notes" className="sm:col-span-6">
        <textarea name="notes" rows={2} className="input" defaultValue={v("notes")} />
      </Field>
      {!isNew && (
        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <input type="checkbox" name="active" defaultChecked={product?.active} /> Active (shown when ordering)
        </label>
      )}
    </div>
  );
}
