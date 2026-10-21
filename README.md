# DKaydent Wholesale

Purchasing, inventory and sales tracking for a wholesale flower and hard goods operation.

**Stack:** Next.js 15 (App Router, server actions) · Supabase (Postgres, Auth, row-level security) · Tailwind CSS 4

## What it does

| Area | Features |
|---|---|
| **Products** | Flowers/greens and hard goods. Each product has a base unit (stem, each, roll) plus any pack units (bunch = 25, box = 250, case = 12). Variety, color, grade, stem length, shelf life, reorder point. |
| **Purchasing** | Vendors (growers, distributors, suppliers) → draft PO → ordered → receive (partial or full) → received / closed short. Freight and other charges are spread across lines by value to get a **landed cost** per base unit. |
| **Inventory** | Every receipt creates a **lot** with location, receive date, expiry (defaults from shelf life) and landed cost. Transfer between coolers/shelves (splits a lot), record shrink with a reason, cycle-count adjustments. Full movement log. |
| **Sales** | Customers with price tiers and payment terms → draft order → confirmed → **fulfilled** (pulls stock oldest-lot-first, records exact FIFO cost) → invoiced. Suggested prices come from the tier's price list, or average landed cost + tier markup. Over-orders are blocked with nothing pulled. |
| **Invoices** | Generated from fulfilled orders with optional sales tax, due date from customer terms. Printable/PDF. Mark paid or void. |
| **Reports** | Revenue, FIFO COGS, gross margin, shrink — by product and customer for any date range. Sell-through and shrink rate per product. Inventory aging buckets (flowers vs hard goods). |
| **Dashboard** | Inventory value, lots expiring within 3 days, items at reorder point, open POs, orders to fulfill, open and overdue invoices, 30-day revenue and margin. |

### Roles

| Role | Can |
|---|---|
| **Admin** | Everything, plus activate users and assign roles |
| **Buyer** | Products, units, vendors, purchase orders, receiving |
| **Warehouse** | Locations, receiving, transfers, shrink, counts, fulfillment |
| **Sales** | Customers, price tiers and prices, sales orders, fulfillment, invoices |

Everyone who is active can **view** everything. Write access is enforced in the database with row-level security, not just hidden in the UI. Stock tables (lots, movements, allocations) can only change through database functions, so inventory can't drift from its history.

**The first person to sign up becomes an active admin.** Everyone after that signs up as an inactive user and waits on **Users & roles** until an admin activates them.

## Setup

### 1. Create the Supabase project
1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema, either:
   - **CLI:** `npx supabase link --project-ref <your-ref>` then `npx supabase db push`
   - **Dashboard:** SQL Editor → paste `supabase/migrations/20261021000000_init.sql` → Run
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

## Tests

```bash
npm run test:db
```
Runs the migration and seed in an embedded Postgres and checks 42 behaviors: unit conversion, landed cost, partial receiving, status locks, lot splitting, shrink, FIFO costing, all-or-nothing fulfillment, invoicing, role checks and RLS.

## How the numbers work

- **Base units.** All stock is stored in the base unit. Order lines keep the unit they were entered in (e.g. 2 box), and convert at receive/fulfill time.
- **Landed cost** per base unit = vendor unit cost ÷ units per pack × (1 + (freight + other) ÷ PO product subtotal).
- **FIFO.** Fulfillment draws from the oldest received lots first, across all locations. Each draw is recorded in `sales_allocations` with that lot's cost, so margin is exact and traceable to the lot.
- **Shrink** is valued at the lot's landed cost.

## Project layout

```
app/
  login/                 sign in / sign up
  (app)/                 signed-in area (sidebar layout)
    page.tsx             dashboard
    products/ vendors/ customers/ (+ tiers)
    purchasing/          PO list, PO detail + receiving
    inventory/           stock, lots/[id], locations, movements
    sales/ invoices/ reports/ admin/users/
components/              UI primitives, product/unit picker, forms
lib/                     auth, Supabase client, formatting, form helpers
supabase/
  migrations/            schema, functions, views, RLS
  seed.sql               optional starter data
  tests/                 schema test suite (PGlite)
middleware.ts            session refresh + login redirect
```

## Known limits (v1)

- Voiding an invoice doesn't return stock or reopen the order.
- Fulfillment always uses FIFO across all locations; you can't hand-pick lots yet.
- No CSV import/export or barcode scanning yet.
- Report date ranges use calendar days in UTC for the database filter.
