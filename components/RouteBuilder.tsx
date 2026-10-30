"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closestFirst, fmtMiles, geoKey, mapsLinks, miles, type LatLng } from "@/lib/routing";
import { saveGeocodes, saveRoute, scanRouteOrder } from "@/app/(app)/routing/actions";
import type { PrintConfig } from "@/lib/printConfig";
import { ScanInput } from "@/components/ScanInput";
import { PdfModal } from "@/components/pdf/PdfViewer";
import { renderDoc } from "@/lib/pdfdocs/render";
import { routeData } from "@/lib/pdfdocs/data";
import type { Template } from "@/lib/pdfdocs/types";

export type RouteOrder = { id: string; number: string; customer: string; address: string; status: string; ships?: string | null; route?: string | null; boxes?: number | null; phone?: string | null };
type Shop = { id: string; name: string; address: string };

declare global {
  interface Window {
    google?: any;
  }
}

function loadMaps(key: string): Promise<any> {
  if (window.google?.maps?.Geocoder) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("Google Maps didn't load. Check the key and its website restriction."));
    document.head.appendChild(s);
  });
}

export function RouteBuilder(props: {
  date: string;
  shops: { id: string; name: string }[];
  shop: Shop;
  orders: RouteOrder[];
  saved: { stops: string[]; driver: string | null } | null;
  coords: Record<string, LatLng>;
  mapsKey: string | null;
  canEdit: boolean;
  routeCode?: string;
  print?: PrintConfig;
  /** the route sheet's PDF layout */
  sheet?: Template;
}) {
  const { date, shop, mapsKey, canEdit } = props;
  const [extra, setExtra] = useState<RouteOrder[]>([]);
  const orders = useMemo(() => [...props.orders, ...extra.filter((e) => !props.orders.some((o) => o.id === e.id))], [props.orders, extra]);
  const router = useRouter();
  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const [stops, setStops] = useState<string[]>(() => {
    const kept = (props.saved?.stops ?? []).filter((id) => byId.has(id));
    return props.saved ? kept : props.orders.map((o) => o.id);
  });
  const [driver, setDriver] = useState(props.saved?.driver ?? "");
  const [pdfOpen, setPdfOpen] = useState(0);
  const [coords, setCoords] = useState(props.coords);
  const [mode, setMode] = useState<"manual" | "optimized">("manual");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [working, setWorking] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);

  const origin = coords[geoKey(shop.address)] ?? null;
  const dist = (id: string) => {
    const c = coords[geoKey(byId.get(id)?.address)];
    return origin && c ? miles(origin, c) : null;
  };
  const off = orders.filter((o) => !stops.includes(o.id));
  const links = shop.address ? mapsLinks(shop.address, stops.map((id) => byId.get(id)?.address ?? "").filter(Boolean)) : [];
  const missing = stops.filter((id) => !byId.get(id)?.address).length;

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
    setMode("manual");
  };

  async function geocodeAll(): Promise<Record<string, LatLng>> {
    const have = { ...coords };
    if (!mapsKey) return have;
    const need = [...new Set([shop.address, ...stops.map((id) => byId.get(id)?.address ?? "")].filter(Boolean))].filter((a) => !have[geoKey(a)]);
    if (!need.length) return have;
    const g = await loadMaps(mapsKey);
    const geocoder = new g.maps.Geocoder();
    const found: { address: string; lat: number; lng: number; formatted?: string }[] = [];
    for (const a of need) {
      try {
        const r = await geocoder.geocode({ address: a });
        const loc = r.results?.[0]?.geometry?.location;
        if (loc) {
          have[geoKey(a)] = { lat: loc.lat(), lng: loc.lng() };
          found.push({ address: geoKey(a), lat: loc.lat(), lng: loc.lng(), formatted: r.results[0].formatted_address });
        }
      } catch {
        /* address not found: leave it uncached */
      }
    }
    if (found.length) await saveGeocodes(found);
    return have;
  }

  async function optimize() {
    setMsg(null);
    setWorking(true);
    try {
      const have = await geocodeAll();
      setCoords(have);
      const o = have[geoKey(shop.address)];
      if (!o) throw new Error(shop.address ? "Couldn't find the shop address. Check it in Maps & shop addresses." : "Add this shop's address in Maps & shop addresses first.");
      const d = (id: string) => {
        const c = have[geoKey(byId.get(id)?.address)];
        return c ? miles(o, c) : null;
      };
      const sorted = closestFirst(stops.map((id) => ({ id })), (s) => d(s.id)).map((s) => s.id);
      setStops(sorted);
      setMode("optimized");
      const unknown = sorted.filter((id) => d(id) === null).length;
      setMsg({ ok: true, text: unknown ? `Sorted closest to farthest. ${unknown} stop(s) have no findable address and were put last.` : "Sorted closest to farthest from the shop." });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Couldn't sort." });
    } finally {
      setWorking(false);
    }
  }

  async function showMap() {
    if (!mapsKey || !mapEl.current) return;
    const g = await loadMaps(mapsKey);
    const have = await geocodeAll();
    const map = new g.maps.Map(mapEl.current, { center: { lat: 39.5, lng: -98.35 }, zoom: 4, mapTypeControl: false });
    const bounds = new g.maps.LatLngBounds();
    const pts: LatLng[] = [];
    const o = have[geoKey(shop.address)];
    if (o) {
      new g.maps.Marker({ position: o, map, label: "S", title: shop.name });
      bounds.extend(o);
      pts.push(o);
    }
    stops.forEach((id, i) => {
      const c = have[geoKey(byId.get(id)?.address)];
      if (!c) return;
      new g.maps.Marker({ position: c, map, label: String(i + 1), title: byId.get(id)?.customer });
      bounds.extend(c);
      pts.push(c);
    });
    if (pts.length > 1) {
      new g.maps.Polyline({ path: pts, map, strokeColor: "#15803d", strokeWeight: 3 });
      map.fitBounds(bounds);
    } else if (pts.length === 1) {
      map.setCenter(pts[0]);
      map.setZoom(12);
    }
  }

  function save() {
    start(async () => {
      const r = await saveRoute({ date, layoutId: shop.id, stops, mode, driver: driver || null, routeCode: props.routeCode });
      setMsg(r.ok ? { ok: true, text: "Route saved." } : { ok: false, text: r.error });
    });
  }

  async function onScan(code: string) {
    const r = await scanRouteOrder(code);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    const o = r.order;
    if (stops.includes(o.id)) return setMsg({ ok: true, text: `${o.number} (${o.customer}) is already on the route.` });
    setExtra((x) => (x.some((e) => e.id === o.id) ? x : [...x, { ...o, ships: o.ships && o.ships !== date ? o.ships : null }]));
    setStops((st) => [...st, o.id]);
    setMode("manual");
    setMsg({ ok: true, text: `Added ${o.number} (${o.customer})${o.ships && o.ships !== date ? ` — it ships ${o.ships}, not ${date}` : ""}. Save the route to keep it.` });
  }

  const nav = (next: { date?: string; shop?: string }) =>
    router.push(`/routing?date=${next.date ?? date}&shop=${next.shop ?? shop.id}`);

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-3 print:hidden">
        <label className="block">
          <span className="label">Delivery day</span>
          <input type="date" className="input" value={date} onChange={(e) => e.target.value && nav({ date: e.target.value })} />
        </label>
        {props.shops.length > 1 && (
          <label className="block">
            <span className="label">Ships from</span>
            <select className="input" value={shop.id} onChange={(e) => nav({ shop: e.target.value })}>
              {props.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="label">Driver</span>
          <input className="input" value={driver} onChange={(e) => setDriver(e.target.value)} maxLength={80} disabled={!canEdit} />
        </label>
        {canEdit && (
          <div className="block min-w-[16rem] flex-1" data-testid="route-scan">
            <span className="label">Scan an invoice to add its order</span>
            <ScanInput onCode={onScan} placeholder="Scan the invoice barcode, then Enter" label="Scan invoice" />
          </div>
        )}
        <div className="text-sm text-stone-500">
          Start: {shop.address || <span className="text-amber-700">no address set for {shop.name}</span>}
        </div>
      </div>

      {msg && (
        <div role="status" className={`rounded-2xl border px-5 py-3 text-sm print:hidden ${msg.ok ? "border-brand-100 bg-brand-50 text-brand-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {msg.text}
        </div>
      )}

      {!orders.length && !stops.length ? (
        <p className="text-sm text-stone-500">No completed orders ship from {shop.name} on this day. The orders manager completes them on the order page.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 print:hidden">
            {canEdit && (
              <>
                <button className="btn" onClick={optimize} disabled={working || stops.length < 2} data-testid="optimize">
                  {working ? "Sorting…" : "Optimize: closest to farthest"}
                </button>
                <button className="btn btn-primary" onClick={save} disabled={busy}>
                  {busy ? "Saving…" : "Save route"}
                </button>
              </>
            )}
            <button className="btn" onClick={() => setPdfOpen((n) => n + 1)} disabled={!props.sheet} data-testid="route-pdf">
              Route sheet (PDF)
            </button>
            {mapsKey && (
              <button className="btn" onClick={showMap}>
                Show on map
              </button>
            )}
          </div>
          {!mapsKey && canEdit && (
            <p className="text-xs text-stone-500 print:hidden">
              No Google Maps key yet, so Optimize can only use addresses already looked up. Add the key in Maps &amp; shop addresses to turn on live lookup and the map.
            </p>
          )}
          {mapsKey && <div ref={mapEl} className="h-72 rounded-2xl border border-stone-200 bg-stone-100 print:hidden" aria-label="Route map" />}

          {props.sheet && (
            <PdfModal
              open={pdfOpen > 0}
              onClose={() => setPdfOpen(0)}
              title={`Route sheet · ${date}`}
              filename={`Route sheet ${date}${props.routeCode ? ` ${props.routeCode}` : ""}.pdf`}
              buildKey={String(pdfOpen)}
              build={() =>
                renderDoc(
                  props.sheet!,
                  routeData({
                    business: { name: props.print?.header.name ?? "", address: props.print?.header.address ?? "", phone: props.print?.header.phone ?? "", footer: props.print?.header.footer ?? "" },
                    day: date,
                    code: props.routeCode,
                    shop: shop.name,
                    driver,
                    start: shop.address,
                    stops: stops.map((id) => byId.get(id)!).filter(Boolean).map((o) => ({ customer: o.customer, address: o.address, order: o.number, phone: o.phone, boxes: o.boxes })),
                  }),
                  { title: `Route sheet ${date}` },
                )
              }
            />
          )}
          <section aria-label="Route sheet" data-testid="route-sheet" className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-900 print:border-0 print:p-0">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-stone-900 pb-2">
              <h2 className="text-lg font-bold">Route sheet · {date}{props.routeCode ? ` · Route ${props.routeCode}` : ""}</h2>
              <div className="text-sm">
                {shop.name}
                {driver && ` · Driver: ${driver}`}
                {mode === "optimized" && " · closest to farthest"}
              </div>
            </header>
            {props.print && (props.print.header.address || props.print.header.phone) && (
              <p className="mb-1 text-xs text-stone-600">
                {props.print.header.name} {props.print.header.address.replace(/\s*\n\s*/g, ", ")} {props.print.header.phone}
              </p>
            )}
            {shop.address && <p className="mb-3 text-sm">Start: {shop.address}</p>}
            <ol className="divide-y divide-stone-200">
              {stops.map((id, i) => {
                const o = byId.get(id)!;
                const d = dist(id);
                return (
                  <li key={id} className="flex items-start gap-3 py-2" data-stop={o.number}>
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {o.customer} <span className="font-mono text-xs text-stone-500">{o.number}</span>
                        {o.ships && o.ships !== date && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">ships {o.ships}</span>}
                      </div>
                      <div className="text-sm">{o.address || <span className="text-amber-700">No delivery address</span>}</div>
                      {(props.print?.route.showPhone ?? true) && o.phone && <div className="text-xs text-stone-600">{o.phone}</div>}
                    </div>
                    {(props.print?.route.showBoxes ?? true) && (
                      <span className="text-xs font-semibold tabular-nums" data-testid="stop-boxes">
                        {o.boxes != null ? `${o.boxes} box${o.boxes === 1 ? "" : "es"}` : "boxes ?"}
                      </span>
                    )}
                    {d !== null && <span className="text-xs text-stone-500 tabular-nums">{fmtMiles(d)} from shop</span>}
                    <span className="mt-1 inline-block h-4 w-4 border-[1.5px] border-stone-900 print:inline-block" aria-label="Delivered" />
                    {canEdit && (
                      <span className="flex gap-1 print:hidden">
                        <button className="btn btn-sm" aria-label={`Move ${o.customer} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                          ↑
                        </button>
                        <button className="btn btn-sm" aria-label={`Move ${o.customer} down`} onClick={() => move(i, 1)} disabled={i === stops.length - 1}>
                          ↓
                        </button>
                        <button className="btn btn-sm" aria-label={`Remove ${o.customer} from route`} onClick={() => setStops(stops.filter((s) => s !== id))}>
                          ✕
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
              {!stops.length && <li className="py-2 text-sm text-stone-500">No stops selected.</li>}
            </ol>
            {stops.length > 0 && (
              <p className="mt-3 border-t-2 border-stone-900 pt-2 text-sm font-semibold" data-testid="route-boxes">
                {stops.length} stop{stops.length === 1 ? "" : "s"}
                {(props.print?.route.showBoxes ?? true) && ` · ${stops.reduce((n, id) => n + (byId.get(id)?.boxes ?? 0), 0)} boxes expected`}
                {(props.print?.route.showBoxes ?? true) && stops.some((id) => byId.get(id)?.boxes == null) ? " (some orders have no label count yet)" : ""}
              </p>
            )}
            {props.print?.header.footer && <p className="mt-3 text-xs text-stone-600">{props.print.header.footer}</p>}
          </section>

          {missing > 0 && <p className="text-xs text-amber-700 print:hidden">{missing} stop(s) have no delivery address. Add one on the order or customer.</p>}

          {off.length > 0 && (
            <section className="print:hidden" aria-label="Not on this route">
              <h3 className="mb-2 text-sm font-semibold">Not on this route</h3>
              <ul className="space-y-1">
                {off.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2 text-sm">
                    <span>
                      {o.customer} <span className="font-mono text-xs text-stone-500">{o.number}</span>
                    </span>
                    {canEdit && (
                      <button className="btn btn-sm" onClick={() => { setStops([...stops, o.id]); setMode("manual"); }}>
                        Add to route
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {links.length > 0 && (
            <div className="flex flex-wrap gap-2 print:hidden">
              {links.map((l) => (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="btn">
                  Open in Google Maps · {l.label}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
