/**
 * Floor plan shapes. Points are [x, y] in percent of the plan's width and height
 * (0–100), so shapes stay put when the plan is drawn at any size. Rotation and
 * other angle math is done in "uniform" units (x × aspect, y), where one unit is
 * the same distance across and down.
 */
export type Pt = [number, number];
export type Box = { x: number; y: number; w: number; h: number };

const round = (n: number) => Math.round(n * 1000) / 1000;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const rectPoints = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

export function bbox(pts: Pt[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Area-weighted centre (where the label sits); falls back to the average point. */
export function centroid(pts: Pt[], aspect = 1): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * aspect * y1 - x1 * aspect * y0;
    a += f;
    cx += (x0 * aspect + x1 * aspect) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a) / aspect, cy / (3 * a)];
}

/** Keep every point on the plan. */
export const clampPts = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [round(clamp(x, 0, 100)), round(clamp(y, 0, 100))]);

/** Move by (dx, dy) percent without leaving the plan. */
export function translate(pts: Pt[], dx: number, dy: number): Pt[] {
  const b = bbox(pts);
  const mx = clamp(dx, -b.x, 100 - (b.x + b.w));
  const my = clamp(dy, -b.y, 100 - (b.y + b.h));
  return pts.map(([x, y]) => [round(x + mx), round(y + my)]);
}

/** Stretch the shape so its bounding box becomes `to`. */
export function fitBox(pts: Pt[], to: Box): Pt[] {
  const b = bbox(pts);
  const sx = b.w > 1e-9 ? to.w / b.w : 1;
  const sy = b.h > 1e-9 ? to.h / b.h : 1;
  return clampPts(pts.map(([x, y]) => [to.x + (x - b.x) * sx, to.y + (y - b.y) * sy]));
}

/** Turn the shape by `deg` (clockwise on screen) about its centre. */
export function rotate(pts: Pt[], deg: number, aspect: number): Pt[] {
  const [cx, cy] = centroid(pts, aspect);
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const out: Pt[] = pts.map(([x, y]) => {
    const ux = (x - cx) * aspect;
    const uy = y - cy;
    return [cx + (ux * cos - uy * sin) / aspect, cy + ux * sin + uy * cos];
  });
  // slide back onto the plan if turning pushed it over an edge
  const b = bbox(out);
  const dx = b.x < 0 ? -b.x : b.x + b.w > 100 ? 100 - (b.x + b.w) : 0;
  const dy = b.y < 0 ? -b.y : b.y + b.h > 100 ? 100 - (b.y + b.h) : 0;
  return clampPts(out.map(([x, y]) => [x + dx, y + dy]));
}

export const angleOf = (from: Pt, to: Pt, aspect: number) => (Math.atan2(to[1] - from[1], (to[0] - from[0]) * aspect) * 180) / Math.PI;

export function insertPoint(pts: Pt[], afterIndex: number): Pt[] {
  const a = pts[afterIndex];
  const b = pts[(afterIndex + 1) % pts.length];
  const out = pts.slice();
  out.splice(afterIndex + 1, 0, [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]);
  return out;
}

export const removePoint = (pts: Pt[], i: number): Pt[] => (pts.length <= 3 ? pts : pts.filter((_, j) => j !== i));

/** A shape is usable if it has 3+ points on the plan and some area. */
export function validShape(pts: unknown): pts is Pt[] {
  if (!Array.isArray(pts) || pts.length < 3 || pts.length > 60) return false;
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100))) return false;
  const b = bbox(pts as Pt[]);
  return b.w > 0.2 && b.h > 0.2;
}

export const toSvg = (pts: Pt[], aspect: number) => pts.map(([x, y]) => `${round(x * aspect)},${round(y)}`).join(" ");

/** Feet per percent of the plan (null when the floor size isn't set). */
export function feetScale(widthFt: number | null | undefined, heightFt: number | null | undefined) {
  return widthFt && heightFt ? { x: widthFt / 100, y: heightFt / 100 } : null;
}

export const fmtFt = (ft: number) => {
  const r = Math.round(ft * 2) / 2;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} ft`;
};
