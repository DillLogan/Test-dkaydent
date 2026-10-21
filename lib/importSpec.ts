/**
 * Import definitions shared by the browser preview and the server action,
 * so both validate exactly the same way.
 */
import { parseUnits, truthy } from "./csv";
import type { Role } from "./roles";

export type Entity = "products" | "vendors" | "customers";

export const IMPORT_ROLE: Record<Entity, Role> = { products: "buyer", vendors: "buyer", customers: "sales" };

export const IMPORT_COLUMNS: Record<Entity, { key: string; required?: boolean; help: string }[]> = {
  products: [
    { key: "sku", required: true, help: "Unique code; matches existing products to update them" },
    { key: "name", required: true, help: "Display name" },
    { key: "kind", required: true, help: "flower or hard_good" },
    { key: "category", help: "Roses, Greens, Vases…" },
    { key: "variety", help: "" },
    { key: "color", help: "" },
    { key: "grade", help: "" },
    { key: "stem_length_cm", help: "Whole number" },
    { key: "base_unit", required: true, help: "stem, each, roll… (new products only)" },
    { key: "units", help: 'Pack units, e.g. "bunch=25; box=250"' },
    { key: "shelf_life_days", help: "Sets default expiry on receipt" },
    { key: "reorder_point_base", help: "In base units" },
    { key: "active", help: "true/false (default true)" },
    { key: "notes", help: "" },
  ],
  vendors: [
    { key: "name", required: true, help: "Matches existing vendors by name to update them" },
    { key: "kind", help: "grower, distributor or supplier (default grower)" },
    { key: "contact_name", help: "" },
    { key: "email", help: "" },
    { key: "phone", help: "" },
    { key: "country", help: "" },
    { key: "payment_terms", help: "Net 15, prepay…" },
    { key: "notes", help: "" },
    { key: "active", help: "true/false (default true)" },
  ],
  customers: [
    { key: "name", required: true, help: "Matches existing customers by name to update them" },
    { key: "price_tier", help: "Name of an existing price tier" },
    { key: "contact_name", help: "" },
    { key: "email", help: "" },
    { key: "phone", help: "" },
    { key: "address", help: "" },
    { key: "payment_terms_days", help: "Default 30" },
    { key: "resale_certificate", help: "" },
    { key: "notes", help: "" },
    { key: "active", help: "true/false (default true)" },
  ],
};

export type Validated = { row: number; record: Record<string, any>; errors: string[]; action: "create" | "update" };

const n = (s: string | undefined) => (s && s.trim() !== "" ? Number(s) : null);

/**
 * existing: keys that already exist (SKUs upper-cased, names lower-cased).
 * tiers: price tier name (lower-cased) → id.
 */
export function validate(
  entity: Entity,
  rows: Record<string, string>[],
  existing: Set<string>,
  tiers: Record<string, string> = {},
): Validated[] {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const errors: string[] = [];
    for (const c of IMPORT_COLUMNS[entity]) if (c.required && !r[c.key]?.trim()) errors.push(`${c.key} is required`);
    let key = "";
    let record: Record<string, any> = {};

    if (entity === "products") {
      key = (r.sku ?? "").trim().toUpperCase();
      const kind = (r.kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (r.kind && !["flower", "hard_good"].includes(kind)) errors.push('kind must be "flower" or "hard_good"');
      const units = parseUnits(r.units ?? "");
      if (typeof units === "string") errors.push(units);
      for (const f of ["stem_length_cm", "shelf_life_days", "reorder_point_base"]) {
        const v = n(r[f]);
        if (v !== null && (!Number.isFinite(v) || v < 0)) errors.push(`${f} must be a number ≥ 0`);
      }
      record = {
        sku: key,
        name: r.name?.trim(),
        kind,
        category: r.category || null,
        variety: r.variety || null,
        color: r.color || null,
        grade: r.grade || null,
        stem_length_cm: n(r.stem_length_cm) === null ? null : Math.round(n(r.stem_length_cm)!),
        base_unit: (r.base_unit ?? "").trim().toLowerCase(),
        units: typeof units === "string" ? [] : units,
        shelf_life_days: n(r.shelf_life_days) === null ? null : Math.round(n(r.shelf_life_days)!),
        reorder_point_base: n(r.reorder_point_base) ?? 0,
        active: truthy(r.active),
        notes: r.notes || null,
      };
    } else if (entity === "vendors") {
      key = (r.name ?? "").trim().toLowerCase();
      const kind = (r.kind || "grower").trim().toLowerCase();
      if (!["grower", "distributor", "supplier"].includes(kind)) errors.push("kind must be grower, distributor or supplier");
      record = {
        name: r.name?.trim(),
        kind,
        contact_name: r.contact_name || null,
        email: r.email || null,
        phone: r.phone || null,
        country: r.country || null,
        payment_terms: r.payment_terms || null,
        notes: r.notes || null,
        active: truthy(r.active),
      };
    } else {
      key = (r.name ?? "").trim().toLowerCase();
      const tierName = (r.price_tier ?? "").trim().toLowerCase();
      if (tierName && !tiers[tierName]) errors.push(`price tier "${r.price_tier}" doesn't exist`);
      const terms = n(r.payment_terms_days);
      if (terms !== null && (!Number.isInteger(terms) || terms < 0)) errors.push("payment_terms_days must be a whole number");
      record = {
        name: r.name?.trim(),
        price_tier_id: tierName ? tiers[tierName] ?? null : null,
        contact_name: r.contact_name || null,
        email: r.email || null,
        phone: r.phone || null,
        address: r.address || null,
        payment_terms_days: terms ?? 30,
        resale_certificate: r.resale_certificate || null,
        notes: r.notes || null,
        active: truthy(r.active),
      };
    }

    if (key) {
      if (seen.has(key)) errors.push("duplicate of an earlier row in this file");
      seen.add(key);
    }
    return { row: i + 2, record, errors, action: existing.has(key) ? "update" : "create" };
  });
}
