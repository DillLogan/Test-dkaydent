const TZ = process.env.APP_TIMEZONE || "America/New_York";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd4 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const money = (n: unknown) => usd.format(Number(n ?? 0));
/** For per-stem costs that need more precision. */
export const unitMoney = (n: unknown) => usd4.format(Number(n ?? 0));
export const qty = (n: unknown) => qtyFmt.format(Number(n ?? 0));
export const pct = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;

/** Date-only strings (YYYY-MM-DD) are shown as-is; timestamps in the app time zone. */
export function date(d: string | null | undefined) {
  if (!d) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d);
  return new Date(dateOnly ? d + "T00:00:00Z" : d).toLocaleDateString("en-US", {
    timeZone: dateOnly ? "UTC" : TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function dateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Today as YYYY-MM-DD in the app time zone. */
export function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function addDays(ymd: string, days: number) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sum<T>(rows: T[] | null | undefined, pick: (r: T) => unknown) {
  return (rows ?? []).reduce((s, r) => s + Number(pick(r) ?? 0), 0);
}

/** Show a base quantity in the largest whole unit that fits, e.g. "3 box + 40 stem". */
export function inUnits(qtyBase: number, units: { name: string; factor: number }[], baseUnit: string) {
  const sorted = [...units].sort((a, b) => Number(b.factor) - Number(a.factor));
  const big = sorted.find((u) => Number(u.factor) > 1 && qtyBase >= Number(u.factor));
  if (!big) return `${qty(qtyBase)} ${baseUnit}`;
  const whole = Math.floor(qtyBase / Number(big.factor));
  const rest = qtyBase - whole * Number(big.factor);
  return rest > 0 ? `${whole} ${big.name} + ${qty(rest)} ${baseUnit}` : `${whole} ${big.name}`;
}

/** The same date one year later (Feb 29 -> Feb 28). The furthest out a shipment can be planned. */
export function oneYearFrom(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
