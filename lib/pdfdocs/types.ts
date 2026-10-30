/**
 * PDF printouts: a template (where things sit on the page) + the document's data = a real PDF.
 * The same code runs in the app and in the demo. Coordinates are points (1/72 in) from the top-left
 * of the template's design page; labels scale to the label size actually used.
 */

export type DocType = "pull" | "invoice" | "route" | "label" | "boxlabel";

export type Align = "left" | "center" | "right";

export type Column = {
  key: string;
  label: string;
  /** share of the table width (all visible columns are scaled to fill it) */
  w: number;
  align?: Align;
  hidden?: boolean;
  /** text: plain; mono: code font; check: an empty tick box; blank: a write-in line */
  kind?: "text" | "mono" | "check" | "blank";
  bold?: boolean;
  /** a second, smaller line under the value */
  sub?: string;
};

export type El = {
  id: string;
  /** shown in the designer's list */
  name: string;
  type: "text" | "barcode" | "line" | "box" | "image" | "table" | "mustcheck" | "signature" | "pagenum";
  x: number;
  y: number;
  w: number;
  h: number;
  /** text with {placeholders}; for barcode the value; for signature the caption */
  text?: string;
  size?: number;
  bold?: boolean;
  mono?: boolean;
  italic?: boolean;
  upper?: boolean;
  align?: Align;
  color?: string;
  fill?: string;
  stroke?: number;
  /** image: a data: URL (PNG or JPEG) */
  src?: string;
  hidden?: boolean;
  /** only shown when this data field has a value (e.g. "so.mustCheck") */
  when?: string;
  /** "page": placed on the page; "after": placed below the table, y measured from the table's end */
  flow?: "page" | "after";
  /** which pages: the first (default), every page, or every page but the first */
  pages?: "first" | "all" | "rest";
  /** table only */
  columns?: Column[];
  rowSize?: number;
};

export type Template = {
  doc: DocType;
  version: number;
  /** design page size in points */
  page: { w: number; h: number };
  /** where the table continues on later pages, and the space kept free at the bottom of each page */
  contTop: number;
  bottom: number;
  elements: El[];
};

/** One row of a table: values by column key. _group makes a full-width band (a section title). */
export type Row = Record<string, string | number | boolean | null | undefined> & { _group?: string; _tone?: "warn" | "plain" };

/** Any document's data: nested values for {placeholders}, and the table rows. */
export type DocData = { fields: Record<string, unknown>; rows?: Row[]; copies?: string[] };

export type LabelSheet = { mode: "label" | "regular"; w: number; h: number; paper: "letter" | "a4" };
