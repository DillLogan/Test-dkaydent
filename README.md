# DKaydent Wholesale

Purchasing, inventory and sales for our wholesale flower / hard goods business.
Next.js 15 (app router + server actions), Supabase (Postgres, auth, RLS), Tailwind 4.

Rough feature list:

- products with a base unit (stem, each) and pack units (bunch = 25, box = 250, ...)
- vendors, POs, receiving (partial, close short), landed cost with freight spread by value
- inbound shipments planned up to a year out, standing orders that generate draft POs, direct ship to a customer
- lots per receipt with location / section / shelf, expiry, transfers, shrink, counts, movement log
- floor plan per shop ("Location in shop"), home areas, entries/exits
- sales orders -> pull ticket -> pulled -> completed -> invoiced, FIFO or hand-picked lots
- customer logins with their own shop and cart, reps shopping on a customer's behalf
- counter sales, payments, deposits, Valor terminals (simulator until we get API access)
- recurring orders, returns/credits, routing + route sheets, box labels
- printouts as PDFs with a layout designer, barcode labels, scan-to-open
- messenger, documents (word editor + PDF signing), knowledge base / tutorials
- CSV import/export, reports, web store sync

## Roles

admin, buyer (shown as "Staff"), warehouse, sales, orders_manager ("Delivery/Order Management") and customer.
Everyone active can read; writes are enforced with RLS in the database, and stock tables only change
through the db functions so on-hand can't drift from the movement history.

The first account to sign up becomes the admin. Everyone after that starts inactive until an admin turns them on
(Settings -> Users & roles).

## Setup

1. Make a Supabase project and apply `supabase/migrations/` in filename order, either
   `npx supabase link --project-ref <ref>` + `npx supabase db push`, or paste them into the SQL editor one at a time.
   Some migrations only add enum values for the next one, so don't combine them.
2. `supabase/seed.sql` has some starter data (coolers, tiers, a few products, vendors and customers). Optional.
3. Locally:

   ```bash
   cp .env.example .env.local   # Supabase URL + anon key
   npm install
   npm run dev
   ```

4. Vercel: set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_TIMEZONE`, then set the site URL
   in Supabase auth settings to the Vercel domain.

Other env vars, all optional:

| var | used for |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | webhooks, scheduled sync, signing links |
| `NEXT_PUBLIC_SITE_URL` | base URL used in emailed links |
| `RESEND_API_KEY`, `MAIL_FROM` | password reset + signature request emails |
| `CRON_SECRET` | `/api/web-store/sync` (vercel.json runs it daily) |
| `WEBSTORE_WEBHOOK_SECRET` | overrides the secret saved in Settings -> Web store |
| `VALOR_MODE=live`, `VALOR_CONNECT_URL`, `VALOR_APP_ID`, `VALOR_APP_KEY` | real terminals |
| `VALOR_WEBHOOK_SECRET` | `/api/valor/webhook` |
| `GIPHY_API_KEY` | GIF search in messages |

### Valor

Until Valor gives us dev access the terminals run on a simulator (approve / decline / timeout buttons on screen).
To go live: get Valor Connect enabled on the terminals, add them under Payments -> Terminals, set the env vars above,
and go through every `UNCONFIRMED` line in `lib/valor/connect.ts` (header names, poll/cancel calls, response fields).

### Web store

Settings -> Web store: inventory + orders URLs, API key (sent as a bearer token), webhook secret, and the field map
for the site's JSON (there's a sample preview to check it). The site should post to
`/api/web-store/webhook?type=inventory` and `?type=order` with `X-Signature: sha256=<hex hmac of the raw body>`.
Orders are fetched with `?since=<iso time>`; repeats are ignored.

## Tests

```bash
npm run test:db
```

Runs every migration + the seed in PGlite and checks the database behaviour (units, landed cost, FIFO, receiving,
invoicing, returns, RLS, payments, web store, direct ship, ...).

`tests/` has a couple of plain node tests (theme generator, kb search).

## How the numbers work

- Stock is stored in base units. Order lines keep the unit they were entered in and convert on receive / fulfill.
- Landed cost per base unit = unit cost / pack size * (1 + (freight + other) / PO subtotal).
- Fulfilling takes the oldest lots first (unless lots are hand-picked or held for a direct-ship order). Every draw
  is written to `sales_allocations` at that lot's cost, so margin is exact per lot.
- Shrink is valued at landed cost. Returns reverse the newest allocations first and go back into the same lots.

## Layout

```
app/(app)/       signed-in pages (dashboard, purchasing, receiving, sales, inventory, ...)
app/api/         signing, terminals, web store webhook/sync, word editor, giphy
app/export/      CSV export
components/      UI
lib/             data helpers, pdf rendering (lib/pdfdocs), valor adapter, theme generator
supabase/        migrations, seed, schema tests
```

## Misc

- Animations are off for anyone with reduce-motion turned on.
- Camera scanning needs https.
- Voiding an invoice doesn't move stock, use a return for goods that come back.
- Report date ranges are UTC calendar days.
