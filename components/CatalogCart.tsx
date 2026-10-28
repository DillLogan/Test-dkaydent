"use client";

import { Cart, type CatalogItem } from "./Cart";

export type StaffItem = CatalogItem & { tier_price: number | null; special_price: number | null };

/** Sales catalog: the shop cart plus price editing on each item. */
export function CatalogCart({
  items,
  customerId,
  tierId,
  tierName,
  payment,
  checkoutAction,
  priceAction,
}: {
  items: StaffItem[];
  customerId: string;
  tierId: string | null;
  tierName: string | null;
  payment: { usual: string | null; cashPct: number };
  checkoutAction: (fd: FormData) => void | Promise<void>;
  priceAction: (fd: FormData) => void | Promise<void>;
}) {
  return (
    <Cart
      items={items}
      action={checkoutAction}
      hidden={{ customer_id: customerId }}
      submitLabel="Create draft order"
      payment={payment}
      extra={(i) => {
        const it = i as StaffItem;
        return (
          <form action={priceAction} className="mt-2 flex flex-wrap items-end gap-2 text-xs" data-price-edit={i.unit_id}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="unit_id" value={i.unit_id} />
            <input type="hidden" name="tier_id" value={tierId ?? ""} />
            {tierId && (
              <label>
                <span className="block text-stone-500">{tierName} tier price (all in tier)</span>
                <input name="tier_price" type="number" min="0" step="0.0001" className="input w-28" defaultValue={it.tier_price ?? ""} />
              </label>
            )}
            <label>
              <span className="block text-stone-500">This customer only</span>
              <input name="special_price" type="number" min="0" step="0.0001" className="input w-28" defaultValue={it.special_price ?? ""} />
            </label>
            <button className="btn">Save prices</button>
          </form>
        );
      }}
    />
  );
}
