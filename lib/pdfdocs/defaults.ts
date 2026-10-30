import type { DocData, DocType, El, Template } from "./types";

export const DOCS: { doc: DocType; label: string; hint: string }[] = [
  { doc: "pull", label: "Pull ticket", hint: "Letter · what to pull, by location, section and shelf" },
  { doc: "invoice", label: "Invoice", hint: "Letter · customer and office copies" },
  { doc: "route", label: "Route sheet", hint: "Letter · the driver's stops" },
  { doc: "boxlabel", label: "Box label", hint: "Label printer · one per box" },
  { doc: "label", label: "Item label", hint: "Label printer · products and lots" },
];

export const LETTER = { w: 612, h: 792 };
const GRAY = "#57534e";

/** The old show/hide switches from Customize printouts, used to start the layouts so nothing changes for existing setups. */
export type LegacyToggles = {
  invoice?: { showSku?: boolean; showNotes?: boolean; showBarcode?: boolean; showResale?: boolean };
  pull?: { showSku?: boolean; showLot?: boolean; showNotes?: boolean; showBarcode?: boolean; showLabelLine?: boolean };
  route?: { showPhone?: boolean; showBoxes?: boolean };
  labels?: { showAddress?: boolean; showRoute?: boolean };
};

let n = 0;
const el = (e: Omit<El, "id"> & { id?: string }): El => ({ id: e.id ?? `e${++n}`, ...e });

function pull(t: LegacyToggles["pull"] = {}): Template {
  const on = (v: boolean | undefined) => v !== false;
  return {
    doc: "pull", version: 1, page: LETTER, contTop: 64, bottom: 48,
    elements: [
      el({ id: "company", name: "Company line", type: "text", x: 36, y: 34, w: 330, h: 12, text: "{business.name} · Pull ticket", size: 8, bold: true, upper: true, color: GRAY }),
      el({ id: "contact", name: "Address and phone", type: "text", x: 36, y: 46, w: 330, h: 11, text: "{business.contact}", size: 8, color: GRAY }),
      el({ id: "number", name: "Order number", type: "text", x: 36, y: 60, w: 300, h: 26, text: "{so.number}", size: 22, bold: true }),
      el({ id: "customer", name: "Customer", type: "text", x: 36, y: 88, w: 300, h: 15, text: "{so.customer}", size: 11 }),
      el({ id: "barcode", name: "Barcode", type: "barcode", x: 30, y: 106, w: 180, h: 32, text: "{so.number}", hidden: !on(t.showBarcode) }),
      el({ id: "metaL", name: "Ships / lines / printed (labels)", type: "text", x: 376, y: 34, w: 64, h: 42, text: "Ships\nLines\nPrinted", size: 9, align: "right", color: GRAY }),
      el({ id: "metaV", name: "Ships / lines / printed", type: "text", x: 446, y: 34, w: 130, h: 42, text: "{so.ships}\n{so.lines}\n{so.printed}", size: 9, align: "right" }),
      el({ id: "mustcheck", name: "MUST CHECK box", type: "mustcheck", x: 396, y: 82, w: 180, h: 56, when: "so.mustCheck", size: 18 }),
      el({ id: "rule", name: "Rule", type: "line", x: 36, y: 146, w: 540, h: 2, stroke: 1.6 }),
      el({ id: "notes", name: "Order note", type: "text", x: 36, y: 152, w: 540, h: 24, text: "Note: {so.notes}", size: 9, color: "#44403c", when: "so.notes", hidden: !on(t.showNotes) }),
      el({ id: "cont", name: "Header on later pages", type: "text", x: 36, y: 34, w: 540, h: 14, text: "Pull ticket {so.number} · {so.customer} (continued)", size: 9, bold: true, pages: "rest" }),
      el({
        id: "table", name: "Lines", type: "table", x: 36, y: 178, w: 540, h: 200, rowSize: 9.5,
        columns: [
          { key: "check", label: "", w: 0.045, kind: "check" },
          { key: "item", label: "Item", w: 0.31, bold: true, sub: t.showSku === false ? undefined : "sku" },
          { key: "spot", label: "Section · Shelf", w: 0.15, sub: "shelf" },
          { key: "lot", label: "Lot", w: 0.17, kind: "mono", sub: "exp", hidden: !on(t.showLot) },
          { key: "qty", label: "Pull", w: 0.155, align: "right", bold: true },
          { key: "pulled", label: "Pulled", w: 0.085, kind: "blank" },
          { key: "packed", label: "Packed", w: 0.085, kind: "blank" },
        ],
      }),
      el({ id: "boxes", name: "Box labels printed", type: "text", x: 0, y: 6, w: 300, h: 14, text: "Box labels printed: {so.boxes}", size: 10, bold: true, flow: "after", hidden: !on(t.showLabelLine) }),
      el({ id: "sig1", name: "Pulled by", type: "signature", x: 0, y: 34, w: 250, h: 36, text: "Pulled by", flow: "after" }),
      el({ id: "sig2", name: "Packed by", type: "signature", x: 290, y: 34, w: 250, h: 36, text: "Packed by", flow: "after" }),
      el({ id: "footer", name: "Footer", type: "text", x: 0, y: 82, w: 540, h: 24, text: "{business.footer}", size: 8, align: "center", color: GRAY, flow: "after" }),
      el({ id: "pagenum", name: "Page number", type: "pagenum", x: 36, y: 760, w: 540, h: 12, text: "{so.number} · Page {page} of {pages}", size: 8, align: "right", color: GRAY, pages: "all" }),
    ],
  };
}

function invoice(t: LegacyToggles["invoice"] = {}): Template {
  const on = (v: boolean | undefined) => v !== false;
  return {
    doc: "invoice", version: 1, page: LETTER, contTop: 64, bottom: 48,
    elements: [
      el({ id: "copy", name: "Copy (customer / office)", type: "text", x: 376, y: 22, w: 200, h: 10, text: "{copy}", size: 7.5, bold: true, upper: true, align: "right", color: GRAY }),
      el({ id: "logo", name: "Logo", type: "image", x: 36, y: 34, w: 0, h: 0, hidden: true }),
      el({ id: "company", name: "Company name", type: "text", x: 36, y: 34, w: 300, h: 20, text: "{business.name}", size: 16, bold: true }),
      el({ id: "address", name: "Company address and phone", type: "text", x: 36, y: 56, w: 300, h: 40, text: "{business.address}\n{business.phone}", size: 9, color: GRAY }),
      el({ id: "title", name: "Title", type: "text", x: 376, y: 34, w: 200, h: 24, text: "INVOICE", size: 20, bold: true, align: "right" }),
      el({ id: "metaL", name: "Number / dates (labels)", type: "text", x: 376, y: 62, w: 90, h: 48, text: "Invoice\nIssued\nDue\nOrder", size: 9, align: "right", color: GRAY }),
      el({ id: "metaV", name: "Number / dates", type: "text", x: 470, y: 62, w: 106, h: 48, text: "{inv.number}\n{inv.issued}\n{inv.due}\n{inv.soNumber}", size: 9, align: "right" }),
      el({ id: "barcode", name: "Barcode", type: "barcode", x: 426, y: 114, w: 156, h: 26, text: "{inv.number}", hidden: !on(t.showBarcode) }),
      el({ id: "billL", name: "Bill to (label)", type: "text", x: 36, y: 110, w: 180, h: 10, text: "Bill to", size: 7.5, bold: true, upper: true, color: GRAY }),
      el({ id: "bill", name: "Bill to", type: "text", x: 36, y: 122, w: 180, h: 54, text: "{inv.billTo}", size: 9.5 }),
      el({ id: "shipL", name: "Deliver to (label)", type: "text", x: 226, y: 110, w: 180, h: 10, text: "Deliver to", size: 7.5, bold: true, upper: true, color: GRAY }),
      el({ id: "ship", name: "Deliver to", type: "text", x: 226, y: 122, w: 180, h: 54, text: "{inv.deliverTo}", size: 9.5 }),
      el({ id: "from", name: "Ships from", type: "text", x: 36, y: 178, w: 360, h: 12, text: "Ships from {inv.shipsFrom}", size: 8.5, color: GRAY, when: "inv.shipsFrom" }),
      el({ id: "notes", name: "Order note", type: "text", x: 36, y: 192, w: 540, h: 22, text: "Note: {inv.orderNotes}", size: 9, color: "#44403c", when: "inv.orderNotes", hidden: !on(t.showNotes) }),
      el({ id: "cont", name: "Header on later pages", type: "text", x: 36, y: 34, w: 540, h: 14, text: "{inv.number} · {inv.customer} (continued) · {copy}", size: 9, bold: true, pages: "rest" }),
      el({
        id: "table", name: "Lines", type: "table", x: 36, y: 218, w: 540, h: 200, rowSize: 9.5,
        columns: [
          { key: "sku", label: "SKU", w: 0.15, kind: "mono", hidden: !on(t.showSku) },
          { key: "item", label: "Item", w: 0.39 },
          { key: "qty", label: "Qty", w: 0.16, align: "right" },
          { key: "price", label: "Price", w: 0.14, align: "right" },
          { key: "amount", label: "Amount", w: 0.16, align: "right", bold: true },
        ],
      }),
      el({ id: "totL", name: "Totals (labels)", type: "text", x: 330, y: 4, w: 130, h: 80, text: "{totals.labels}", size: 9.5, align: "right", color: GRAY, flow: "after" }),
      el({ id: "totV", name: "Totals", type: "text", x: 462, y: 4, w: 78, h: 80, text: "{totals.values}", size: 9.5, align: "right", flow: "after" }),
      el({ id: "totRule", name: "Total rule", type: "line", x: 330, y: 88, w: 210, h: 2, stroke: 1, flow: "after" }),
      el({ id: "grand", name: "Amount due", type: "text", x: 330, y: 94, w: 210, h: 18, text: "{totals.dueLabel}  {totals.due}", size: 13, bold: true, align: "right", flow: "after" }),
      el({ id: "terms", name: "Terms", type: "text", x: 0, y: 4, w: 300, h: 40, text: "{inv.terms}", size: 9, flow: "after" }),
      el({ id: "note", name: "Invoice note", type: "text", x: 0, y: 48, w: 300, h: 40, text: "{inv.note}", size: 9, color: "#44403c", flow: "after" }),
      el({ id: "resale", name: "Resale certificate", type: "text", x: 0, y: 92, w: 300, h: 12, text: "Resale certificate: {inv.resale}", size: 8.5, color: GRAY, when: "inv.resale", flow: "after", hidden: !on(t.showResale) }),
      el({ id: "footer", name: "Footer", type: "text", x: 0, y: 124, w: 540, h: 24, text: "{business.footer}", size: 8, align: "center", color: GRAY, flow: "after" }),
      el({ id: "pagenum", name: "Page number", type: "pagenum", x: 36, y: 760, w: 540, h: 12, text: "{inv.number} · {copy} · Page {page} of {pages}", size: 8, align: "right", color: GRAY, pages: "all" }),
    ],
  };
}

function route(t: LegacyToggles["route"] = {}): Template {
  const on = (v: boolean | undefined) => v !== false;
  return {
    doc: "route", version: 1, page: LETTER, contTop: 64, bottom: 48,
    elements: [
      el({ id: "title", name: "Title", type: "text", x: 36, y: 34, w: 360, h: 20, text: "Route sheet · {route.day}{route.codeText}", size: 15, bold: true }),
      el({ id: "shop", name: "Shop and driver", type: "text", x: 376, y: 38, w: 200, h: 28, text: "{route.shop}\n{route.driverText}", size: 9.5, align: "right" }),
      el({ id: "company", name: "Company line", type: "text", x: 36, y: 56, w: 340, h: 11, text: "{business.name} · {business.contact}", size: 8, color: GRAY }),
      el({ id: "rule", name: "Rule", type: "line", x: 36, y: 72, w: 540, h: 2, stroke: 1.6 }),
      el({ id: "start", name: "Start address", type: "text", x: 36, y: 78, w: 540, h: 12, text: "Start: {route.start}", size: 9, when: "route.start" }),
      el({ id: "cont", name: "Header on later pages", type: "text", x: 36, y: 34, w: 540, h: 14, text: "Route sheet · {route.day}{route.codeText} (continued)", size: 9, bold: true, pages: "rest" }),
      el({
        id: "table", name: "Stops", type: "table", x: 36, y: 96, w: 540, h: 200, rowSize: 9.5,
        columns: [
          { key: "n", label: "#", w: 0.05, bold: true },
          { key: "customer", label: "Stop", w: 0.42, bold: true, sub: "address" },
          { key: "order", label: "Order", w: 0.13, kind: "mono" },
          { key: "phone", label: "Phone", w: 0.15, hidden: !on(t.showPhone) },
          { key: "boxes", label: "Boxes", w: 0.1, align: "right", hidden: !on(t.showBoxes) },
          { key: "done", label: "Done", w: 0.06, kind: "check" },
          { key: "signed", label: "Signed", w: 0.09, kind: "blank" },
        ],
      }),
      el({ id: "summary", name: "Stops and boxes", type: "text", x: 0, y: 4, w: 540, h: 14, text: "{route.summary}", size: 10, bold: true, flow: "after" }),
      el({ id: "sig", name: "Driver signature", type: "signature", x: 0, y: 26, w: 250, h: 36, text: "Driver", flow: "after" }),
      el({ id: "footer", name: "Footer", type: "text", x: 0, y: 72, w: 540, h: 24, text: "{business.footer}", size: 8, align: "center", color: GRAY, flow: "after" }),
      el({ id: "pagenum", name: "Page number", type: "pagenum", x: 36, y: 760, w: 540, h: 12, text: "Page {page} of {pages}", size: 8, align: "right", color: GRAY, pages: "all" }),
    ],
  };
}

/** Item label, designed at 4 × 2 in; it scales to the label size in use. */
function label(): Template {
  return {
    doc: "label", version: 1, page: { w: 288, h: 144 }, contTop: 0, bottom: 0,
    elements: [
      el({ id: "title", name: "Item name", type: "text", x: 9, y: 7, w: 200, h: 34, text: "{title}", size: 14, bold: true }),
      el({ id: "sku", name: "SKU", type: "text", x: 210, y: 9, w: 70, h: 12, text: "{sku}", size: 8, mono: true, align: "right", color: GRAY }),
      el({ id: "barcode", name: "Barcode", type: "barcode", x: 6, y: 44, w: 276, h: 44, text: "{code}" }),
      el({ id: "code", name: "Code", type: "text", x: 9, y: 90, w: 270, h: 13, text: "{code}", size: 10.5, bold: true, mono: true, align: "center" }),
      el({ id: "printed", name: "Printed date", type: "text", x: 9, y: 104, w: 270, h: 10, text: "Printed {printed}", size: 7, align: "center", color: GRAY }),
      el({ id: "line1", name: "Line 1", type: "text", x: 9, y: 116, w: 270, h: 11, text: "{line1}", size: 8, color: "#44403c" }),
      el({ id: "line2", name: "Line 2", type: "text", x: 9, y: 128, w: 270, h: 11, text: "{line2}", size: 8, color: "#44403c" }),
    ],
  };
}

/** Box label, designed at 4 × 6 in; it scales to the label size in use. */
function boxlabel(t: LegacyToggles["labels"] = {}): Template {
  const on = (v: boolean | undefined) => v !== false;
  return {
    doc: "boxlabel", version: 1, page: { w: 288, h: 432 }, contTop: 0, bottom: 0,
    elements: [
      el({ id: "shop", name: "Our name", type: "text", x: 16, y: 16, w: 256, h: 12, text: "{business.name}", size: 8, bold: true, upper: true, color: GRAY }),
      el({ id: "customer", name: "Customer", type: "text", x: 16, y: 32, w: 256, h: 56, text: "{customer}", size: 22, bold: true }),
      el({ id: "address", name: "Address", type: "text", x: 16, y: 92, w: 256, h: 54, text: "{address}", size: 12, hidden: !on(t.showAddress) }),
      el({ id: "rule", name: "Rule", type: "line", x: 16, y: 154, w: 256, h: 2, stroke: 1.5 }),
      el({ id: "box", name: "Box x of y", type: "text", x: 16, y: 166, w: 256, h: 44, text: "{box}", size: 30, bold: true, align: "center" }),
      el({ id: "route", name: "Route", type: "text", x: 16, y: 214, w: 256, h: 30, text: "Route {route}", size: 18, bold: true, align: "center", when: "route", hidden: !on(t.showRoute) }),
      el({ id: "barcode", name: "Barcode", type: "barcode", x: 16, y: 262, w: 256, h: 80, text: "{code}" }),
      el({ id: "code", name: "Order number", type: "text", x: 16, y: 346, w: 256, h: 18, text: "{code}", size: 14, bold: true, mono: true, align: "center" }),
      el({ id: "printed", name: "Printed date", type: "text", x: 16, y: 400, w: 256, h: 12, text: "Printed {printed}", size: 8, align: "center", color: GRAY }),
    ],
  };
}

export function defaultTemplate(doc: DocType, legacy: LegacyToggles = {}): Template {
  switch (doc) {
    case "pull": return pull(legacy.pull);
    case "invoice": return invoice(legacy.invoice);
    case "route": return route(legacy.route);
    case "label": return label();
    case "boxlabel": return boxlabel(legacy.labels);
  }
}

/** A saved layout, checked: anything missing or broken falls back to the default so a printout always works. */
export function cleanTemplate(doc: DocType, raw: unknown, legacy: LegacyToggles = {}): Template {
  const d = defaultTemplate(doc, legacy);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<Template>;
  if (!Array.isArray(r.elements) || !r.page || typeof r.page.w !== "number" || typeof r.page.h !== "number") return d;
  const num = (v: unknown, def: number, lo = -2000, hi = 4000) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  const elements = r.elements
    .filter((e): e is El => !!e && typeof e === "object" && typeof (e as El).type === "string")
    .slice(0, 120)
    .map((e): El => ({
      ...e,
      id: String(e.id || Math.random().toString(36).slice(2)),
      name: String(e.name || e.type).slice(0, 60),
      x: num(e.x, 0), y: num(e.y, 0), w: num(e.w, 100, 0), h: num(e.h, 12, 0),
      text: typeof e.text === "string" ? e.text.slice(0, 600) : e.text,
      src: typeof e.src === "string" && e.src.length < 700_000 ? e.src : undefined,
    }));
  if (doc !== "label" && doc !== "boxlabel" && !elements.some((e) => e.type === "table")) elements.push(d.elements.find((e) => e.type === "table")!);
  return { doc, version: 1, page: { w: num(r.page.w, d.page.w, 36, 2000), h: num(r.page.h, d.page.h, 36, 3000) }, contTop: num(r.contTop, d.contTop, 0), bottom: num(r.bottom, d.bottom, 0), elements };
}

/* ------------------------------------------------------------- what the designer offers */

export const FIELDS: Record<DocType, { key: string; label: string }[]> = {
  pull: [
    { key: "business.name", label: "Business name" }, { key: "business.contact", label: "Address · phone" }, { key: "business.footer", label: "Footer" },
    { key: "so.number", label: "Order number" }, { key: "so.customer", label: "Customer" }, { key: "so.ships", label: "Ship date" },
    { key: "so.lines", label: "Line count" }, { key: "so.printed", label: "Printed" }, { key: "so.notes", label: "Order note" }, { key: "so.boxes", label: "Box labels printed" },
  ],
  invoice: [
    { key: "business.name", label: "Business name" }, { key: "business.address", label: "Business address" }, { key: "business.phone", label: "Business phone" }, { key: "business.footer", label: "Footer" },
    { key: "copy", label: "Copy name" }, { key: "inv.number", label: "Invoice number" }, { key: "inv.issued", label: "Issued" }, { key: "inv.due", label: "Due" },
    { key: "inv.soNumber", label: "Order number" }, { key: "inv.customer", label: "Customer" }, { key: "inv.billTo", label: "Bill to" }, { key: "inv.deliverTo", label: "Deliver to" },
    { key: "inv.shipsFrom", label: "Ships from" }, { key: "inv.terms", label: "Terms" }, { key: "inv.note", label: "Invoice note" }, { key: "inv.resale", label: "Resale certificate" },
    { key: "inv.orderNotes", label: "Order note" }, { key: "inv.status", label: "Status" },
    { key: "totals.labels", label: "Totals (labels)" }, { key: "totals.values", label: "Totals (amounts)" }, { key: "totals.dueLabel", label: "Amount due (label)" }, { key: "totals.due", label: "Amount due" },
    { key: "totals.subtotal", label: "Subtotal" }, { key: "totals.tax", label: "Tax" }, { key: "totals.cardFee", label: "Card fee" }, { key: "totals.total", label: "Total" }, { key: "totals.paid", label: "Paid" },
  ],
  route: [
    { key: "business.name", label: "Business name" }, { key: "business.contact", label: "Address · phone" }, { key: "business.footer", label: "Footer" },
    { key: "route.day", label: "Delivery day" }, { key: "route.codeText", label: "Route code" }, { key: "route.shop", label: "Shop" }, { key: "route.driverText", label: "Driver" },
    { key: "route.start", label: "Start address" }, { key: "route.summary", label: "Stops and boxes" },
  ],
  label: [
    { key: "title", label: "Item name" }, { key: "sku", label: "SKU" }, { key: "code", label: "Code (barcode)" }, { key: "printed", label: "Printed date" },
    { key: "line1", label: "Line 1" }, { key: "line2", label: "Line 2" }, { key: "business.name", label: "Business name" },
  ],
  boxlabel: [
    { key: "business.name", label: "Business name" }, { key: "customer", label: "Customer" }, { key: "address", label: "Address" }, { key: "box", label: "Box x of y" },
    { key: "route", label: "Route" }, { key: "code", label: "Order number" }, { key: "printed", label: "Printed date" },
  ],
};

/** Made-up data so the designer can show what a printout will look like. */
export function sampleData(doc: DocType, business = { name: "DKaydent Wholesale", address: "100 Market St\nPhiladelphia, PA 19106", phone: "215-555-0100", footer: "Thank you for your business!" }): DocData {
  const b = { ...business, contact: [business.address.replace(/\s*\n\s*/g, ", "), business.phone].filter(Boolean).join(" · ") };
  const printed = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  switch (doc) {
    case "pull":
      return {
        fields: { business: b, so: { number: "SO-1053", customer: "Bloom & Vine Florist", ships: "Oct 30, 2026", lines: 4, printed, notes: "Leave at the back door.", boxes: "", mustCheck: true } },
        rows: [
          { _group: "Cooler 1" },
          { item: "Rose Freedom 60cm", sku: "RO-FRE-60", spot: "Rack A", shelf: "Shelf 2", lot: "L261019-0030", exp: "exp Oct 31, 2026", qty: "2 bunch · 50 stem" },
          { item: "Alstroemeria Assorted", sku: "AL-ASS-SL", spot: "Rack B", shelf: "Shelf 1", lot: "L261019-0031", exp: "exp Nov 2, 2026", qty: "1 box · 150 stem" },
          { _group: "Cooler 2" },
          { item: "Gypsophila Xlence 80cm", sku: "GY-XLN-80", spot: "Bucket row", shelf: "Shelf Floor", lot: "L261026-0039", exp: "exp Nov 7, 2026", qty: "10 bunch" },
          { _group: "Not in stock", _tone: "warn" },
          { item: "Peony Sarah Bernhardt", sku: "PE-SAR-BN", spot: "", lot: "", qty: "Short 2 bunch" },
        ],
      };
    case "invoice":
      return {
        copies: ["Customer copy", "Office copy"],
        fields: {
          business: b,
          inv: { number: "INV-2041", issued: "Oct 29, 2026", due: "Nov 28, 2026", soNumber: "SO-1053", customer: "Bloom & Vine Florist", billTo: "Bloom & Vine Florist\n22 Pine St\nPhiladelphia, PA 19103", deliverTo: "Bloom & Vine Florist\n22 Pine St, back door\nPhiladelphia, PA 19103", shipsFrom: "Main shop · 100 Market St", terms: "Net 30. Late payments may incur a 1.5% monthly charge.", note: "Thanks for ordering with us.", resale: "PA-77-31009", orderNotes: "", status: "Open" },
          totals: { labels: "Subtotal\nTax (6%)\nCard processing fee (2.5%)\nTotal\nPaid", values: "$412.50\n$24.75\n$10.93\n$448.18\n$100.00", dueLabel: "Balance due", due: "$348.18", subtotal: "$412.50", tax: "$24.75", cardFee: "$10.93", total: "$448.18", paid: "$100.00" },
        },
        rows: [
          { sku: "RO-FRE-60", item: "Rose Freedom 60cm", qty: "4 bunch", price: "$18.75", amount: "$75.00" },
          { sku: "AL-ASS-SL", item: "Alstroemeria Assorted", qty: "2 box", price: "$64.95", amount: "$129.90" },
          { sku: "HG-CYL-12", item: "Glass Cylinder 12in", qty: "1 case", price: "$207.60", amount: "$207.60" },
        ],
      };
    case "route":
      return {
        fields: { business: b, route: { day: "Oct 30, 2026", codeText: " · Route NOR", shop: "Main shop", driverText: "Driver: Sam", start: "100 Market St, Philadelphia, PA 19106", summary: "3 stops · 9 boxes expected" } },
        rows: [
          { n: 1, customer: "Bloom & Vine Florist", address: "22 Pine St, Philadelphia, PA 19103", order: "SO-1053", phone: "215-555-0142", boxes: "4" },
          { n: 2, customer: "Petal Pushers", address: "8 Elm Ave, Cherry Hill, NJ 08002", order: "SO-1057", phone: "856-555-0110", boxes: "3" },
          { n: 3, customer: "Willow Lane Events", address: "301 Lake Rd, Haddonfield, NJ 08033", order: "SO-1060", phone: "", boxes: "2" },
        ],
      };
    case "label":
      return { fields: { business: b, title: "Rose Freedom 60cm", sku: "RO-FRE-60", code: "L261019-0030", printed: "Oct 29, 2026", line1: "250 stem · Cooler 1", line2: "Rcvd Oct 19, 2026 · Exp Oct 31, 2026" } };
    case "boxlabel":
      return { fields: { business: b, customer: "Bloom & Vine Florist", address: "22 Pine St, back door\nPhiladelphia, PA 19103", box: "Box 1 of 4", route: "NOR", code: "SO-1053", printed: "Oct 29, 2026" } };
  }
}
