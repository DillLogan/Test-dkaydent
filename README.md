# DKaydent Wholesale

Purchasing, inventory and sales tracking for a wholesale flower and hard goods operation.

**Stack:** Next.js 15 (App Router, server actions) · Supabase (Postgres, Auth, row-level security) · Tailwind CSS 4

## What it does

| Area | Features |
|---|---|
| **Products** | Flowers/greens and hard goods. Each product has a base unit (stem, each, roll) plus any pack units (bunch = 25, box = 250, case = 12). Variety, color, grade, stem length, shelf life, reorder point. |
| **Purchasing** | Vendors (growers, distributors, suppliers) → draft PO → ordered → receive (partial or full) → received / closed short. Freight and other charges are spread across lines by value to get a **landed cost** per base unit. |
| **Receiving** | Plan **inbound shipments up to one year out**: carrier, AWB/tracking, ETA, status (planned → in transit → arrived → received), with several POs per shipment. A 12-month week-by-week plan plus a list; late shipments are flagged here and on the dashboard. **Receive a whole shipment on one screen** (locations default to each item's home area; same landed-cost and lot rules as PO receiving). **Standing orders** (weekly, every 2 weeks, monthly) plan their own draft POs and shipments 12 months ahead; edit or skip any single delivery. Pausing or ending removes only planned deliveries nobody edited. |
| **Inventory** | Every receipt creates a **lot** with location, receive date, expiry (defaults from shelf life) and landed cost. Transfer between coolers/shelves (splits a lot), record shrink with a reason, cycle-count adjustments. Full movement log. **Photos**: a main photo per product and a delivery photo per lot (resized in the browser, stored in Supabase Storage), shown as thumbnails across lists. |
| **Location in shop** | A floor plan for each shop. Add, rename or delete **layouts** (one per shop); each section (stock location) belongs to one shop. Sections are dragged into place and resized from the bottom-right corner, optionally over an uploaded floor image. Mark **entries and exits** with their own labels and drag them along the walls. Each item has a **home area** per shop. Find an item to see where it belongs and where its stock is right now; items out of place are listed. |
| **Pull ticket** | Print from any open sales order. Lists what to pull, oldest lots first (the same lots fulfilling will take), grouped by shop and section, sections A to Z and items A to Z inside each, with a check box per line and anything not in stock at the end. |
| **Sales** | Customers with price tiers and payment terms → draft order → confirmed → **fulfilled** → invoiced. Fulfill oldest-lot-first automatically, or **hand-pick lots** (pre-filled with the oldest-first suggestion; scan lot labels to pick from them). Exact cost is recorded per lot either way. Suggested prices come from the tier's price list, or average landed cost + tier markup. Over-orders are blocked with nothing pulled. |
| **Counter sale & payments** | Ring up walk-in sales by scanning or searching; stock is pulled only after payment. Payments by card, cash, check or other, **partial payments** and **deposits** on orders, balances on invoices. Charge on **Valor terminals** (VP550, VP800, VL100, VL110, VL500, VL550) from counter sales, invoices and deposits; always optional. **Sync terminal sales** from a Valor portal/POS export (matches invoice numbers, maps terminal items to products, remembers the mapping, never imports a transaction twice). |
| **Recurring orders** | A **Recurring order** button sits next to **New sales order** on each customer. Choose items and how often (weekly, every 2 weeks, monthly); it plans **draft sales orders 12 months ahead**, priced at the customer's current tier price (untouched drafts are re-priced when prices change). Edit, confirm or skip any single order; pausing or ending removes only the drafts nobody edited. Planned drafts appear in the open order list a week before they ship. On vendors, **Recurring order** opens a standing order with that vendor filled in. |
| **Invoices** | Generated from fulfilled orders with optional sales tax, due date from customer terms. Printable/PDF. Mark paid. **Void** an open invoice to send the order back to fulfilled, correct it, and invoice again. |
| **Returns & credits** | Return items from a fulfilled or invoiced order (RMA numbers). Each unit goes back into the **exact lot it shipped from**; items that can't be resold are written off as shrink. The customer gets a credit at the sale price plus the invoice's tax, tracked open → applied / refunded. Reports net returns out of revenue and cost. |
| **CSV** | Import **stock on hand** as a batch (each row a lot; new SKUs created and **auto-sorted into categories** by editable keyword rules). Export products, vendors, customers, lots, movements, POs, sales orders, invoices, returns, and report data. Import products (with pack units), vendors and customers from CSV with a row-by-row preview and errors before anything is saved; downloadable templates. |
| **Barcodes & label printing** | Code 128 labels for any product (single, or tick several on the Products list) and for lots — from a lot, a PO's receipts, or any filtered lot list. Prints through the computer's print dialog, so any connected printer works. **Label printer** mode prints one label per page at the exact label size (2.25×1.25, 2×1, 3×2, 4×2, 4×6 in, DYMO 30252 or custom); **Regular printer** mode lays labels out on letter or A4 paper with cut lines. Defaults are set per computer in **Settings → Printing** and can be changed for any single print. **Scan** page works with USB/Bluetooth scanners and the phone or tablet camera, and opens the matching lot, product, PO, order, invoice or return. |
| **Reports** | Net revenue, FIFO COGS, gross margin, shrink — by product and customer for any date range, with returns shown. Sell-through and shrink rate per product. Inventory aging buckets (flowers vs hard goods). |
| **Settings** | Appearance: four palettes (**Fern** white and green by default, **Peony & eucalyptus**, **Ranunculus & linen**, **Hydrangea & stone**), each in Light, Dark or System. Saved per browser; invoices, labels and pull tickets always print in black and white. Products and lots show as photo cards or a table (remembered per browser). |
| **Web store** | Connects the shop's separate ordering website (Admin → Web store). Its stock counts are the source of truth: each count sets on-hand here for matched SKUs, plus whatever open web orders still need (so nothing is counted twice), recorded as **Web sync** adjustments. Web orders become **confirmed sales orders** once each (matched to a customer by email, else a Web orders customer); an order with an unknown SKU waits as a draft. Data arrives by **signed webhook** as it happens, by **Sync now**, and by a daily scheduled pull. A field-name table maps the website's own JSON, a sample preview checks it, and unknown website SKUs are linked to an item and unit. |
| **Dashboard** | Inventory value, lots expiring within 3 days, items at reorder point, open POs, orders to fulfill, open and overdue invoices, 30-day revenue and margin. |

### Roles

| Role | Can |
|---|---|
| **Admin** | Everything, plus activate users and assign roles |
| **Buyer** | Products, units, vendors, purchase orders, receiving, shipments, standing orders, category rules |
| **Warehouse** | Locations, receiving, shipments, transfers, shrink, counts, fulfillment, floor plan layout |
| **Sales** | Customers, price tiers and prices, sales orders, fulfillment, invoices, counter sales, payments |

Everyone who is active can **view** everything. Write access is enforced in the database with row-level security, not just hidden in the UI. Stock tables (lots, movements, allocations) can only change through database functions, so inventory can't drift from its history.

**The first person to sign up becomes an active admin.** Everyone after that signs up as an inactive user and waits on **Users & roles** until an admin activates them.

## Setup

### 1. Create the Supabase project
1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema, either:
   - **CLI:** `npx supabase link --project-ref <your-ref>` then `npx supabase db push`
   - **Dashboard:** SQL Editor → run each file in `supabase/migrations/` **in filename order**, one at a time (the second one adds an enum value that the third uses, so they can't be combined)
   - The `…_item_images_storage.sql` migration creates the public `item-images` Storage bucket for photos (it skips itself where Storage isn't installed).
3. Optional starter data (coolers, price tiers, sample roses/hydrangea/vases, two vendors, two customers): run `supabase/seed.sql` the same way. Skip it for a clean start.
4. **Authentication → Providers → Email:** decide whether to require email confirmation. Either works; new users still need admin activation.

### 2. Run locally
```bash
cp .env.example .env.local   # fill in URL + anon key from Project Settings → API
npm install
npm run dev                  # http://localhost:3000
```
Sign up — that first account is your admin.

### 3. Deploy (Vercel)
Import the repo in Vercel, add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `APP_TIMEZONE`, deploy. In Supabase **Authentication → URL Configuration**, set the Site URL to your Vercel domain.

### 4. Valor terminals (optional)
Until Valor gives you developer access, terminal charges run on a **built-in simulator** (Approve / Decline / Time out buttons on screen), so everything can be tried end to end. To go live:
1. Ask Valor to enable **Valor Connect** (cloud) on each terminal in their TMS, and for an **App ID, App Key and the Valor Connect endpoint**.
2. Add the terminals under **Payments → Terminals** (EPI from the Valor portal).
3. Set `VALOR_MODE=live`, `VALOR_CONNECT_URL`, `VALOR_APP_ID`, `VALOR_APP_KEY`.
4. Check every line marked `UNCONFIRMED` in `lib/valor/connect.ts` against Valor's docs (credential headers, status/cancel calls, response field names). The documented fields (TRAN_MODE/TRAN_CODE, amount in cents, INVOICENUMBER, REQ_TXN_ID, STAN) are already used.
5. Optional: point Valor's transaction notifications at `/api/valor/webhook` with `VALOR_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` set (format also unconfirmed).

### 5. Web store connection (optional)
1. Set `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project settings → API) and a random `CRON_SECRET` in Vercel.
2. In the app: **Admin → Web store**. Turn it on, enter the website's inventory and orders addresses (JSON over https) and API key (sent as `Authorization: Bearer …`), make a webhook secret, and fill in the field names to match the website's JSON. Paste a sample under **Try a sample** to check.
3. On the website, send webhooks to `/api/web-store/webhook?type=inventory` and `/api/web-store/webhook?type=order`, signed with header `X-Signature: sha256=<hex HMAC-SHA256 of the raw body using the secret>`.
4. The orders address is called with `?since=<ISO time>` (parameter name configurable) so only recent orders come back; repeats are ignored.
5. `vercel.json` runs the pull once a day (`/api/web-store/sync`), which is what Vercel's Hobby plan allows. On Pro you can change the schedule to every 15 minutes (`*/15 * * * *`), or have any scheduler call that address with `Authorization: Bearer $CRON_SECRET`.

## Tests

```bash
npm run test:db
```
Runs the migrations and seed in an embedded Postgres and checks 202 behaviors: unit conversion, landed cost, partial receiving, status locks, lot splitting, shrink, FIFO and hand-picked costing, all-or-nothing fulfillment, invoicing, voids and re-invoicing, returns to the original lots, credits, role checks and RLS, category rules, stock batches, layouts, entries/exits, home areas per shop, shipments and standing orders, payments, deposits, counter and terminal sales, MUST CHECK, and the web store connection (stock counts, open web orders added back, order import once, unmatched SKUs, cancellations, permissions).

## How the numbers work

- **Base units.** All stock is stored in the base unit. Order lines keep the unit they were entered in (e.g. 2 box), and convert at receive/fulfill time.
- **Landed cost** per base unit = vendor unit cost ÷ units per pack × (1 + (freight + other) ÷ PO product subtotal).
- **FIFO.** Fulfillment draws from the oldest received lots first, across all locations. Each draw is recorded in `sales_allocations` with that lot's cost, so margin is exact and traceable to the lot.
- **Shrink** is valued at the lot's landed cost.
- **Returns** reverse the most recent allocations first and restore that lot's quantity at its original cost; written-off returns are recorded as a return followed by shrink, so they show in shrink reports.

## Project layout

```
app/
  login/                 sign in / sign up
  (app)/                 signed-in area (sidebar layout)
    page.tsx             dashboard
    products/ vendors/ customers/ (+ tiers)
    purchasing/          PO list, PO detail + receiving
    receiving/           shipments (12-month plan), shipment detail, standing orders
    floor-plan/          Location in shop
    counter/ payments/   counter sale, payments, terminals, terminal sales sync
    inventory/           stock, lots/[id], locations, movements
    sales/ invoices/ returns/ reports/ admin/users/
    labels/ scan/        barcode labels, scan-to-open
    import/              CSV import with preview
  export/[entity]/       CSV export endpoint
  api/terminal/[id]/     terminal charge status (polled while waiting for the card)
  api/valor/webhook/     optional Valor notification endpoint
components/              UI primitives, product/unit picker, forms
lib/                     auth, Supabase client, formatting, form helpers
lib/valor/               terminal provider: simulator + Valor Connect adapter
supabase/
  migrations/            schema, functions, views, RLS
  seed.sql               optional starter data
  tests/                 schema test suite (PGlite)
middleware.ts            session refresh + login redirect
```

## Notes

- Motion (button lift, row highlight, page entrance, theme cross-fade) turns off automatically for anyone with "reduce motion" enabled on their device.
- Camera scanning needs HTTPS (any deployed site is) and works in current Safari, Chrome and Edge on phones and tablets.
- Voiding an invoice doesn't move stock; record a return for goods that come back.
- Report date ranges use calendar days in UTC for the database filter.
