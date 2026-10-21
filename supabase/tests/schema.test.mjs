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
for (const f of fs.readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(fs.readFileSync(`${root}/migrations/${f}`, "utf8"));
}
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

// ---------- Returns & credits ----------
// so: 10 bunch (250 stems) @ $20/bunch, all from $0.50 lots, invoiced at 7%
const soLine = (await one(`select id from sales_order_lines where so_id=$1`, [so.id])).id;
const lotQtyBefore = Number((await one(`select sum(qty_on_hand_base) q from lots where product_id=$1`, [rose])).q);
const ret = (await one(`select create_return($1, $2::jsonb, 'Wrong color') id`, [so.id, JSON.stringify([{ so_line_id: soLine, qty: 2, restock: true }])])).id;
const r1 = await one(`select return_number, subtotal, tax, total, credit_status from returns where id=$1`, [ret]);
ok(r1.return_number === "RMA-1001" && Number(r1.subtotal) === 40 && Number(r1.tax) === 2.8 && Number(r1.total) === 42.8 && r1.credit_status === "open", "return credit uses sale price + invoice tax");
const lotQtyAfter = Number((await one(`select sum(qty_on_hand_base) q from lots where product_id=$1`, [rose])).q);
ok(lotQtyAfter - lotQtyBefore === 50, "restocked 2 bunches = 50 stems back on hand");
const rl1 = await one(`select cost_total from return_lines where return_id=$1`, [ret]);
ok(Math.abs(Number(rl1.cost_total) - 25) < 1e-9, "returned cost = 50 × $0.50");
const backToSoldLots = await one(`select count(*)::int n from return_allocations ra join sales_allocations sa on sa.id = ra.sales_allocation_id where sa.so_line_id=$1`, [soLine]);
ok(backToSoldLots.n >= 1, "restock went back to the exact lots the sale used");

const shrinkBefore = Number((await one(`select coalesce(sum(value),0) v from v_shrink`)).v);
await q(`select create_return($1, $2::jsonb, 'Crushed in transit')`, [so.id, JSON.stringify([{ so_line_id: soLine, qty: 1, restock: false }])]);
const shrinkAfter = Number((await one(`select coalesce(sum(value),0) v from v_shrink`)).v);
ok(Math.abs(shrinkAfter - shrinkBefore - 12.5) < 1e-9, "non-restock return is written off as shrink ($12.50)");
ok(Number((await one(`select sum(qty_on_hand_base) q from lots where product_id=$1`, [rose])).q) === lotQtyAfter, "written-off return doesn't add stock");
await expectErr(`select create_return($1, $2::jsonb)`, [so.id, JSON.stringify([{ so_line_id: soLine, qty: 8, restock: true }])], "more", "can't return more than sold");
const rv = await one(`select sum(credit) c, sum(cost) k from v_return_lines where so_id=$1`, [so.id]);
ok(Number(rv.c) === 60 && Math.abs(Number(rv.k) - 37.5) < 1e-9, "return view totals");
await expectErr(`update returns set total = 0 where id=$1`, [ret], "credit status", "return amounts are locked");
await q(`update returns set credit_status='applied' where id=$1`, [ret]);
ok(true, "credit can be marked applied");

// ---------- Invoice void & re-invoice ----------
await expectErr(`update invoices set status='void' where id=$1`, [inv], "Use Void invoice", "can't void by direct update");
await q(`select void_invoice($1)`, [inv]);
ok((await one(`select status from sales_orders where id=$1`, [so.id])).status === "fulfilled", "void sends order back to fulfilled");
const inv2 = (await one(`select create_invoice($1, 0) id`, [so.id])).id;
ok((await one(`select invoice_number from invoices where id=$1`, [inv2])).invoice_number === "INV-1002", "order can be re-invoiced after void");
await expectErr(`update invoices set status='open' where id=$1`, [inv], "cannot be reopened", "void invoice stays void");
await q(`update invoices set status='paid', paid_at=current_date where id=$1`, [inv2]);
await expectErr(`select void_invoice($1)`, [inv2], "Only open", "paid invoice can't be voided");

// ---------- Hand-picked lots ----------
const lot60 = (await one(`select id from lots where product_id=$1 and unit_cost_base > 0.55 and qty_on_hand_base > 0`, [rose])).id;
const soP = (await one(`insert into sales_orders (customer_id) values ($1) returning id`, [cust])).id;
const pl = (await one(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,2,20) returning id`, [soP, rose, bunch.id])).id;
await q(`update sales_orders set status='confirmed' where id=$1`, [soP]);
await expectErr(`select fulfill_sales_order($1, $2::jsonb)`, [soP, JSON.stringify([{ so_line_id: pl, lot_id: lot60, qty_base: 30 }])], "needs 50", "picks must total the line");
const ofOther = (await one(`select l.id from lots l join products p on p.id=l.product_id where p.sku='HG-VASE-CYL8' limit 1`))?.id;
if (ofOther) await expectErr(`select fulfill_sales_order($1, $2::jsonb)`, [soP, JSON.stringify([{ so_line_id: pl, lot_id: ofOther, qty_base: 50 }])], "not", "can't pick another product's lot");
await q(`select fulfill_sales_order($1, $2::jsonb)`, [soP, JSON.stringify([{ so_line_id: pl, lot_id: lot60, qty_base: 50 }])]);
const pc = await one(`select cost_total from sales_order_lines where id=$1`, [pl]);
ok(Math.abs(Number(pc.cost_total) - 30) < 1e-9, "hand-picked newer $0.60 lot instead of FIFO ($30 cost)");

// ---------- Category rules ----------
const cat = async (n) => (await one(`select * from categorize($1)`, [n])) || {};
ok((await cat("Rose Freedom 60cm")).category === "Roses", "categorize: rose → Roses");
ok((await cat("Spray Rose Majolika")).category === "Spray Roses", "categorize: longest keyword wins (spray rose)");
ok((await cat("Rose Sleeve 20in")).category === "Packaging", "categorize: sleeve beats rose");
ok((await cat("Glass Cylinder 12in")).kind === "hard_good", "categorize: sets hard good");
ok((await cat("Oriental Lilies Mixed")).category === "Lilies", "categorize: plural form");
ok(!(await cat("Mystery Stem")).category, "categorize: no match → none");
ok(!(await cat("Primrose Yellow")).category, "categorize: matches word starts only (primrose ≠ rose)");

// ---------- CSV stock batch ----------
const lotsBefore = Number((await one(`select count(*) n from lots`)).n);
const batch = [
  { sku: "ro-fre-60", unit: "box", qty: 2, unit_cost: 110, location: "cooler 1" },
  { sku: "TU-PNK-40", name: "Tulip Pink 40cm", units: [{ name: "bunch", factor: 10 }], unit: "bunch", qty: 12, unit_cost: 6.5, location: "Cooler 2", shelf_life_days: 7 },
  { sku: "HG-CUBE-4", name: "Glass Cube 4in", units: [{ name: "case", factor: 24 }], unit: "case", qty: 3, unit_cost: 30, location: "Hard Goods Shelf A" },
];
const res = (await one(`select import_stock_batch($1::jsonb, 'TEST-BATCH') r`, [JSON.stringify(batch)])).r;
ok(res.items_created === 2 && res.lots_created === 3 && res.reference === "TEST-BATCH", "batch: 2 new items, 3 lots");
const tulip = await one(`select * from products where sku='TU-PNK-40'`);
ok(tulip.category === "Tulips" && tulip.kind === "flower" && tulip.base_unit === "stem", "batch: new item auto-categorized (Tulips, stem)");
const cube = await one(`select * from products where sku='HG-CUBE-4'`);
ok(cube.category === "Vases" && cube.kind === "hard_good" && cube.base_unit === "each", "batch: hard good gets each + Vases");
const tl = await one(`select qty_on_hand_base, unit_cost_base, expires_at - current_date d from lots where product_id=$1`, [tulip.id]);
ok(Number(tl.qty_on_hand_base) === 120 && Math.abs(Number(tl.unit_cost_base) - 0.65) < 1e-9 && tl.d === 7, "batch: 12 bunch = 120 stems @ $0.65, expiry from shelf life");
ok(Number((await one(`select count(*) n from stock_movements where reference='TEST-BATCH' and kind='receive'`)).n) === 3, "batch: receive movements under batch reference");
const lotsMid = Number((await one(`select count(*) n from lots`)).n);
await expectErr(`select import_stock_batch($1::jsonb)`, [JSON.stringify([{ sku: "RO-FRE-60", qty: 1, unit_cost: 1, location: "Cooler 1" }, { sku: "NEW-X", qty: 1, unit_cost: 1, location: "Cooler 1" }])], "Row 3", "batch: new item without name names the row");
ok(Number((await one(`select count(*) n from lots`)).n) === lotsMid, "batch: failed batch adds nothing (all-or-nothing)");
await expectErr(`select import_stock_batch($1::jsonb)`, [JSON.stringify([{ sku: "RO-FRE-60", unit: "pallet", qty: 1, unit_cost: 1, location: "Cooler 1" }])], "pallet", "batch: unknown unit rejected");
await expectErr(`select import_stock_batch($1::jsonb)`, [JSON.stringify([{ sku: "RO-FRE-60", qty: 1, unit_cost: 1, location: "Attic" }])], "Attic", "batch: unknown location rejected");
ok(lotsMid - lotsBefore === 3, "batch: lot count");

// ---------- Floor plan, home areas, photos ----------
const c1 = (await one(`select id from locations where name='Cooler 1'`)).id;
await q(`select set_home_location($1, $2)`, [tulip.id, c1]);
ok((await one(`select home_location_id h from products where id=$1`, [tulip.id])).h === c1, "home area set");
await q(`select set_product_image($1, 'products/x.webp')`, [tulip.id]);
await q(`select set_lot_image($1, 'lots/y.webp')`, [lotA.id]);
ok((await one(`select image_path from lots where id=$1`, [lotA.id])).image_path === "lots/y.webp", "photo paths saved");
await expectErr(`update locations set map_x = 140 where id=$1`, [c1], "check", "map coordinates must be within the plan");
ok(Number((await one(`select aspect from shop_layout`)).aspect) === 1.6, "shop layout row exists");

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
ok((await q(`select id from products`)).length === 9, "sales can read products");
await expectErr(`insert into vendors (name) values ('X')`, [], "row-level security", "sales cannot create vendors");
await expectErr(`insert into lots (product_id, location_id, qty_received_base, qty_on_hand_base, unit_cost_base) values ($1,$2,1,1,1)`, [rose, cooler1], "row-level security", "nobody writes lots directly");
const so3 = (await one(`insert into sales_orders (customer_id) values ($1) returning id`, [cust])).id;
await q(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,1,20)`, [so3, rose, bunch.id]);
ok(true, "sales can create draft SO + lines");
await expectErr(`insert into returns (so_id, customer_id) values ($1,$2)`, [so.id, cust], "row-level security", "returns only via create_return");
await expectErr(`select import_stock_batch($1::jsonb)`, [JSON.stringify([{ sku: "RO-FRE-60", qty: 1, unit_cost: 1, location: "Cooler 1" }])], "Not authorized", "sales can't import stock");
await expectErr(`select set_home_location($1, null)`, [rose], "Not authorized", "sales can't set home areas");
ok((await db.query(`update shop_layout set aspect = 2`)).affectedRows === 0, "sales can't edit layout");
ok((await q(`select keyword from category_rules`)).length > 40, "everyone reads category rules");
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
