import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { DEFAULT_MAP, MAP_FIELDS, withDefaults } from "@/lib/webstore";
import { SubmitButton } from "@/components/SubmitButton";
import { WebStorePreview } from "@/components/WebStorePreview";
import { Empty, ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";
import {
  dismissUnmatched,
  linkSku,
  newWebhookSecret,
  previewMapping,
  resetFieldMap,
  saveConnection,
  saveFieldMap,
  syncNow,
  unlinkSku,
} from "./actions";

type SP = Promise<Record<string, string | undefined>>;

function runText(r: any) {
  const s = r.summary ?? {};
  if (!r.ok) return r.error || "Failed";
  if (r.kind === "inventory")
    return `${s.items ?? 0} items · ${s.updated ?? 0} updated · ${s.unchanged ?? 0} unchanged${s.unmatched?.length ? ` · ${s.unmatched.length} not matched` : ""}`;
  return `${s.orders ?? 0} orders · ${s.created ?? 0} new${s.exists ? ` · ${s.exists} already here` : ""}${s.needs_review ? ` · ${s.needs_review} to review` : ""}${s.cancelled ? ` · ${s.cancelled} cancelled` : ""}`;
}

export default async function WebStorePage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase } = await requireRole();
  const [{ data: cfg }, { data: runs }, { data: unmatched }, { data: links }, { data: locations }, { data: customers }, { data: products }, { data: units }] =
    await Promise.all([
      supabase.from("web_store_settings").select("*").eq("id", 1).single(),
      supabase.from("web_sync_runs").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("web_unmatched_skus").select("*").order("last_seen", { ascending: false }),
      supabase.from("web_sku_links").select("external_sku, products(name, sku), product_units(name, factor)").order("external_sku"),
      supabase.from("locations").select("id, name").eq("active", true).order("name"),
      supabase.from("customers").select("id, name").eq("active", true).order("name"),
      supabase.from("products").select("id, sku, name, base_unit").eq("active", true).order("name"),
      supabase.from("product_units").select("id, product_id, name, factor").order("factor"),
    ]);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const map = withDefaults(cfg?.field_map);
  const combos = (products ?? []).flatMap((p) =>
    (units ?? [])
      .filter((u) => u.product_id === p.id)
      .map((u) => ({ value: `${p.id}:${u.id}`, label: `${p.name} (${p.sku}) — ${u.name}${Number(u.factor) !== 1 ? ` of ${Number(u.factor)} ${p.base_unit}` : ""}` })),
  );
  const last = (kind: string) => (runs ?? []).find((r) => r.kind === kind);

  return (
    <>
      <PageHeader title="Web store" subtitle="Bring stock counts and web orders in from your ordering website" back={{ href: "/settings", label: "Settings" }}>
        <form action={syncNow}>
          <SubmitButton className="btn btn-primary" pendingText="Syncing…">
            Sync now
          </SubmitButton>
        </form>
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <div className="mb-10 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="text-sm text-stone-500">Connection</div>
          <div className="font-display mt-1 text-2xl">{cfg?.enabled ? "On" : "Off"}</div>
          <div className="mt-1 text-xs text-stone-500">{cfg?.enabled ? "Webhooks and the daily sync are accepted" : "Webhooks are refused until you turn it on"}</div>
        </div>
        {(["inventory", "orders"] as const).map((k) => {
          const r = last(k);
          return (
            <div key={k} className="card">
              <div className="text-sm text-stone-500">Last {k === "inventory" ? "stock" : "orders"} sync</div>
              <div className={`font-display mt-1 text-2xl ${r && !r.ok ? "text-red-700" : ""}`}>{r ? (r.ok ? "Worked" : "Failed") : "Never"}</div>
              <div className="mt-1 text-xs text-stone-500">{r ? `${dateTime(r.created_at)} · ${runText(r)}` : "Nothing received yet"}</div>
            </div>
          );
        })}
      </div>

      <Section title="How it works">
        <div className="card space-y-2 text-[15px] text-stone-600">
          <p>
            Your website is the source of truth for stock. Each count it sends sets on-hand here for that item, plus anything already on
            web orders that hasn&apos;t been pulled yet, so it isn&apos;t counted twice. Changes show in the movement log as{" "}
            <b>Web sync</b>. Counts going up are added to the location you pick below; counts going down come out of the oldest lots first.
          </p>
          <p>
            Each web order becomes a confirmed sales order, once. It goes to the customer with the same email, or to the web orders customer.
            If an order has a SKU we don&apos;t know, it waits as a draft and the SKU shows up below to link.
          </p>
        </div>
      </Section>

      <Section title="Connection">
        <form action={saveConnection} className="card grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" name="enabled" defaultChecked={!!cfg?.enabled} className="h-4 w-4" />
            <span className="text-sm font-medium">Turn on the web store connection</span>
          </label>
          <label>
            <span className="label">Inventory address (optional)</span>
            <input name="inventory_url" className="input" defaultValue={cfg?.inventory_url ?? ""} placeholder="https://shop.example.com/api/inventory" />
          </label>
          <label>
            <span className="label">Orders address (optional)</span>
            <input name="orders_url" className="input" defaultValue={cfg?.orders_url ?? ""} placeholder="https://shop.example.com/api/orders" />
          </label>
          <label>
            <span className="label">API key {cfg?.api_key ? "(saved; leave blank to keep it)" : ""}</span>
            <input name="api_key" type="password" className="input" autoComplete="off" placeholder={cfg?.api_key ? "••••••••" : "Sent as Authorization: Bearer …"} />
            {cfg?.api_key && (
              <span className="mt-1.5 flex items-center gap-2 text-xs text-stone-500">
                <input type="checkbox" name="clear_api_key" /> Remove the saved key
              </span>
            )}
          </label>
          <label>
            <span className="label">Stock that goes up lands in</span>
            <select name="stock_location_id" className="input" defaultValue={cfg?.stock_location_id ?? ""}>
              <option value="">Receiving dock (or the first location)</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Web orders with no matching customer go to</span>
            <select name="web_customer_id" className="input" defaultValue={cfg?.web_customer_id ?? ""}>
              <option value="">“Web orders” (made on the first order)</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>Save connection</SubmitButton>
          </div>
        </form>
      </Section>

      <Section title="Webhooks">
        <div className="card space-y-4 text-sm">
          <p className="text-[15px] text-stone-600">
            Have the website post to these addresses whenever stock changes or an order is placed, changed or cancelled. Each post is signed
            with the secret below: header <code className="rounded bg-stone-100 px-1">X-Signature: sha256=&lt;HMAC-SHA256 of the body, hex&gt;</code>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="label">Stock updates</span>
              <input readOnly className="input font-mono text-xs" value={`${origin}/api/web-store/webhook?type=inventory`} />
            </label>
            <label>
              <span className="label">Orders</span>
              <input readOnly className="input font-mono text-xs" value={`${origin}/api/web-store/webhook?type=order`} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1">
              <span className="label">Webhook secret</span>
              {cfg?.webhook_secret ? (
                <input readOnly className="input font-mono text-xs" value={cfg.webhook_secret} />
              ) : (
                <div className="text-stone-500">None yet. Make one, then paste it into the website.</div>
              )}
            </label>
            <form action={newWebhookSecret}>
              <SubmitButton className="btn" confirm={cfg?.webhook_secret ? "Make a new secret? The website must be updated or its webhooks will be refused." : undefined}>
                {cfg?.webhook_secret ? "Make a new secret" : "Make a secret"}
              </SubmitButton>
            </form>
          </div>
          <p className="text-xs text-stone-500">
            The daily sync also pulls from the addresses above in case a webhook was missed. It needs SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET on
            the server (see the README).
          </p>
        </div>
      </Section>

      <Section
        title="Field names"
        actions={
          <form action={resetFieldMap}>
            <SubmitButton className="btn btn-sm" pendingText="…">
              Reset to defaults
            </SubmitButton>
          </form>
        }
      >
        <p className="mb-3 text-[15px] text-stone-600">
          Where each piece of information sits in the website&apos;s JSON. Use dots for nested fields, like <code>customer.email</code>. Leave a
          list field empty if the response is the list itself.
        </p>
        <form action={saveFieldMap} className="card space-y-5">
          {(["Inventory", "Orders", "Order lines"] as const).map((g) => (
            <fieldset key={g}>
              <legend className="mb-2 text-sm font-medium text-stone-800">{g}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MAP_FIELDS.filter((f) => f.group === g).map((f) => (
                  <label key={f.key}>
                    <span className="label">{f.label}</span>
                    <input name={f.key} className="input" defaultValue={map[f.key]} placeholder={DEFAULT_MAP[f.key] || "(the response itself)"} />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <SubmitButton>Save field names</SubmitButton>
        </form>
      </Section>

      <Section title="Try a sample">
        <p className="mb-3 text-[15px] text-stone-600">Paste something the website sends to check the field names. Nothing is changed.</p>
        <WebStorePreview preview={previewMapping} />
      </Section>

      <Section title="Website SKUs to link">
        {!unmatched?.length ? (
          <Empty>Every SKU the website has sent matches an item here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Website SKU</th>
                  <th>Seen in</th>
                  <th>Link to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {unmatched.map((u) => (
                  <tr key={u.external_sku}>
                    <td className="font-medium">{u.external_sku}</td>
                    <td className="text-stone-500">
                      {u.seen_in === "order" ? "an order" : "stock counts"}
                      {u.last_qty !== null ? ` · ${Number(u.last_qty)}` : ""} · {dateTime(u.last_seen)}
                    </td>
                    <td>
                      <form action={linkSku} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="sku" value={u.external_sku} />
                        <select name="product_unit" className="input w-auto max-w-80" required defaultValue="" aria-label={`Item for ${u.external_sku}`}>
                          <option value="" disabled>
                            Choose item and unit…
                          </option>
                          {combos.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className="btn btn-sm" pendingText="…">
                          Link
                        </SubmitButton>
                      </form>
                    </td>
                    <td className="text-right">
                      <form action={dismissUnmatched.bind(null, u.external_sku)}>
                        <SubmitButton className="btn btn-sm" pendingText="…">
                          Dismiss
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!!links?.length && (
          <div className="mt-4">
            <div className="label">Linked website SKUs</div>
            <ul className="space-y-1.5 text-sm">
              {links.map((l: any) => (
                <li key={l.external_sku} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.external_sku}</span>
                  <span className="text-stone-500">
                    → {l.products?.name} ({l.products?.sku}), {l.product_units?.name}
                  </span>
                  <form action={unlinkSku.bind(null, l.external_sku)}>
                    <SubmitButton className="btn btn-sm" pendingText="…">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Sync history">
        {!runs?.length ? (
          <Empty>Nothing has come in from the website yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>How</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dateTime(r.created_at)}</td>
                    <td>{r.kind === "inventory" ? "Stock" : "Orders"}</td>
                    <td className="text-stone-500">{r.source === "webhook" ? "Webhook" : r.source === "pull" ? "Daily sync" : "Sync now"}</td>
                    <td className={r.ok ? "" : "text-red-700"}>{runText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
