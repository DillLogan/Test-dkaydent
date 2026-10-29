/**
 * Pull ticket: which lots to pull for a sales order, grouped by shop and
 * section. Lots are taken oldest first, the same order "Fulfill oldest-first"
 * uses, so the ticket matches what fulfilling will take.
 */

export type TicketLine = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  baseUnit: string;
  unitName: string;
  factor: number;
  qty: number; // in the order's unit
};

export type TicketLot = {
  id: string;
  lotCode: string | null;
  productId: string;
  locationId: string;
  locationName: string;
  layoutId: string;
  receivedAt: string;
  createdAt: string;
  expiresAt: string | null;
  onHandBase: number;
  section?: string | null; // where it sits inside the location (its own spot, else the item's home spot)
  shelf?: string | null;
};

export type TicketRow = {
  lineId: string;
  name: string;
  sku: string;
  lotCode: string | null;
  expiresAt: string | null;
  base: number;
  baseUnit: string;
  unitName: string;
  factor: number;
  section?: string | null;
  shelf?: string | null;
};
export type TicketSection = { name: string; rows: TicketRow[] };
export type TicketShop = { id: string; name: string; sections: TicketSection[] };
export type Ticket = { shops: TicketShop[]; short: TicketRow[] };

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function buildPullTicket(lines: TicketLine[], lots: TicketLot[], layouts: { id: string; name: string }[]): Ticket {
  const used = new Map<string, number>();
  const ordered = [...lots].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.createdAt.localeCompare(b.createdAt));
  // shop → section → rows
  const tree = new Map<string, Map<string, TicketRow[]>>();
  const short: TicketRow[] = [];

  for (const line of lines) {
    let need = line.qty * line.factor;
    const base = { lineId: line.id, name: line.name, sku: line.sku, baseUnit: line.baseUnit, unitName: line.unitName, factor: line.factor };
    for (const lot of ordered) {
      if (need <= 1e-9) break;
      if (lot.productId !== line.productId) continue;
      const left = lot.onHandBase - (used.get(lot.id) ?? 0);
      if (left <= 1e-9) continue;
      const take = Math.min(need, left);
      used.set(lot.id, (used.get(lot.id) ?? 0) + take);
      need -= take;
      const shop = tree.get(lot.layoutId) ?? new Map<string, TicketRow[]>();
      tree.set(lot.layoutId, shop);
      const rows = shop.get(lot.locationName) ?? [];
      shop.set(lot.locationName, rows);
      const section = lot.section ?? null;
      const shelf = lot.shelf ?? null;
      const same = rows.find((r) => r.lineId === line.id && r.lotCode === lot.lotCode && r.expiresAt === lot.expiresAt && r.section === section && r.shelf === shelf);
      if (same) same.base += take;
      else rows.push({ ...base, lotCode: lot.lotCode, expiresAt: lot.expiresAt, base: take, section, shelf });
    }
    if (need > 1e-9) short.push({ ...base, lotCode: null, expiresAt: null, base: need });
  }

  const shops: TicketShop[] = layouts
    .filter((l) => tree.has(l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      sections: [...tree.get(l.id)!.entries()]
        .sort(([a], [b]) => byText(a, b))
        // within a location: by section, then shelf, then item (rows without a section last)
        .map(([name, rows]) => ({
          name,
          rows: rows.sort((a, b) => Number(!a.section) - Number(!b.section) || byText(a.section ?? "", b.section ?? "") || byText(a.shelf ?? "", b.shelf ?? "") || byText(a.name, b.name)),
        })),
    }));
  short.sort((a, b) => byText(a.name, b.name));
  return { shops, short };
}

/** "2 box · 50 stem" — the order's unit first, base units when they differ. */
export function ticketQty(r: Pick<TicketRow, "base" | "baseUnit" | "unitName" | "factor">): string {
  const f = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  if (r.factor === 1 || r.unitName === r.baseUnit) return `${f(r.base)} ${r.baseUnit}`;
  return `${f(r.base / r.factor)} ${r.unitName} · ${f(r.base)} ${r.baseUnit}`;
}
