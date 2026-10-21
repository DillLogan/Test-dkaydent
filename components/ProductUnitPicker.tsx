"use client";

import { useMemo, useState } from "react";

export type PickerProduct = {
  id: string;
  label: string;
  baseUnit: string;
  /** e.g. "740 stem on hand" */
  note?: string;
  units: { id: string; name: string; factor: number }[];
  /** Suggested price/cost per unit id */
  suggested?: Record<string, number>;
};

/**
 * Product → unit → quantity → price inputs for an order line.
 * Submits: product_id, unit_id, qty, and the field named by `priceName`.
 */
export function ProductUnitPicker({
  products,
  priceName,
  priceLabel,
  defaultUnit = "largest",
}: {
  products: PickerProduct[];
  priceName: string;
  priceLabel: string;
  defaultUnit?: "largest" | "smallest";
}) {
  const pickUnit = (p?: PickerProduct) => {
    if (!p || p.units.length === 0) return "";
    const sorted = [...p.units].sort((a, b) => a.factor - b.factor);
    return (defaultUnit === "largest" ? sorted[sorted.length - 1] : sorted[0]).id;
  };

  const [filter, setFilter] = useState("");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId);
  const [unitId, setUnitId] = useState(pickUnit(product));
  const unit = product?.units.find((u) => u.id === unitId);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? products.filter((p) => p.label.toLowerCase().includes(f)) : products;
    // keep the selected product in the list so the select stays valid
    return product && !list.includes(product) ? [product, ...list] : list;
  }, [filter, products, product]);

  if (products.length === 0) {
    return <p className="text-sm text-stone-500">Add products first.</p>;
  }

  const suggested = product?.suggested?.[unitId];

  return (
    <div className="grid gap-3 sm:grid-cols-12">
      <label className="block sm:col-span-5">
        <span className="label">Product</span>
        <input
          className="input mb-1"
          placeholder="Filter by SKU or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          name="product_id"
          className="input"
          value={productId}
          onChange={(e) => {
            const next = products.find((p) => p.id === e.target.value);
            setProductId(e.target.value);
            setUnitId(pickUnit(next));
          }}
        >
          {visible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {product?.note && <span className="mt-1 block text-xs text-stone-500">{product.note}</span>}
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Unit</span>
        <select name="unit_id" className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          {product?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.factor !== 1 ? ` (${u.factor} ${product.baseUnit})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Qty</span>
        <input name="qty" type="number" min="0" step="any" required className="input" />
      </label>
      <label className="block sm:col-span-3">
        <span className="label">{priceLabel}</span>
        <input
          key={`${productId}-${unitId}`}
          name={priceName}
          type="number"
          min="0"
          step="0.0001"
          required
          className="input"
          defaultValue={suggested !== undefined ? suggested.toFixed(2) : ""}
        />
        {unit && unit.factor !== 1 && (
          <span className="mt-1 block text-xs text-stone-500">
            per {unit.name} of {unit.factor} {product?.baseUnit}
          </span>
        )}
      </label>
    </div>
  );
}
