/** Delivery routing helpers (shared by server and browser). */

export type LatLng = { lat: number; lng: number };

/** Same normalization as the database's geo_key(). */
export function geoKey(address: string | null | undefined): string {
  return (address ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Straight-line distance in miles. */
export function miles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Closest to farthest from the start. Stops without a distance keep their
 * current order and go last.
 */
export function closestFirst<T extends { id: string }>(stops: T[], distance: (s: T) => number | null): T[] {
  return stops
    .map((s, i) => ({ s, i, d: distance(s) }))
    .sort((a, b) => {
      if (a.d === null && b.d === null) return a.i - b.i;
      if (a.d === null) return 1;
      if (b.d === null) return -1;
      return a.d - b.d || a.i - b.i;
    })
    .map((x) => x.s);
}

/** Google Maps allows 9 stops between start and end in a shared link. */
const PER_LINK = 9;

/**
 * Google Maps driving links for a route, split into legs when there are more
 * stops than one link can hold. Each leg starts where the last one ended.
 */
export function mapsLinks(origin: string, stops: string[]): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  let from = origin;
  for (let i = 0; i < stops.length; i += PER_LINK + 1) {
    const leg = stops.slice(i, i + PER_LINK + 1);
    const dest = leg[leg.length - 1];
    const via = leg.slice(0, -1);
    const p = new URLSearchParams({ api: "1", origin: from, destination: dest, travelmode: "driving" });
    if (via.length) p.set("waypoints", via.join("|"));
    out.push({
      label: stops.length > PER_LINK + 1 ? `Stops ${i + 1}–${i + leg.length}` : "Whole route",
      href: `https://www.google.com/maps/dir/?${p.toString()}`,
    });
    from = dest;
  }
  return out;
}

export function fmtMiles(m: number | null | undefined): string {
  if (m === null || m === undefined) return "";
  return m < 10 ? `${m.toFixed(1)} mi` : `${Math.round(m)} mi`;
}

export function fmtMinutes(s: number | null | undefined): string {
  if (s === null || s === undefined) return "";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
