import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { geoKey } from "@/lib/routing";
import { today } from "@/lib/format";
import { ErrorBanner, PageHeader } from "@/components/ui";
import { loadPrintConfig } from "@/lib/printConfig";
import { loadPrintouts } from "@/lib/pdfdocs/load";
import { RouteBuilder, type RouteOrder } from "@/components/RouteBuilder";

type SP = Promise<Record<string, string | undefined>>;

export default async function RoutingPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, profile } = await getSession();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today();

  const [{ data: shops }, { data: settings }] = await Promise.all([
    supabase.from("shop_layouts").select("id, name, address").order("created_at").order("id"),
    supabase.from("app_settings").select("google_maps_key").maybeSingle(),
  ]);
  const route = (sp.route ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  const shop = shops?.find((s) => s.id === sp.shop) ?? shops?.[0];

  let orders: RouteOrder[] = [];
  const routeCounts: Record<string, number> = {};
  let saved: { stops: string[]; driver: string | null } | null = null;
  const coords: Record<string, { lat: number; lng: number }> = {};
  if (shop) {
    const [{ data: rows }, { data: sheet }] = await Promise.all([
      supabase
        .from("sales_orders")
        .select("id, so_number, status, delivery_address, must_check, ship_date, label_count, customers(name, route_code, phone)")
        .eq("ship_date", date)
        .eq("layout_id", shop.id)
        .in("status", ["completed", "invoiced"])
        .order("so_number"),
      supabase.from("route_sheets").select("stops, driver").eq("route_date", date).eq("layout_id", shop.id).eq("route_code", route).maybeSingle(),
    ]);
    const all = (rows ?? []).map((o: any) => ({
      id: o.id,
      number: o.so_number,
      customer: o.customers?.name ?? "",
      address: o.delivery_address ?? "",
      status: o.status,
      route: o.customers?.route_code ?? null,
      boxes: o.label_count ?? null,
      phone: o.customers?.phone ?? null,
    }));
    for (const o of all) routeCounts[o.route ?? "—"] = (routeCounts[o.route ?? "—"] ?? 0) + 1;
    orders = route ? all.filter((o) => o.route === route) : all;
    saved = sheet ? { stops: sheet.stops ?? [], driver: sheet.driver } : null;
    // Orders scanned onto this route that ship on another day
    const extraIds = (saved?.stops ?? []).filter((id) => !orders.some((o) => o.id === id));
    if (extraIds.length) {
      const { data: more } = await supabase
        .from("sales_orders")
        .select("id, so_number, status, delivery_address, ship_date, label_count, customers(name, route_code, phone)")
        .in("id", extraIds)
        .in("status", ["completed", "invoiced"]);
      for (const o of (more ?? []) as any[])
        orders.push({ id: o.id, number: o.so_number, customer: o.customers?.name ?? "", address: o.delivery_address ?? "", status: o.status, ships: o.ship_date, route: o.customers?.route_code ?? null, boxes: o.label_count ?? null, phone: o.customers?.phone ?? null });
    }
    const keys = [...new Set([...orders.map((o) => geoKey(o.address)), geoKey(shop.address)].filter(Boolean))];
    if (keys.length) {
      const { data: g } = await supabase.from("geocodes").select("address, lat, lng").in("address", keys);
      for (const r of g ?? []) coords[r.address] = { lat: Number(r.lat), lng: Number(r.lng) };
    }
  }

  return (
    <>
      <PageHeader title="Routing" subtitle="Pick the day's completed orders, set the stop order and print the route sheet">
        <Link href="/settings/routing" className="btn print:hidden">
          Maps & shop addresses
        </Link>
      </PageHeader>
      <ErrorBanner error={sp.error} />
      {shop && Object.keys(routeCounts).length > 0 && (
        <nav className="mb-4 flex flex-wrap items-center gap-2 print:hidden" aria-label="Routes" data-testid="route-chips">
          <span className="text-sm text-stone-500">Route:</span>
          {[["", "All", Object.values(routeCounts).reduce((a, b) => a + b, 0)] as const, ...Object.entries(routeCounts).sort().map(([k, n]) => [k === "—" ? "" : k, k, n] as const)]
            .map(([k, label, n]) =>
              label === "—" ? (
                <span key="none" className="rounded-full border border-dashed border-stone-300 px-3 py-1 text-xs text-stone-500" title="Customers with no route set">
                  No route · {n}
                </span>
              ) : (
                <Link
                  key={label}
                  href={`/routing?date=${date}${shop.id !== shops?.[0]?.id ? `&shop=${shop.id}` : ""}${k ? `&route=${k}` : ""}`}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${route === k ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 hover:border-brand-500"}`}
                  aria-current={route === k ? "true" : undefined}
                >
                  {label} · {n}
                </Link>
              ),
            )}
        </nav>
      )}
      {!shop ? (
        <p className="text-sm text-stone-500">Add a shop in Location in shop first.</p>
      ) : (
        <RouteBuilder
          key={`${date}-${shop.id}-${route}`}
          routeCode={route}
          date={date}
          shops={(shops ?? []).map((s) => ({ id: s.id, name: s.name }))}
          shop={{ id: shop.id, name: shop.name, address: shop.address ?? "" }}
          orders={orders}
          saved={saved}
          coords={coords}
          mapsKey={settings?.google_maps_key ?? null}
          canEdit={can(profile, "orders_manager", "warehouse")}
          print={await loadPrintConfig(supabase)}
          sheet={(await loadPrintouts(supabase, ["route"])).templates.route}
        />
      )}
    </>
  );
}
