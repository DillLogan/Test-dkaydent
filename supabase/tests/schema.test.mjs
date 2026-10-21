import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const db = new PGlite();
let pass = 0;
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); pass++; console.log("ok -", m); };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const expectErr = async (s, p, frag, m) => {
  try { await db.query(s, p); } catch (e) { ok(String(e.message).includes(frag), `${m} (${e.message})`); return; }
  throw new Error("FAIL: expected error: " + m);
};

// Supabase stubs
await db.exec(`
  create role authenticated; create role anon;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
await db.exec(fs.readFileSync(`${root}/migrations/20261021000000_init.sql`, "utf8"));
await db.exec(fs.readFileSync(`${root}/seed.sql`, "utf8"));
ok(true, "migration + seed applied");

const admin = "00000000-0000-0000-0000-000000000001";
const sales = "00000000-0000-0000-0000-000000000002";
await q(`insert into auth.users values ($1,'logan@x.com','{"full_name":"Logan"}')`, [admin]);
await q(`insert into auth.users values ($1,'rep@x.com','{}')`, [sales]);
const pa = await one(`select role, active from profiles where id=$1`, [admin]);
const ps = await one(`select role, active from profiles where id=$1`, [sales]);
ok(pa.role === "admin" && pa.active, "first user is active admin");
ok(ps.role === "sales" && !ps.active, "second user is inactive sales");

const as = (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);

// inactive user cannot act
await as(sales);
ok((await one(`select has_role('sales') h`)).h === false, "inactive user has no role");

await as(admin);
const unitsRose = await q(`select u.id, u.name, u.factor from product_units u join products p on p.id=u.product_id where p.sku='RO-FRE-60' order by factor`);
ok(unitsRose.map(u => u.name).join(",") === "stem,bunch,box", "base unit auto-created + conversions");
const box = unitsRose.find(u => u.name === "box");
const bunch = unitsRose.find(u => u.name === "bunch");
const rose = (await one(`select id from products where sku='RO-FRE-60'`)).id;
const vendor = (await one(`select id from vendors limit 1`)).id;
const cooler1 = (await one(`select id from locations where name='Cooler 1'`)).id;
const cooler2 = (await one(`select id from locations where name='Cooler 2'`)).id;

// PO 1: 2 boxes @ $100 + $50 freight -> landed 0.4 + 0.1 = 0.5/stem
const po1 = (await one(`insert into purchase_orders (vendor_id, freight_cost) values ($1, 50) returning id, po_number`, [vendor]));
ok(po1.po_number === "PO-1001", "PO numbering");
const l1 = (await one(`insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,2,100) returning id`, [po1.id, rose, box.id])).id;
await expectErr(`update purchase_orders set status='received' where id=$1`, [po1.id], "cannot be changed", "cannot set received directly");
await expectErr(`select receive_po($1, '[]')`, [po1.id], "Only ordered", "cannot receive draft");
await q(`update purchase_orders set status='ordered', order_date=current_date where id=$1`, [po1.id]);

// partial receipt: 1 box
await q(`select receive_po($1, $2::jsonb)`, [po1.id, JSON.stringify([{ line_id: l1, qty: 1, location_id: cooler1 }])]);
let st = (await one(`select status from purchase_orders where id=$1`, [po1.id])).status;
ok(st === "partially_received", "partial receipt status");
const lotA = await one(`select * from lots where po_line_id=$1`, [l1]);
ok(Number(lotA.qty_on_hand_base) === 250, "lot qty in base units (250 stems)");
ok(Math.abs(Number(lotA.unit_cost_base) - 0.5) < 1e-9, "landed cost per stem = 0.50");
ok(lotA.expires_at !== null, "default expiry from shelf life");
await q(`select receive_po($1, $2::jsonb)`, [po1.id, JSON.stringify([{ line_id: l1, qty: 1, location_id: cooler2, lot_code: "FARM-77" }])]);
st = (await one(`select status from purchase_orders where id=$1`, [po1.id])).status;
ok(st === "received", "fully received status");
await expectErr(`update purchase_orders set status='draft' where id=$1`, [po1.id], "cannot be changed", "cannot reopen received PO");

// PO 2 later, more expensive: 1 box @ 150 -> 0.6/stem (no freight)
await db.query(`select pg_sleep(0.01)`);
const po2 = (await one(`insert into purchase_orders (vendor_id, status) values ($1,'draft') returning id`, [vendor])).id;
const l2 = (await one(`insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,1,150) returning id`, [po2, rose, box.id])).id;
await q(`update purchase_orders set status='ordered' where id=$1`, [po2]);

await q(`select receive_po($1, $2::jsonb)`, [po2, JSON.stringify([{ line_id: l2, qty: 1, location_id: cooler1 }])]);
let stock = await one(`select qty_on_hand_base, value from v_product_stock where product_id=$1`, [rose]);
ok(Number(stock.qty_on_hand_base) === 750, "on hand 750 stems");
ok(Math.abs(Number(stock.value) - 400) < 1e-9, "inventory value $400");

// transfer partial + shrink + adjust
const newLot = (await one(`select transfer_stock($1, 50, $2) id`, [lotA.id, cooler2])).id;
ok(newLot !== lotA.id, "partial transfer splits lot");
const moved = await one(`select qty_on_hand_base, received_at from lots where id=$1`, [newLot]);
ok(Number(moved.qty_on_hand_base) === 50 && String(moved.received_at) === String(lotA.received_at), "split lot keeps qty + FIFO date");
await q(`select record_shrink($1, 10, 'Spoiled')`, [lotA.id]);
await expectErr(`select record_shrink($1, 10, '')`, [lotA.id], "reason", "shrink requires reason");
await q(`select adjust_lot($1, 185, 'Cycle count')`, [lotA.id]);
ok(Number((await one(`select qty_on_hand_base q from lots where id=$1`, [lotA.id])).q) === 185, "adjust sets counted qty");
const shrink = await one(`select sum(value) v from v_shrink`);
ok(Math.abs(Number(shrink.v) - 5) < 1e-9, "shrink value $5");

// Sales: 10 bunches = 250 stems, FIFO
const cust = (await one(`select id from customers where name = 'Bloom & Vine Florist'`)).id;
const so = await one(`insert into sales_orders (customer_id) values ($1) returning id, so_number`, [cust]);
ok(so.so_number === "SO-1001", "SO numbering");
await q(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,10,20)`, [so.id, rose, bunch.id]);
await expectErr(`select fulfill_sales_order($1)`, [so.id], "Only confirmed", "must confirm first");
await q(`update sales_orders set status='confirmed' where id=$1`, [so.id]);
await q(`select fulfill_sales_order($1)`, [so.id]);
const allocs = await q(`select a.qty_base, a.unit_cost_base from sales_allocations a order by a.unit_cost_base, a.qty_base desc`);
// oldest lots: lotA (185 @0.5) + newLot (50 @0.5, same date) + FARM-77 lot (250 @0.5, same receipt time-ish)
const cost = (await one(`select cost_total from sales_order_lines where so_id=$1`, [so.id])).cost_total;
ok(Math.abs(Number(cost) - 125) < 1e-9, "FIFO COGS = $125 (all from $0.50 lots, not the $0.60 lot)");
ok(allocs.reduce((s, a) => s + Number(a.qty_base), 0) === 250, "allocated 250 stems");
const sl = await one(`select revenue, cost, margin from v_sales_lines where so_id=$1`, [so.id]);
ok(Number(sl.revenue) === 200 && Number(sl.margin) === 75, "margin view: rev 200, margin 75");

// insufficient stock is all-or-nothing
const so2 = (await one(`insert into sales_orders (customer_id, status) values ($1,'draft') returning id`, [cust])).id;
await q(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,100,20)`, [so2, rose, bunch.id]);
await q(`update sales_orders set status='confirmed' where id=$1`, [so2]);
const before = (await one(`select qty_on_hand_base q from v_product_stock where product_id=$1`, [rose])).q;
await expectErr(`select fulfill_sales_order($1)`, [so2], "Not enough stock", "short order rejected");
const after = (await one(`select qty_on_hand_base q from v_product_stock where product_id=$1`, [rose])).q;
ok(Number(before) === Number(after), "no partial pull on failure");

// invoice
const inv = (await one(`select create_invoice($1, 7) id`, [so.id])).id;
const i = await one(`select invoice_number, subtotal, tax, total, due_at - issued_at as days from invoices where id=$1`, [inv]);
ok(i.invoice_number === "INV-1001" && Number(i.total) === 214 && Number(i.tax) === 14 && i.days === 30, "invoice totals + terms");
ok((await one(`select status from sales_orders where id=$1`, [so.id])).status === "invoiced", "SO invoiced");
await expectErr(`select create_invoice($1, 0)`, [so.id], "Only fulfilled", "no double invoice");

// role checks (functions)
await as(sales);
await expectErr(`select fulfill_sales_order($1)`, [so2], "Not authorized", "inactive user blocked from RPC");
await as(admin);
await q(`update profiles set active=true where id=$1`, [sales]);
await as(sales);
await expectErr(`select receive_po($1, '[]')`, [po2], "Not authorized", "sales cannot receive");
await expectErr(`select transfer_stock($1, 1, $2)`, [lotA.id, cooler1], "Not authorized", "sales cannot transfer");

// RLS checks as the authenticated role
await as(admin);
await db.exec(`grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;`);
await as(sales);
await db.exec(`set role authenticated`);
ok((await q(`select id from products`)).length === 7, "sales can read products");
await expectErr(`insert into vendors (name) values ('X')`, [], "row-level security", "sales cannot create vendors");
await expectErr(`insert into lots (product_id, location_id, qty_received_base, qty_on_hand_base, unit_cost_base) values ($1,$2,1,1,1)`, [rose, cooler1], "row-level security", "nobody writes lots directly");
const so3 = (await one(`insert into sales_orders (customer_id) values ($1) returning id`, [cust])).id;
await q(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,1,20)`, [so3, rose, bunch.id]);
ok(true, "sales can create draft SO + lines");
await expectErr(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,1,20)`, [so.id, rose, bunch.id], "row-level security", "cannot add lines to invoiced SO");
await db.exec(`reset role`);
await as(admin);
await db.exec(`set role authenticated`);
await expectErr(`insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,1,1)`, [po2, rose, box.id], "row-level security", "PO lines locked after ordering");
const delRes = await db.query(`delete from product_units where id=$1`, [unitsRose[0].id]);
ok(delRes.affectedRows === 0, "base unit cannot be deleted");
await db.exec(`reset role`);

const aging = await q(`select * from v_lot_aging`);
ok(aging.length > 0 && aging.every(a => a.age_days === 0), "aging view works");

console.log(`\n${pass} checks passed`);
