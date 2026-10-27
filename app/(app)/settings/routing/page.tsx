import { requireRole } from "@/lib/auth";
import { setMapsKey, setShopAddress } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Field, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function RoutingSettingsPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase } = await requireRole();
  const [{ data: settings }, { data: shops }] = await Promise.all([
    supabase.from("app_settings").select("google_maps_key").maybeSingle(),
    supabase.from("shop_layouts").select("id, name, address").order("created_at").order("id"),
  ]);
  const key = settings?.google_maps_key ?? null;

  return (
    <>
      <PageHeader title="Maps & routing" subtitle="Google Maps key and where each shop's deliveries start" back={{ href: "/settings", label: "Settings" }} />
      <ErrorBanner error={error} />
      <Notice message={message} />

      <Section title="Google Maps key">
        <form action={setMapsKey} className="card space-y-3">
          <p className="text-sm text-stone-500">
            Turns on the live map, address lookup and drive-distance sorting on Routing. In Google Cloud, turn on <b>Maps JavaScript API</b>,{" "}
            <b>Geocoding API</b> and <b>Routes API</b>, then lock the key to this app&apos;s web address (Application restrictions → Websites). The key
            is sent to the browser, so the website lock is what keeps it safe.
          </p>
          <Field label={key ? `Key saved (ends …${key.slice(-4)})` : "API key"}>
            <input name="google_maps_key" className="input font-mono" placeholder={key ? "Paste a new key to replace it" : "AIza…"} autoComplete="off" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <SubmitButton>Save key</SubmitButton>
            {key && (
              <button name="clear" value="1" className="btn btn-danger">
                Remove key
              </button>
            )}
          </div>
          {!key && (
            <p className="text-xs text-stone-500">
              Without a key, Routing still works: sort stops by hand, print the route sheet and open the route in Google Maps.
            </p>
          )}
        </form>
      </Section>

      <Section title="Shop addresses">
        <p className="mb-3 text-sm text-stone-500">Routes start here. Closest to farthest is measured from this address. It also prints on invoices as &ldquo;Ships from&rdquo;.</p>
        <div className="space-y-3">
          {(shops ?? []).map((s) => (
            <form key={s.id} action={setShopAddress.bind(null, s.id)} className="card flex flex-wrap items-end gap-3" data-shop={s.name}>
              <Field label={s.name} className="min-w-64 flex-1">
                <input name="address" className="input" defaultValue={s.address ?? ""} placeholder="Street, city, state ZIP" autoComplete="street-address" />
              </Field>
              <SubmitButton className="btn">Save</SubmitButton>
            </form>
          ))}
        </div>
      </Section>
    </>
  );
}
