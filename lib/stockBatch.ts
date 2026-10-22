/**
 * CSV stock batches: each row is a quantity received into a location.
 * Shared by the browser preview and the server action so both validate the same way.
 */
import { parseUnits } from "./csv";
import { categorize, type CategoryRule } from "./categorize";

export const STOCK_COLUMNS: { key: string; required?: boolean; help: string }[] = [
  { key: "sku", required: true, help: "Matches an existing item, or creates a new one" },
  { key: "name", help: "Required for new items" },
  { key: "qty", required: true, help: "How many, in the unit below" },
  { key: "unit", help: "bunch, box, case… (default: the item's base unit)" },
  { key: "unit_cost", required: true, help: "Cost per that unit" },
  { key: "location", help: "Location name (default: the one you pick on the page)" },
  { key: "category", help: "Leave blank to auto-sort from the name" },
  { key: "kind", help: "flower or hard_good (default: from the category rules)" },
  { key: "base_unit", help: "New items: stem, each, roll… (default stem / each)" },
  { key: "units", help: 'New items: pack units, e.g. "bunch=10; box=100"' },
  { key: "shelf_life_days", help: "New items: sets default expiry" },
  { key: "expires_at", help: "YYYY-MM-DD (default: today + shelf life)" },
  { key: "lot_code", help: "Farm or box code (default: generated)" },
];

/** Accept common spreadsheet headings. */
const ALIASES: Record<string, string> = {
  item: "name", product: "name", item_name: "name", product_name: "name", description: "name",
  quantity: "qty", count: "qty", cost: "unit_cost", price: "unit_cost", unit_price: "unit_cost", cost_per_unit: "unit_cost",
  loc: "location", area: "location", bin: "location", expiry: "expires_at", expires: "expires_at", expiration: "expires_at",
  exp: "expires_at", lot: "lot_code", type: "kind", pack_units: "units", uom: "unit",
};
export const normalizeHeader = (h: string) => {
  const k = h.trim().toLowerCase().replace(/[\s\-/]+/g, "_").replace(/[^a-z0-9_]/g, "");
  return ALIASES[k] ?? k;
};

/** "boxes" → "box", "bunches" → "bunch", "cases" → "case" when the singular is a known unit. */
function normalizeUnit(u: string, known: string[]) {
  if (known.includes(u)) return u;
  for (const cut of ["es", "s"]) if (u.endsWith(cut) && known.includes(u.slice(0, -cut.length))) return u.slice(0, -cut.length);
  return u;
}

export type KnownItem = { sku: string; name: string; baseUnit: string; units: string[]; category: string | null };
export type StockRow = {
  row: number;
  sku: string;
  name: string;
  isNew: boolean;
  category: string | null;
  categorySource: "file" | "rules" | "item" | "none";
  kind: "flower" | "hard_good";
  unit: string;
  qty: number;
  unitCost: number;
  location: string;
  errors: string[];
  payload: Record<string, unknown>;
};

export function validateStockRows(
  rows: Record<string, string>[],
  ctx: { items: KnownItem[]; locations: string[]; rules: CategoryRule[]; defaultLocation: string; canCreate: boolean },
): StockRow[] {
  const bySku = new Map(ctx.items.map((i) => [i.sku.toUpperCase(), i]));
  const locs = new Map(ctx.locations.map((l) => [l.trim().toLowerCase(), l]));
  const newDefs = new Map<string, { name: string; baseUnit: string; units: string[] }>();

  return rows.map((r, i) => {
    const errors: string[] = [];
    const sku = (r.sku ?? "").trim().toUpperCase();
    if (!sku) errors.push("SKU is required");
    const known = bySku.get(sku);
    const earlierNew = newDefs.get(sku);
    const isNew = !!sku && !known;
    const name = (r.name ?? "").trim() || known?.name || earlierNew?.name || "";
    if (isNew && !name) errors.push("New item: name is required");
    if (isNew && !earlierNew && !ctx.canCreate) errors.push("New item: only buyers can create items");

    // Category: from the file, else the existing item, else the rules
    const rule = name ? categorize(name, ctx.rules) : null;
    let category: string | null = (r.category ?? "").trim() || null;
    let categorySource: StockRow["categorySource"] = category ? "file" : "none";
    if (!category && known?.category) {
      category = known.category;
      categorySource = "item";
    }
    if (!category && rule) {
      category = rule.category;
      categorySource = "rules";
    }
    const kindRaw = (r.kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (kindRaw && !["flower", "hard_good"].includes(kindRaw)) errors.push('kind must be "flower" or "hard_good"');
    const kind = (["flower", "hard_good"].includes(kindRaw) ? kindRaw : rule?.kind ?? "flower") as StockRow["kind"];

    // Units
    const baseUnit = known?.baseUnit ?? earlierNew?.baseUnit ?? ((r.base_unit ?? "").trim().toLowerCase() || (kind === "hard_good" ? "each" : "stem"));
    let packUnits: { name: string; factor: number }[] = [];
    if (isNew && !earlierNew) {
      const parsed = parseUnits(r.units ?? "");
      if (typeof parsed === "string") errors.push(parsed);
      else packUnits = parsed;
      newDefs.set(sku, { name, baseUnit, units: [baseUnit, ...packUnits.map((u) => u.name)] });
    }
    const unitNames = known?.units ?? newDefs.get(sku)?.units ?? [baseUnit];
    const unit = normalizeUnit((r.unit ?? "").trim().toLowerCase() || baseUnit, unitNames);
    if (sku && !unitNames.includes(unit)) errors.push(`"${r.unit}" isn't a unit of this item (has ${unitNames.join(", ")})`);

    const qty = Number(r.qty);
    if (!(qty > 0)) errors.push("qty must be more than 0");
    const unitCost = Number((r.unit_cost ?? "").replace(/[$,]/g, ""));
    if ((r.unit_cost ?? "").trim() === "" || !(unitCost >= 0)) errors.push("unit_cost is required");

    const locIn = (r.location ?? "").trim() || ctx.defaultLocation;
    const location = locs.get(locIn.toLowerCase());
    if (!location) errors.push(locIn ? `location "${locIn}" doesn't exist` : "location is required");

    const exp = (r.expires_at ?? "").trim();
    if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) errors.push("expires_at must be YYYY-MM-DD");
    const shelf = (r.shelf_life_days ?? "").trim();
    if (shelf && !(Number(shelf) >= 0)) errors.push("shelf_life_days must be a number");

    return {
      row: i + 2,
      sku,
      name,
      isNew,
      category,
      categorySource,
      kind,
      unit,
      qty,
      unitCost,
      location: location ?? locIn,
      errors,
      payload: {
        sku,
        name,
        kind,
        category,
        base_unit: baseUnit,
        units: packUnits,
        shelf_life_days: shelf || null,
        unit,
        qty,
        unit_cost: unitCost,
        location: location ?? locIn,
        expires_at: exp || null,
        lot_code: (r.lot_code ?? "").trim() || null,
      },
    };
  });
}
