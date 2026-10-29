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

// orders manager completes, then invoice
await expectErr(`select create_invoice($1, 7)`, [so.id], "Only completed", "pulled order must be completed before invoicing");
await expectErr(`update sales_orders set status='completed' where id=$1`, [so.id], "cannot be changed", "can't complete by direct update");
await q(`select complete_sales_order($1)`, [so.id]);
ok((await one(`select status, completed_at is not null c from sales_orders where id=$1`, [so.id])).c, "order completed with timestamp");
await q(`select complete_sales_order($1, true)`, [so.id]);
ok((await one(`select status from sales_orders where id=$1`, [so.id])).status === "fulfilled", "completed order can be sent back to pulled");
await q(`select complete_sales_order($1)`, [so.id]);
await expectErr(`select complete_sales_order($1)`, [so.id], "Only pulled", "can't complete twice");
const inv = (await one(`select create_invoice($1, 7) id`, [so.id])).id;
const i = await one(`select invoice_number, subtotal, tax, total, due_at - issued_at as days from invoices where id=$1`, [inv]);
ok(i.invoice_number === "INV-1001" && Number(i.total) === 214 && Number(i.tax) === 14 && i.days === 30, "invoice totals + terms");
ok((await one(`select status from sales_orders where id=$1`, [so.id])).status === "invoiced", "SO invoiced");
await expectErr(`select create_invoice($1, 0)`, [so.id], "Only completed", "no double invoice");

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
ok((await one(`select status from sales_orders where id=$1`, [so.id])).status === "completed", "void sends order back to completed");
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

// ---------- Receiving: shipments + standing orders ----------
{
  const plus = async (n) => (await one(`select (current_date + $1::int)::text d`, [n])).d;
  await expectErr(`insert into shipments (eta) values (current_date + 400)`, [], "one year out", "ETA limited to one year out");
  const shp = await one(`insert into shipments (eta, carrier, tracking) values (current_date + 300, 'LATAM Cargo', '045-1234 5678') returning id, shipment_number`);
  ok(/^SHP-10\d\d$/.test(shp.shipment_number), "shipment numbering");
  // two POs on one shipment: one draft, one ordered
  const pA = (await one(`insert into purchase_orders (vendor_id, freight_cost) values ($1, 20) returning id`, [vendor])).id;
  const pB = (await one(`insert into purchase_orders (vendor_id) values ($1) returning id`, [vendor])).id;
  const la = (await one(`insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,1,100) returning id`, [pA, rose, box.id])).id;
  const lb = (await one(`insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,4,10) returning id`, [pB, rose, bunch.id])).id;
  await q(`update purchase_orders set status='ordered' where id=$1`, [pB]);
  await q(`select set_po_shipment($1,$2)`, [pA, shp.id]);
  await q(`select set_po_shipment($1,$2)`, [pB, shp.id]);
  ok((await one(`select expected_date::text d from purchase_orders where id=$1`, [pA])).d === await plus(300), "PO expected date follows shipment ETA");
  await q(`update shipments set eta = current_date + 2 where id=$1`, [shp.id]);
  ok((await one(`select expected_date::text d from purchase_orders where id=$1`, [pB])).d === await plus(2), "ETA change moves its POs");
  const vs = await one(`select po_count, value, is_late from v_shipments where id=$1`, [shp.id]);
  ok(Number(vs.po_count) === 2 && Number(vs.value) === 160 && vs.is_late === false, "shipment rollup: 2 POs, $160");
  await expectErr(`update shipments set status='received' where id=$1`, [shp.id], "directly", "cannot mark shipment received directly");
  await q(`update shipments set status='in_transit' where id=$1`, [shp.id]);
  await expectErr(`select receive_shipment($1, $2::jsonb)`, [shp.id, JSON.stringify([{ line_id: l2, qty: 1, location_id: cooler1 }])], "isn't on this shipment", "lines from other POs rejected");
  const res = await one(`select receive_shipment($1, $2::jsonb) r`, [shp.id, JSON.stringify([
    { line_id: la, qty: 1, location_id: cooler1 }, { line_id: lb, qty: 3, location_id: cooler2, lot_code: "AWB-LOT" }])]);
  ok(res.r.pos === 2 && res.r.lots === 2, "receive_shipment: 2 POs, 2 lots");
  const sts = await q(`select status from purchase_orders where id in ($1,$2) order by po_number`, [pA, pB]);
  ok(sts.map((s) => s.status).join(",") === "received,partially_received", "draft PO auto-ordered and received; short line stays partial");
  const lotLanded = await one(`select unit_cost_base from lots where po_line_id=$1`, [la]);
  ok(Math.abs(Number(lotLanded.unit_cost_base) - 0.48) < 1e-9, "landed cost via receive_po (100/250 * 1.2 = 0.48)");
  ok((await one(`select status, received_at is not null r from shipments where id=$1`, [shp.id])).status === "received", "shipment received");
  await expectErr(`update shipments set carrier='x' where id=$1`, [shp.id], "cannot be changed", "received shipment is locked");
  await expectErr(`select set_po_shipment($1,$2)`, [pA, shp.id], "can't be moved", "received PO can't move");
  const s2 = (await one(`insert into shipments (eta) values (current_date + 5) returning id`)).id;
  await q(`select set_po_shipment($1,$2)`, [pB, s2]);
  ok(true, "partially received PO can move to the next shipment");
  const late = (await one(`insert into shipments (eta) values (current_date - 2) returning id`)).id;
  ok((await one(`select is_late from v_shipments where id=$1`, [late])).is_late === true, "late flag");

  // standing order: weekly, 12 months
  const so = (await one(`insert into standing_orders (name, vendor_id, cadence, start_date, lead_days, carrier, freight_cost)
                         values ('Weekly roses', $1, 'weekly', current_date + 3, 5, 'KLM Cargo', 15) returning id`, [vendor])).id;
  ok((await one(`select generate_standing_orders($1) n`, [so])).n === 0, "no lines -> nothing generated");
  await q(`insert into standing_order_lines (standing_order_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,2,95)`, [so, rose, box.id]);
  const n = (await one(`select generate_standing_orders($1) n`, [so])).n;
  ok(n === 52 || n === 53, `weekly order generated ${n} planned POs over 12 months`);
  ok((await one(`select generate_standing_orders($1) n`, [so])).n === 0, "generation is idempotent");
  const gen = await q(`select po.id, po.status, po.order_date::text od, po.expected_date::text ed, s.eta::text eta, s.carrier,
                        (select count(*) from purchase_order_lines where po_id = po.id)::int lines
                         from purchase_orders po join shipments s on s.id = po.shipment_id
                        where po.standing_order_id=$1 order by po.occurrence_date`, [so]);
  ok(gen[0].status === "draft" && gen[0].eta === await plus(3) && gen[0].carrier === "KLM Cargo" && gen[0].lines === 1, "occurrence = draft PO + planned shipment + lines");
  ok(gen[0].od === await plus(0) && gen[1].od === await plus(5), "order date = arrival - lead days (not in the past)");
  ok(gen.every((g) => g.eta <= gen[gen.length - 1].eta) && gen[gen.length - 1].eta <= await plus(365), "nothing past 12 months");
  // edit one, skip one
  await q(`update purchase_order_lines set qty = 3 where po_id=$1`, [gen[1].id]);
  ok((await one(`select customized from purchase_orders where id=$1`, [gen[1].id])).customized === true, "editing a planned PO marks it customized");
  await q(`select skip_planned_po($1)`, [gen[2].id]);
  ok((await one(`select status from purchase_orders where id=$1`, [gen[2].id])).status === "cancelled", "skip cancels the occurrence");
  ok((await one(`select status from shipments where eta::text=$1 and notes like 'Standing order:%'`, [gen[2].eta])).status === "cancelled", "skipped occurrence's empty shipment cancelled");
  ok((await one(`select generate_standing_orders($1) n`, [so])).n === 0, "skipped occurrence not recreated");
  await expectErr(`delete from purchase_orders where id=$1`, [gen[3].id], "Skip it instead", "generated POs can't be deleted");
  // pause: only untouched future drafts go
  const removed = (await one(`select set_standing_order_state($1,'pause') n`, [so])).n;
  const left = await q(`select id, status from purchase_orders where standing_order_id=$1 order by occurrence_date`, [so]);
  ok(removed === n - 2 && left.length === 2, `pause removed ${removed} untouched occurrences, kept edited + skipped`);
  ok((await one(`select count(*)::int c from shipments where notes = 'Standing order: Weekly roses' and status='planned'`)).c === 1, "their empty shipments removed");
  ok((await one(`select set_standing_order_state($1,'resume') n`, [so])).n === removed, "resume regenerates them");
  await q(`select set_standing_order_state($1,'end')`, [so]);
  ok((await one(`select active, end_date::text e from standing_orders where id=$1`, [so])).e === await plus(3), "end sets end date");
  // monthly cadence
  const m = (await one(`insert into standing_orders (name, vendor_id, cadence, start_date, end_date) values ('Monthly HG', $1, 'monthly', current_date + 10, current_date + 95) returning id`, [vendor])).id;
  await q(`insert into standing_order_lines (standing_order_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,1,50)`, [m, rose, box.id]);
  ok((await one(`select generate_standing_orders($1) n`, [m])).n === 3, "monthly with end date: 3 occurrences");
}

// ---------- Payments, counter sales, Valor terminals ----------
{
  const term = (await one(`insert into payment_terminals (name, model, epi, serial_no) values ('Counter VP800', 'VP800', '2501357713', 'SN800') returning id`)).id;
  await expectErr(`insert into payment_terminals (name, model, epi) values ('X', 'Z9', 'E1')`, [], "check", "unknown terminal model rejected");
  const money2 = (x) => Math.round(Number(x) * 100) / 100;
  // deposit -> invoice -> partial payments
  const so = (await one(`insert into sales_orders (customer_id) values ($1) returning id`, [cust])).id;
  await q(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,10,20)`, [so, rose, bunch.id]);
  await q(`update sales_orders set status='confirmed' where id=$1`, [so]);
  const dep = (await one(`select record_payment($1,'cash',50) id`, [so])).id;
  ok((await one(`select kind from payments where id=$1`, [dep])).kind === "deposit", "payment before invoicing is a deposit");
  await expectErr(`select record_payment($1,'cash',151)`, [so], "more than the $150.00 still due", "can't take more than is due");
  await q(`select fulfill_sales_order($1)`, [so]);
  await q(`select complete_sales_order($1)`, [so]);
  const inv = (await one(`select create_invoice($1, 7) id`, [so])).id;
  const b1 = await one(`select total, paid, balance from v_invoice_balance where invoice_id=$1`, [inv]);
  ok(money2(b1.total) === 214 && money2(b1.paid) === 50 && money2(b1.balance) === 164, "deposit counts toward the invoice (214 - 50 = 164)");
  ok((await one(`select invoice_id from payments where id=$1`, [dep])).invoice_id === inv, "deposit linked to the invoice");
  await q(`select record_payment($1,'check',100,'Check 2231')`, [so]);
  ok((await one(`select status from invoices where id=$1`, [inv])).status === "open", "partial payment leaves invoice open");
  const last = (await one(`select record_payment($1,'card',64,'A1B2C3',0,'{"card_brand":"Visa","card_last4":"4242"}') id`, [so])).id;
  ok((await one(`select status, paid_at is not null p from invoices where id=$1`, [inv])).status === "paid", "fully paid invoice marked paid");
  await expectErr(`select record_payment($1,'cash',1)`, [so], "already paid", "no payments on a paid invoice");
  await expectErr(`select void_invoice($1)`, [inv], "Only open", "paid invoice can't be voided");
  await q(`select void_payment($1)`, [last]);
  ok((await one(`select status from invoices where id=$1`, [inv])).status === "open", "voiding a payment reopens the invoice");
  await expectErr(`select void_invoice($1)`, [inv], "Void the payments first", "invoice with payments can't be voided");

  // counter sale, cash
  const onHand = async () => Number((await one(`select coalesce(sum(qty_on_hand_base),0) s from lots where product_id=$1`, [rose])).s);
  await expectErr(`select create_counter_sale(null, $1::jsonb)`, [JSON.stringify([{ product_id: rose, unit_id: bunch.id, qty: 100000, unit_price: 20 }])], "Not enough Rose Freedom", "counter sale checks stock");
  const before = await onHand();
  const cs = (await one(`select create_counter_sale(null, $1::jsonb) id`, [JSON.stringify([{ product_id: rose, unit_id: bunch.id, qty: 2, unit_price: 18 }])])).id;
  const csRow = await one(`select status, channel, c.name from sales_orders s join customers c on c.id=s.customer_id where s.id=$1`, [cs]);
  ok(csRow.status === "confirmed" && csRow.channel === "counter" && csRow.name === "Walk-in", "counter sale: confirmed, walk-in customer");
  const csInv = (await one(`select complete_counter_sale($1, 0, '{"method":"cash"}') id`, [cs])).id;
  const ci = await one(`select status, total, due_at = issued_at due_today from invoices where id=$1`, [csInv]);
  ok(ci.status === "paid" && money2(ci.total) === 36 && ci.due_today, "cash counter sale: invoiced, due today, paid");
  const after = await onHand(); ok(Math.abs(before - after - 2 * Number(bunch.factor)) < 1e-6, `counter sale pulled 2 bunches FIFO (${before} -> ${after})`);

  // counter sale on the terminal (simulator), 7% tax
  const ts = (await one(`select create_counter_sale(null, $1::jsonb) id`, [JSON.stringify([{ product_id: rose, unit_id: bunch.id, qty: 1, unit_price: 25 }])])).id;
  await expectErr(`select create_terminal_request($1,'counter',$2,27,'simulator',false,7)`, [term, ts], "more than the $26.75", "terminal amount capped at total with tax");
  const tr = (await one(`select create_terminal_request($1,'counter',$2,26.75,'simulator',true,7) id`, [term, ts])).id;
  ok(/^[0-9A-F]{20}$/.test((await one(`select req_txn_id from terminal_requests where id=$1`, [tr])).req_txn_id), "REQ_TXN_ID generated");
  await expectErr(`select create_terminal_request($1,'counter',$2,1,'simulator')`, [term, ts], "busy", "one pending payment per terminal");
  const fin = (await one(`select finalize_terminal_request($1, '{"status":"approved","card_brand":"Mastercard","card_last4":"5454","auth_code":"OK1234","txn_id":"SIM-1","tip":"3"}') r`, [tr])).r;
  ok(fin.status === "approved" && fin.payment_id, "approved terminal request records a payment");
  const tp = await one(`select method, amount, tip, card_last4, terminal_id from payments where id=$1`, [fin.payment_id]);
  ok(tp.method === "card" && money2(tp.amount) === 26.75 && money2(tp.tip) === 3 && tp.card_last4 === "5454" && tp.terminal_id === term, "card payment details + tip kept separately");
  ok((await one(`select s.status, i.status ist from sales_orders s join invoices i on i.so_id=s.id where s.id=$1`, [ts])).ist === "paid", "terminal counter sale finished: invoiced and paid");
  ok((await one(`select finalize_terminal_request($1, '{"status":"declined"}') r`, [tr])).r.already === true, "finalize is idempotent");
  // declined on an invoice
  const tr2 = (await one(`select create_terminal_request($1,'invoice',$2,64,'simulator') id`, [term, so])).id;
  await q(`select finalize_terminal_request($1, '{"status":"declined","message":"Card declined"}')`, [tr2]);
  ok((await one(`select status, payment_id from terminal_requests where id=$1`, [tr2])).payment_id === null, "declined request records nothing");
  // sync from the terminal: payment against an invoice by number, duplicates skipped, itemized sale
  const invNo = (await one(`select invoice_number from invoices where id=$1`, [inv])).invoice_number;
  ok((await one(`select import_terminal_txn($1::jsonb) r`, [JSON.stringify({ txn_id: "VAL-9001", amount: 64, invoice_ref: invNo.toLowerCase(), card_last4: "1111", terminal_epi: "2501357713" })])).r.result === "payment", "synced txn matched to invoice by number");
  ok((await one(`select status from invoices where id=$1`, [inv])).status === "paid", "synced payment settles the invoice");
  ok((await one(`select import_terminal_txn($1::jsonb) r`, [JSON.stringify({ txn_id: "VAL-9001", amount: 64 })])).r.result === "duplicate", "same txn id is skipped");
  const sale = (await one(`select import_terminal_txn($1::jsonb) r`, [JSON.stringify({ txn_id: "VAL-9002", amount: 40, lines: [{ product_id: rose, unit_id: bunch.id, qty: 2, unit_price: 20 }] })])).r;
  const sr = await one(`select s.channel, i.status from sales_orders s join invoices i on i.so_id=s.id where s.id=$1`, [sale.so_id]);
  ok(sale.result === "sale" && sr.channel === "terminal" && sr.status === "paid", "itemized terminal sale becomes a paid sale with stock pulled");
  await expectErr(`select import_terminal_txn($1::jsonb)`, [JSON.stringify({ txn_id: "VAL-9003", amount: 5 })], "no matching invoice", "unmatched, unitemized txn rejected");
}

// ---------- Recurring sales orders ----------
{
  const tierRow = await one(`select c.price_tier_id t, pt.markup_pct m from customers c left join price_tiers pt on pt.id = c.price_tier_id where c.id=$1`, [cust]);
  const rs = (await one(`insert into recurring_sales (name, customer_id, cadence, start_date) values ('Weekly shop roses', $1, 'weekly', current_date + 2) returning id`, [cust])).id;
  ok((await one(`select generate_recurring_sales($1) n`, [rs])).n === 0, "recurring: nothing planned without items");
  await q(`insert into recurring_sale_lines (recurring_id, product_id, unit_id, qty) values ($1,$2,$3,4)`, [rs, rose, bunch.id]);
  const n = (await one(`select generate_recurring_sales($1) n`, [rs])).n;
  ok(n === 52 || n === 53, `recurring: ${n} draft sales orders planned over 12 months`);
  ok((await one(`select generate_recurring_sales($1) n`, [rs])).n === 0, "recurring: idempotent");
  const sos = await q(`select id, status, ship_date::text sd, (select unit_price from sales_order_lines where so_id = s.id) price from sales_orders s where recurring_id=$1 order by occurrence_date`, [rs]);
  const expected = Number((await one(`select customer_unit_price($1,$2) p`, [cust, bunch.id])).p);
  ok(sos[0].status === "draft" && Number(sos[0].price) === expected && expected > 0, `recurring: drafts priced at the customer's price (${expected})`);
  // tier price changes -> untouched drafts follow, edited ones keep theirs
  await q(`update sales_order_lines set qty = 5 where so_id=$1`, [sos[1].id]);
  ok((await one(`select customized from sales_orders where id=$1`, [sos[1].id])).customized === true, "recurring: editing a draft marks it customized");
  const keep = Number(sos[1].price);
  if (tierRow.t) await q(`insert into tier_prices (tier_id, product_unit_id, price) values ($1,$2,77) on conflict do nothing`, [tierRow.t, bunch.id]);
  await q(`update tier_prices set price = 77 where product_unit_id=$1`, [bunch.id]);
  await q(`select generate_recurring_sales($1)`, [rs]);
  ok(Number((await one(`select unit_price from sales_order_lines where so_id=$1`, [sos[0].id])).unit_price) === 77, "recurring: untouched drafts re-priced at the current tier price");
  ok(Number((await one(`select unit_price from sales_order_lines where so_id=$1`, [sos[1].id])).unit_price) === keep, "recurring: edited draft keeps its price");
  await q(`select skip_recurring_sale($1)`, [sos[2].id]);
  ok((await one(`select status from sales_orders where id=$1`, [sos[2].id])).status === "cancelled", "recurring: skip cancels that order");
  ok((await one(`select generate_recurring_sales($1) n`, [rs])).n === 0, "recurring: skipped date not recreated");
  await expectErr(`delete from sales_orders where id=$1`, [sos[3].id], "Skip it instead", "recurring: planned orders can't be deleted");
  const removed = (await one(`select set_recurring_sale_state($1,'pause') n`, [rs])).n;
  const left = Number((await one(`select count(*) c from sales_orders where recurring_id=$1`, [rs])).c);
  ok(removed === n - 2 && left === 2, `recurring: pause removed ${removed} untouched, kept edited + skipped`);
  ok((await one(`select set_recurring_sale_state($1,'resume') n`, [rs])).n === removed, "recurring: resume plans them again");
}

// ---------- Floor plan, home areas, photos ----------
const c1 = (await one(`select id from locations where name='Cooler 1'`)).id;
const main = (await one(`select id, aspect from shop_layouts where name='Main shop'`));
ok(Number(main.aspect) === 1.6, "existing plan became the Main shop layout");
ok(Number((await one(`select count(*) c from locations where layout_id is null or layout_id<>$1`, [main.id])).c) === 0, "all sections belong to Main shop");
ok(Number((await one(`select count(*) c from product_homes`)).c) >= 5, "seed home areas carried over");
await q(`select set_home_location($1, $2, $3)`, [tulip.id, main.id, c1]);
ok((await one(`select location_id h from product_homes where product_id=$1 and layout_id=$2`, [tulip.id, main.id])).h === c1, "home area set");
const north = (await one(`insert into shop_layouts (name) values ('North shop') returning id`)).id;
await expectErr(`insert into shop_layouts (name) values (' north SHOP')`, [], "unique", "layout names are unique");
const nloc = (await one(`insert into locations (name, kind, layout_id) values ('North Cooler','cooler',$1) returning id`, [north])).id;
ok((await one(`select layout_id from locations where name='North Cooler'`)).layout_id === north, "section created in the North shop");
const dflt = (await one(`insert into locations (name) values ('Spare Shelf') returning layout_id`)).layout_id;
ok(dflt === main.id, "a section without a shop goes to the first layout");
await expectErr(`select set_home_location($1, $2, $3)`, [tulip.id, north, c1], "isn't in this shop", "home must be a section of that shop");
await q(`select set_home_location($1, $2, $3)`, [tulip.id, north, nloc]);
ok(Number((await one(`select count(*) c from product_homes where product_id=$1`, [tulip.id])).c) === 2, "one home per shop");
await q(`insert into plan_doors (layout_id, kind, label, side, pos) values ($1,'entry','Front door','bottom',20), ($1,'exit','Loading dock','right',80), ($1,'entry','Side door','left',50)`, [north]);
await expectErr(`insert into plan_doors (layout_id, kind, label, side) values ($1,'exit',' ','top')`, [north], "check", "entries/exits need a label");
await expectErr(`insert into plan_doors (layout_id, kind, label, side) values ($1,'exit','X','middle')`, [north], "check", "entries/exits sit on a wall");
await q(`update locations set map_x=10, map_y=10, map_w=20, map_h=20 where id=$1`, [nloc]);
await expectErr(`select delete_shop_layout($1, $1)`, [north], "Choose another layout", "deleting needs another layout for its sections");
await q(`select delete_shop_layout($1, $2)`, [north, main.id]);
const movedLoc = await one(`select layout_id, map_x from locations where id=$1`, [nloc]);
ok(movedLoc.layout_id === main.id && movedLoc.map_x === null, "deleted layout's sections move unplaced");
await q(`update locations set map_shape='[[10,10],[30,10],[30,20],[20,20],[20,30],[10,30]]'::jsonb, map_x=10, map_y=10, map_w=20, map_h=20 where name='Cooler 2'`);
ok((await one(`select jsonb_array_length(map_shape) n from locations where name='Cooler 2'`)).n === 6, "areas can be any shape (L-shaped cooler)");
await expectErr(`update locations set map_shape='[[1,1],[2,2]]'::jsonb where name='Cooler 2'`, [], "check", "a shape needs at least 3 corners");
await q(`update shop_layouts set width_ft=40, height_ft=25 where id=$1`, [main.id]);
await expectErr(`update shop_layouts set width_ft=-3 where id=$1`, [main.id], "check", "floor size must be positive");
ok(Number((await one(`select count(*) c from product_homes where product_id=$1`, [tulip.id])).c) === 1, "homes in a deleted shop are cleared");
ok(Number((await one(`select count(*) c from plan_doors`)).c) === 0, "its entries/exits are removed");
await expectErr(`select delete_shop_layout($1, null)`, [main.id], "Keep at least one", "the last layout can't be deleted");
await q(`delete from locations where name in ('North Cooler','Spare Shelf')`);
await q(`select set_product_image($1, 'products/x.webp')`, [tulip.id]);
await q(`select set_lot_image($1, 'lots/y.webp')`, [lotA.id]);
ok((await one(`select image_path from lots where id=$1`, [lotA.id])).image_path === "lots/y.webp", "photo paths saved");
await expectErr(`update locations set map_x = 140 where id=$1`, [c1], "check", "map coordinates must be within the plan");

// role checks (functions)
await as(sales);
await expectErr(`select fulfill_sales_order($1)`, [so2], "Not authorized", "inactive user blocked from RPC");
await as(admin);
await q(`update profiles set active=true where id=$1`, [sales]);
await as(sales);
await expectErr(`select receive_po($1, '[]')`, [po2], "Not authorized", "sales cannot receive");
await expectErr(`select transfer_stock($1, 1, $2)`, [lotA.id, cooler1], "Not authorized", "sales cannot transfer");

// ---------- Web store connection ----------
{
  await as(admin);
  const lot = (name) => one(`select coalesce(sum(qty_on_hand_base),0)::numeric q from lots l join products p on p.id=l.product_id where p.sku=$1`, [name]);
  const freedom = Number((await lot("RO-FRE-60")).q);
  // service key (website webhook / scheduled job), no signed-in user
  await as("");
  await expectErr(`select web_store_apply_inventory('[]'::jsonb)`, [], "Not authorized", "web sync needs the service key or a warehouse user");
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const inv = (await one(`select web_store_apply_inventory($1::jsonb, 'webhook') r`, [JSON.stringify([
    { sku: "ro-fre-60", qty: freedom + 50 }, { sku: "WEB-ROSE-BUNCH", qty: 3 }, { sku: "EU-SDL", qty: 0 }, { sku: "", qty: 4 }])])).r;
  ok(inv.updated >= 1 && inv.unmatched.includes("WEB-ROSE-BUNCH"), `inventory synced: ${JSON.stringify(inv)}`);
  ok(Number((await lot("RO-FRE-60")).q) === freedom + 50, "website count raises on-hand");
  ok(Number((await lot("EU-SDL")).q) === 0, "website zero empties the item");
  const mv = await one(`select count(*) c from stock_movements where reason='Web sync'`);
  ok(Number(mv.c) >= 1, "changes recorded as Web sync adjustments");
  ok((await one(`select seen_in from web_unmatched_skus where external_sku='WEB-ROSE-BUNCH'`)).seen_in === "inventory", "unmatched website SKU listed");
  await expectErr(`select web_store_apply_inventory('[{"sku":"RO-FRE-60","qty":"lots"}]'::jsonb)`, [], "not a number", "bad quantity rejected");
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  // link the website SKU to bunches of Freedom (as a buyer/admin)
  await as(admin);
  const bunchU = (await one(`select u.id from product_units u join products p on p.id=u.product_id where p.sku='RO-FRE-60' and u.name='bunch'`)).id;
  const freedomId = (await one(`select id from products where sku='RO-FRE-60'`)).id;
  await q(`select web_link_sku('WEB-ROSE-BUNCH', $1, $2)`, [freedomId, bunchU]);
  ok(Number((await one(`select count(*) c from web_unmatched_skus`)).c) === 0, "linking clears it from unmatched");
  // web order: created confirmed; second time is a no-op
  const order = { external_id: "5001", number: "#5001", email: "orders@bloomvine.example", name: "Ana", ordered_at: "2026-10-22T09:00:00Z", ship_date: "2026-10-23",
    lines: [{ sku: "WEB-ROSE-BUNCH", qty: 2, price: 21 }, { sku: "HY-WHT", qty: 10 }] };
  const r1 = (await one(`select web_store_upsert_order($1::jsonb) r`, [JSON.stringify(order)])).r;
  ok(r1.result === "created", "web order becomes a sales order");
  const wso = await one(`select status, source, customer_id, notes from sales_orders where id=$1`, [r1.so_id]);
  ok(wso.status === "confirmed" && wso.source === "web" && /Web order #5001/.test(wso.notes), "confirmed, marked as a web order");
  ok((await one(`select name from customers where id=$1`, [wso.customer_id])).name === "Web orders", "no matching email → Web orders customer");
  const lines = await q(`select qty, unit_price, (select name from product_units where id=unit_id) u from sales_order_lines where so_id=$1 order by unit_price desc`, [r1.so_id]);
  ok(lines.length === 2 && lines[0].u === "bunch" && Number(lines[0].unit_price) === 21, "linked SKU uses its unit and the website price");
  const fallback = (await one(`select customer_unit_price($1, (select u.id from product_units u join products p on p.id=u.product_id where p.sku='HY-WHT' and u.factor=1)) p`, [wso.customer_id])).p;
  ok(Number(lines[1].unit_price) === Number(fallback), "missing price falls back to the customer's price");
  const r2 = (await one(`select web_store_upsert_order($1::jsonb) r`, [JSON.stringify(order)])).r;
  ok(r2.result === "exists" && r2.so_id === r1.so_id, "same web order isn't imported twice");
  // stock promised to the open web order isn't counted twice by the next count
  const before = Number((await lot("RO-FRE-60")).q);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await q(`select web_store_apply_inventory($1::jsonb)`, [JSON.stringify([{ sku: "RO-FRE-60", qty: before - 50 }])]);
  ok(Number((await lot("RO-FRE-60")).q) === before - 50 + 50, "open web orders are added back on top of the website count");
  // unmatched SKU → order waits as a draft
  const r3 = (await one(`select web_store_upsert_order($1::jsonb) r`, [JSON.stringify({ external_id: "5002", lines: [{ sku: "MYSTERY", qty: 1 }, { sku: "HY-WHT", qty: 5 }] })])).r;
  ok(r3.result === "needs_review" && (await one(`select status from sales_orders where id=$1`, [r3.so_id])).status === "draft", "unmatched SKU leaves the web order as a draft to review");
  // cancelled on the website
  const r4 = (await one(`select web_store_upsert_order($1::jsonb) r`, [JSON.stringify({ ...order, cancelled: true })])).r;
  ok(r4.result === "cancelled" && (await one(`select status from sales_orders where id=$1`, [r1.so_id])).status === "cancelled", "website cancellation cancels the order");
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await as(admin);
  ok(Number((await one(`select count(*) c from web_sync_runs`)).c) >= 2, "sync history kept");
}

// RLS checks as the authenticated role
await as(admin);
await db.exec(`grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
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
await expectErr(`select set_home_location($1, $2, null)`, [rose, main.id], "Not authorized", "sales can't set home areas");
await expectErr(`select delete_shop_layout($1, $1)`, [main.id], "Not authorized", "sales can't delete layouts");
await expectErr(`insert into shop_layouts (name) values ('Sales shop')`, [], "row-level security", "sales can't add layouts");
await expectErr(`insert into plan_doors (layout_id, kind, label, side) values ($1,'entry','X','top')`, [main.id], "row-level security", "sales can't add entries/exits");
await expectErr(`insert into product_homes (product_id, layout_id, location_id) values ($1,$2,$3)`, [rose, main.id, c1], "row-level security", "homes only via set_home_location");
await expectErr(`insert into shipments (eta) values (current_date)`, [], "row-level security", "sales can't plan shipments");
await expectErr(`select generate_standing_orders()`, [], "Not authorized", "sales can't run standing orders");
await expectErr(`insert into payments (customer_id, kind, method, amount) values ($1,'payment','cash',1)`, [cust], "row-level security", "payments only through record_payment");
await expectErr(`insert into payment_terminals (name, model, epi) values ('T','VL100','X1')`, [], "row-level security", "only admins add terminals");
ok((await q(`select api_key from web_store_settings`)).length === 0, "web store settings (API key, secret) hidden from sales");
await expectErr(`select web_store_apply_inventory('[]'::jsonb)`, [], "Not authorized", "sales can't push web inventory");
await expectErr(`select web_store_config()`, [], "Not authorized", "sales can't read the web store secrets");
ok((await db.query(`update shop_layouts set aspect = 2`)).affectedRows === 0, "sales can't edit layout");
ok((await q(`select keyword from category_rules`)).length > 40, "everyone reads category rules");
await expectErr(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,1,20)`, [so.id, rose, bunch.id], "row-level security", "cannot add lines to invoiced SO");
await db.exec(`reset role`);
await as(admin);
await db.exec(`set role authenticated`);
await expectErr(`insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost) values ($1,$2,$3,1,1)`, [po2, rose, box.id], "row-level security", "PO lines locked after ordering");
{
  // warehouse/admin moving a section with item homes to another shop (runs under RLS)
  const west = (await one(`insert into shop_layouts (name) values ('West shop') returning id`)).id;
  const c2 = (await one(`select id from locations where name='Cooler 2'`)).id;
  ok(Number((await one(`select count(*) c from product_homes where location_id=$1`, [c2])).c) > 0, "Cooler 2 is a home before moving");
  await q(`update locations set layout_id=$1 where id=$2`, [west, c2]);
  ok(Number((await one(`select count(*) c from product_homes where location_id=$1`, [c2])).c) === 0, "moving a section to another shop clears its homes");
  await q(`update locations set layout_id=$1 where id=$2`, [main.id, c2]);
  await q(`select delete_shop_layout($1, $2)`, [west, main.id]);
}
{
  // MUST CHECK can be set on an order at any status, by sales
  const anySo = (await one(`select id, status from sales_orders where status='invoiced' limit 1`));
  await q(`update sales_orders set must_check=true where id=$1`, [anySo.id]);
  ok((await one(`select must_check from sales_orders where id=$1`, [anySo.id])).must_check === true, "MUST CHECK set on an invoiced order");
  await q(`update sales_orders set must_check=false where id=$1`, [anySo.id]);
}
const delRes = await db.query(`delete from product_units where id=$1`, [unitsRose[0].id]);
ok(delRes.affectedRows === 0, "base unit cannot be deleted");
await db.exec(`reset role`);

const aging = await q(`select * from v_lot_aging`);
ok(aging.length > 0 && aging.every(a => a.age_days === 0), "aging view works");

{
  // Order steps: orders manager role, delivery address defaults, routing tables
  const om = "00000000-0000-0000-0000-0000000000a1";
  const wh = "00000000-0000-0000-0000-0000000000a2";
  await q(`insert into auth.users values ($1,'om@x.com','{}'), ($2,'wh@x.com','{}')`, [om, wh]);
  await q(`update profiles set role='orders_manager', active=true where id=$1`, [om]);
  await q(`update profiles set role='warehouse', active=true where id=$1`, [wh]);
  const cust = (await one(`insert into customers (name, address, delivery_address) values ('Petal Shop','1 Main St, Town','9 Dock Rd, Town') returning id`)).id;
  const so3 = (await one(`insert into sales_orders (customer_id) values ($1) returning id, delivery_address, layout_id`, [cust]));
  ok(so3.delivery_address === "9 Dock Rd, Town" && so3.layout_id === main.id, "new order takes the customer's delivery address and first shop");
  const cust2 = (await one(`insert into customers (name, address) values ('Bloom Co','5 Elm St') returning id`)).id;
  ok((await one(`insert into sales_orders (customer_id) values ($1) returning delivery_address d`, [cust2])).d === "5 Elm St", "no delivery address falls back to main address");
  await q(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,1,20)`, [so3.id, rose, bunch.id]);
  await q(`update sales_orders set status='confirmed' where id=$1`, [so3.id]);
  await q(`select fulfill_sales_order($1)`, [so3.id]);
  await as(wh);
  await expectErr(`select complete_sales_order($1)`, [so3.id], "Only the orders manager", "warehouse can't complete orders");
  await as(om);
  await q(`select complete_sales_order($1)`, [so3.id]);
  const inv3 = (await one(`select create_invoice($1, 0) id`, [so3.id])).id;
  ok(!!inv3, "orders manager completes and invoices");
  await q(`select save_geocodes($1::jsonb)`, [JSON.stringify([{ address: "  9 Dock  Rd, Town ", lat: 40.1, lng: -75.2, formatted: "9 Dock Rd" }])]);
  ok(Number((await one(`select lat from geocodes where address = geo_key('9 dock rd, town')`)).lat) === 40.1, "geocodes saved under a normalized address");
  await db.exec(`set role authenticated`);
  await q(`insert into route_sheets (route_date, layout_id, stops, mode) values (current_date, $1, $2, 'optimized')`, [main.id, [so3.id]]);
  ok((await one(`select stops from route_sheets where layout_id=$1`, [main.id])).stops.length === 1, "orders manager saves a route sheet");
  const upd = await db.query(`update app_settings set google_maps_key='abcdefghijklmnop'`);
  ok(upd.affectedRows === 0, "only admin can set the Maps key");
  await db.exec(`reset role`);
  await as(admin);
  await db.exec(`set role authenticated`);
  ok((await db.query(`update app_settings set google_maps_key='abcdefghijklmnop'`)).affectedRows === 1, "admin sets the Maps key");
  await db.exec(`reset role`);
}
{
  // Messenger
  const u1 = "00000000-0000-0000-0000-0000000000b1", u2 = "00000000-0000-0000-0000-0000000000b2", u3 = "00000000-0000-0000-0000-0000000000b3";
  await q(`insert into auth.users values ($1,'m1@x.com','{"full_name":"Ann"}'), ($2,'m2@x.com','{"full_name":"Bo"}'), ($3,'m3@x.com','{"full_name":"Cy"}')`, [u1, u2, u3]);
  await q(`update profiles set active=true, role='sales' where id=$1`, [u1]);
  await q(`update profiles set active=true, role='warehouse' where id=$1`, [u2]);
  await q(`update profiles set active=true, role='sales' where id=$1`, [u3]);
  await db.exec(`set role authenticated`);
  await as(u1);
  const chans = await q(`select name from chat_channels where kind='team' order by name`);
  ok(chans.map(c => c.name).join(",") === "Everyone,Sales", "sales rep sees Everyone and Sales channels only");
  const everyone = (await one(`select id from chat_channels where name='Everyone'`)).id;
  const sales2 = (await one(`select id from chat_channels where name='Sales'`)).id;
  const m1 = (await one(`insert into chat_messages (channel_id, body) values ($1,'Hi team') returning id`, [everyone])).id;
  await expectErr(`insert into chat_messages (channel_id, body) values ((select id from chat_channels where name='Warehouse'), 'x')`, [], "row-level security", "can't post in a channel you can't see");
  await expectErr(`insert into chat_messages (channel_id, body, sender_id) values ($1,'spoof',$2)`, [everyone, u2], "row-level security", "can't send as someone else");
  await expectErr(`insert into chat_messages (channel_id, body) values ($1,'  ')`, [everyone], "check", "empty message rejected");
  await expectErr(`insert into chat_messages (channel_id, gif_url) values ($1,'http://x.com/a.gif')`, [everyone], "check", "GIF links must be https");
  await q(`insert into chat_messages (channel_id, gif_url) values ($1,'https://media.giphy.com/media/abc/giphy.gif')`, [everyone]);
  await q(`select chat_react($1,'👍')`, [m1]);
  await q(`select chat_react($1,'👍')`, [m1]);
  ok(Number((await one(`select count(*) c from chat_reactions where message_id=$1`, [m1])).c) === 0, "reacting twice removes the reaction");
  await q(`select chat_react($1,'🎉')`, [m1]);
  // DM
  const dm = (await one(`select chat_open_dm($1) id`, [u2])).id;
  ok((await one(`select chat_open_dm($1) id`, [u2])).id === dm, "1-on-1 chat is reused");
  await as(u2);
  ok((await one(`select chat_open_dm($1) id`, [u1])).id === dm, "same chat from the other side");
  await q(`insert into chat_messages (channel_id, body) values ($1,'Pull SO-1005?')`, [dm]);
  await as(u1);
  ok(Number((await one(`select unread from chat_unread() where channel_id=$1`, [dm])).unread) === 1, "DM shows 1 unread");
  await q(`select chat_mark_read($1)`, [dm]);
  ok(Number((await one(`select unread from chat_unread() where channel_id=$1`, [dm])).unread) === 0, "mark read clears unread");
  await as(u3);
  ok(Number((await one(`select count(*) c from chat_messages where channel_id=$1`, [dm])).c) === 0, "outsiders can't read a DM");
  await expectErr(`insert into chat_messages (channel_id, body) values ($1,'sneak')`, [dm], "row-level security", "outsiders can't post in a DM");
  // Group
  await as(u1);
  await expectErr(`select chat_create_group('Solo', $1::uuid[])`, [[u2]], "at least two", "group needs 3 people");
  const grp = (await one(`select chat_create_group('Friday run', $1::uuid[]) id`, [[u2, u3]])).id;
  await as(u3);
  ok(Number((await one(`select count(*) c from chat_channels where id=$1`, [grp])).c) === 1, "group members see the group");
  await expectErr(`select chat_add_people($1, $2::uuid[])`, [grp, [u2]], "Only the person who made", "only the creator adds people");
  await q(`select chat_leave($1)`, [grp]);
  ok(Number((await one(`select count(*) c from chat_channels where id=$1`, [grp])).c) === 0, "leaving a group hides it");
  await db.exec(`reset role`);
}

// ---- customer shopping login ----
{
  await db.exec(`reset role`);
  const cu = "00000000-0000-0000-0000-0000000000c1", s2 = "00000000-0000-0000-0000-0000000000c2", cu2 = "00000000-0000-0000-0000-0000000000c3";
  await q(`insert into auth.users values ($1,'shop@x.com','{"full_name":"Shopper"}'),($2,'rep2@x.com','{}'),($3,'shop2@x.com','{}')`, [cu, s2, cu2]);
  await q(`update profiles set active=true where id in ($1,$2)`, [sales, s2]);
  const [custA, custB] = (await q(`select id from customers where name <> 'Walk-in' order by created_at limit 2`)).map((r) => r.id);
  await q(`update customers set discount_pct=10 where id=$1`, [custA]);
  // incomplete accounts cannot get a login
  await as(sales);
  await expectErr(`select portal_set_up($1,$2)`, [cu, custA], "Missing:", "login needs route and sales rep first");
  await as(admin);
  await q(`update customers set route_code=' nor ', rep_id=$2, phone='555-0100', address=coalesce(address,'1 Main St'), default_payment='card', cash_discount_pct=5 where id=$1`, [custA, sales]);
  await q(`update customers set route_code='se', rep_id=$2, phone='555-0101', address=coalesce(address,'2 Main St'), default_payment='check' where id=$1`, [custB, sales]);
  ok((await one(`select route_code from customers where id=$1`, [custA])).route_code === "NOR", "route code saved in capitals");
  await expectErr(`update customers set route_code='ABCD' where id=$1`, [custA], "route_code", "route code is at most 3 letters");
  await expectErr(`update customers set route_code='A1' where id=$1`, [custA], "route_code", "route code is letters only");
  await as(admin);
  await expectErr(`update profiles set role='customer' where id=$1`, [cu], "Customer logins are set up", "role cannot be switched to customer directly");
  await as(sales);
  await expectErr(`select portal_set_up($1,$2)`, [admin, custA], "already has staff access", "cannot turn an active staff member into a customer");
  await q(`select portal_set_up($1,$2)`, [cu, custA]);
  let pr = await one(`select role, active from profiles where id=$1`, [cu]);
  ok(pr.role === "customer" && pr.active === false, "set-up makes a customer login that is still switched off");
  await expectErr(`select portal_verify($1)`, [cu], "different person", "the person who set it up cannot verify it");
  await as(s2);
  await q(`select portal_verify($1)`, [cu]);
  pr = await one(`select active from profiles where id=$1`, [cu]);
  ok(pr.active === true, "a different sales person verifies and switches it on");

  // pick something sellable with stock
  const item = await one(`select u.id unit_id, u.product_id, u.factor from product_units u join products p on p.id=u.product_id
                           where p.active and customer_unit_price($1, u.id) > 0 and product_available_base(p.id) >= u.factor * 3 order by u.factor limit 1`, [custA]);
  ok(!!item, "found a sellable unit with stock for the portal tests");
  const list = Number((await one(`select customer_list_price($1,$2) p`, [custA, item.unit_id])).p);
  const eff = Number((await one(`select customer_unit_price($1,$2) p`, [custA, item.unit_id])).p);
  ok(Math.abs(eff - Math.round(list * 0.9 * 100) / 100) < 0.011, `10% customer discount applies (${list} -> ${eff})`);
  await q(`insert into customer_prices (customer_id, product_unit_id, price) values ($1,$2,1.23)`, [custA, item.unit_id]);
  ok(Number((await one(`select customer_unit_price($1,$2) p`, [custA, item.unit_id])).p) === 1.23, "special price beats tier price and discount");

  await db.exec(`set role authenticated`);
  await as(cu);
  for (const t of ["products", "customers", "sales_orders", "lots", "invoices", "customer_prices", "portal_accounts", "chat_channels"]) {
    ok(Number((await one(`select count(*) c from ${t}`)).c) === 0, `customer cannot read ${t} directly`);
  }
  const me = (await one(`select portal_me() m`)).m;
  ok(me.discount_pct == 10, "portal_me returns the customer's own discount");
  const cat = (await one(`select portal_catalog() c`)).c;
  const row = cat.find((r) => r.unit_id === item.unit_id);
  ok(row && Number(row.price) === 1.23 && row.special === true && Number(row.available) >= 3, "catalog shows the customer's special price and exact availability");
  ok(!("cost" in row) && !JSON.stringify(row).includes("unit_cost"), "catalog carries no cost");
  ok((await one(`select customer_unit_price($1,$2) p`, [custB, item.unit_id])).p === null, "customer cannot ask another customer's price");
  ok((await one(`select so_total($1) t`, [(await one(`select id from sales_orders limit 1`, [])) ?.id ?? null])).t === null, "customer gets nothing from so_total");
  await expectErr(`select catalog_checkout($1,'[]'::jsonb,null)`, [custA], "Only sales", "customer cannot use the staff cart");
  await expectErr(`select portal_checkout('[]'::jsonb,null)`, [], "cart is empty", "empty cart rejected");
  await expectErr(`select portal_checkout($1::jsonb,null)`, [JSON.stringify([{ unit_id: item.unit_id, qty: 100000 }])], "Not enough in stock", "cannot order more than is available");
  const so = (await one(`select portal_checkout($1::jsonb,'please leave at the back door') id`, [JSON.stringify([{ unit_id: item.unit_id, qty: 2 }])])).id;
  const orders = (await one(`select portal_orders() o`)).o;
  ok(orders.length === 1 && orders[0].status === "draft" && orders[0].source === "portal" && Number(orders[0].total) === 2.46, "checkout makes a draft order at the customer's price");
  await db.exec(`reset role`);
  const ln = await one(`select unit_price, qty from sales_order_lines where so_id=$1`, [so]);
  ok(Number(ln.unit_price) === 1.23 && Number(ln.qty) === 2, "price was worked out by the database");
  ok((await one(`select source, customer_id from sales_orders where id=$1`, [so])).customer_id === custA, "order belongs to the customer's own account");

  await as(sales);
  const cs = await one(`select catalog_staff($1) c`, [custB]);
  ok(Array.isArray(cs.c) && cs.c.length >= 1 && "tier_price" in cs.c[0], "sales catalog lists items with pricing fields");
  await as(cu);
  await expectErr(`select catalog_staff($1)`, [custB], "Only sales", "customer cannot open the sales catalog");
  // payment type and cash discount: separate from the sales discount
  const cashSo = (await one(`select portal_checkout($1::jsonb,null,'cash') id`, [JSON.stringify([{ unit_id: item.unit_id, qty: 1 }])])).id;
  const cashLine = await one(`select l.unit_price, so.payment_type from sales_order_lines l join sales_orders so on so.id=l.so_id where so.id=$1`, [cashSo]);
  ok(cashLine.payment_type === "cash" && Math.abs(Number(cashLine.unit_price) - Math.round(1.23 * 0.95 * 100) / 100) < 0.005, "cash order takes the cash discount off the price");
  const defSo = (await one(`select portal_checkout($1::jsonb,null) id`, [JSON.stringify([{ unit_id: item.unit_id, qty: 1 }])])).id;
  ok((await one(`select payment_type from sales_orders where id=$1`, [defSo])).payment_type === "card", "payment defaults to the customer's setting");
  await expectErr(`select portal_checkout($1::jsonb,null,'bitcoin')`, [JSON.stringify([{ unit_id: item.unit_id, qty: 1 }])], "cash, card or check", "unknown payment type rejected");
  const hist = await one(`select portal_orders() o`);
  ok(hist.o[0].lines.length >= 1 && "payment_type" in hist.o[0], "order history carries items and payment type");
  await as(sales);
  await expectErr(`select deny_order($1,'  ')`, [cashSo], "reason", "denying needs a reason");
  await q(`select deny_order($1,'Out of season')`, [cashSo]);
  await as(cu);
  ok((await one(`select portal_orders() o`)).o.some((x) => x.denied_reason === "Out of season" && x.status === "cancelled"), "customer sees the denial reason");
  await as(sales);
  // staff cart for any customer
  await as(sales);
  const so2 = (await one(`select catalog_checkout($1,$2::jsonb,null) id`, [custB, JSON.stringify([{ unit_id: item.unit_id, qty: 1 }])])).id;
  ok((await one(`select source from sales_orders where id=$1`, [so2])).source === "app", "sales can build a cart order for a customer");

  // a login that was set up but not verified cannot shop
  await as(admin);
  await q(`select portal_set_up($1,$2)`, [cu2, custB]);
  await db.exec(`set role authenticated`);
  await as(cu2);
  await expectErr(`select portal_catalog()`, [], "not set up", "an unverified login cannot shop");
  await db.exec(`reset role`);
  await as(sales);
  await q(`select portal_remove($1)`, [cu]);
  await db.exec(`set role authenticated`);
  await as(cu);
  await expectErr(`select portal_catalog()`, [], "not set up", "a removed login cannot shop");
  await db.exec(`reset role`);
}

// ---- order workflow: returned to sales, restock on edit, label count ----
{
  await as(admin);
  const sku = await one(`select u.id unit_id, u.product_id, u.factor from product_units u join products p on p.id=u.product_id
                          where p.active and product_available_base(p.id) >= u.factor*6 order by u.factor limit 1`);
  const wc = (await one(`select id from customers where name <> 'Walk-in' order by created_at limit 1`)).id;
  const wso = (await one(`insert into sales_orders (customer_id) values ($1) returning id`, [wc])).id;
  const wl = (await one(`insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price) values ($1,$2,$3,4,2) returning id`, [wso, sku.product_id, sku.unit_id])).id;
  await q(`update sales_orders set status='confirmed' where id=$1`, [wso]);
  await q(`select fulfill_sales_order($1)`, [wso]);
  const stock = async () => Number((await one(`select coalesce(sum(qty_on_hand_base),0) q from lots where product_id=$1`, [sku.product_id])).q);
  const s0 = await stock();
  await expectErr(`select return_to_sales($1,'  ')`, [wso], "note", "sending back needs a note");
  await q(`select return_to_sales($1,'Two were short')`, [wso]);
  ok((await one(`select status from sales_orders where id=$1`, [wso])).status === "returned", "pulled order goes back to sales");
  await expectErr(`update sales_orders set status='fulfilled' where id=$1`, [wso], "cannot be changed", "status can't be changed by hand once returned");
  await expectErr(`select adjust_returned_line($1,$2,5)`, [wso, wl], "cannot be more", "quantity can only go down");
  await q(`select adjust_returned_line($1,$2,2)`, [wso, wl]);
  ok((await stock()) - s0 === 2 * Number(sku.factor), "the difference went back on the shelf");
  const ln = await one(`select qty, cost_total from sales_order_lines where id=$1`, [wl]);
  ok(Number(ln.qty) === 2 && Number(ln.cost_total) > 0, "line shows the new quantity and cost");
  await q(`select resubmit_returned($1)`, [wso]);
  ok((await one(`select status from sales_orders where id=$1`, [wso])).status === "fulfilled", "sent on, it is back at the pulled step");
  await expectErr(`select resubmit_returned($1)`, [wso], "sent back to sales", "can't send on twice");
  await expectErr(`select set_label_count($1,-1)`, [wso], "0 to 500", "label count must be sensible");
  await q(`select set_label_count($1,3)`, [wso]);
  ok(Number((await one(`select label_count from sales_orders where id=$1`, [wso])).label_count) === 3, "label count saved");
}

// ---- password reset requests and printouts config ----
{
  await as(admin);
  const cu = (await one(`select profile_id from portal_accounts limit 1`)).profile_id;
  const rid = (await one(`insert into password_requests (profile_id) values ($1) returning id`, [cu])).id;
  ok(Number((await one(`select pending_reset_count() n`)).n) >= 1, "pending reset request is counted for admin");
  await as(cu);
  await db.exec(`set role authenticated`);
  await expectErr(`insert into password_requests (profile_id) values ($1)`, [cu], "row-level security", "a customer can't write requests directly");
  await expectErr(`select decide_password_request($1,true)`, [rid], "Only sales", "a customer can't approve their own reset");
  ok((await q(`select 1 from password_requests`)).length === 0, "a customer can't read requests");
  ok((await q(`select 1 from print_config`)).length === 0, "customer can't read printouts config");
  await db.exec(`reset role`);
  await as(admin);
  await q(`select decide_password_request($1,true)`, [rid]);
  ok((await one(`select status from password_requests where id=$1`, [rid])).status === "approved", "request approved");
  await expectErr(`select decide_password_request($1,false)`, [rid], "no longer pending", "can't decide twice");
  // printouts config
  ok((await q(`select 1 from print_config`)).length === 1, "printouts config row exists");
  await q(`update print_config set config='{"header":{"name":"Test Co"}}' where id=1`);
  ok((await one(`select config->'header'->>'name' n from print_config`)).n === "Test Co", "admin saves printouts config");
  await expectErr(`insert into print_config (id) values (2)`, [], "", "only one config row");
  await q(`update profiles set active=true where id=$1`, [sales]);
  await as(sales);
  await db.exec(`set role authenticated`);
  const upd = await db.query(`update print_config set config='{}' where id=1 returning id`);
  ok(upd.rows.length === 0, "sales can't change printouts config");
  ok((await q(`select 1 from print_config`)).length === 1, "sales can read printouts config");
  await db.exec(`reset role`);
}


// ---- password hints ----
{
  await as(admin);
  const cu = (await one(`select profile_id from portal_accounts limit 1`)).profile_id;
  await db.exec(`select set_config('app.via_rpc','1',false)`);
  await q(`update profiles set active=true where id=$1`, [cu]);
  await db.exec(`select set_config('app.via_rpc','',false)`);
  await as(cu);
  await db.exec(`set role authenticated`);
  await q(`insert into password_hints (profile_id, hint) values ($1, 'my first dog')`, [cu]);
  ok((await one(`select hint from password_hints`)).hint === "my first dog", "customer sets and reads own hint");
  await q(`update password_hints set hint='street I grew up on' where profile_id=$1`, [cu]);
  await expectErr(`insert into password_hints (profile_id, hint) values ($1, 'x')`, [admin], "row-level security", "customer can't set someone else's hint");
  await expectErr(`update password_hints set hint=$2 where profile_id=$1`, [cu, "x".repeat(101)], "check", "hint is 100 characters or fewer");
  await db.exec(`reset role`);
  await as(sales);
  await db.exec(`set role authenticated`);
  ok((await q(`select 1 from password_hints`)).length === 0, "staff can't read customer hints");
  await expectErr(`insert into password_hints (profile_id, hint) values ($1, 'x')`, [sales], "row-level security", "staff can't set a hint");
  await db.exec(`reset role`);
}


// ---- sections and shelves ----
{
  await as(admin);
  const c1 = (await one(`select id, layout_id from locations where name='Cooler 1'`));
  const c2 = (await one(`select id from locations where name='Cooler 2'`)).id;
  const sec = (await one(`insert into location_sections (location_id, name, shelves) values ($1, ' Rack A ', array['1','2',' 2 ','Top','']) returning id, name, shelves`, [c1.id]));
  ok(sec.name === "Rack A" && JSON.stringify(sec.shelves) === JSON.stringify(["1","2","Top"]), "section name and shelves cleaned: " + JSON.stringify(sec.shelves));
  await expectErr(`insert into location_sections (location_id, name) values ($1, 'rack a')`, [c1.id], "location_sections_name_uidx", "section names are unique within a location");
  const lot = (await one(`select id from lots where location_id=$1 and qty_on_hand_base > 0 limit 1`, [c1.id])).id;
  await q(`select set_lot_spot($1,$2,'top')`, [lot, sec.id]);
  const l1 = await one(`select section_id, shelf from lots where id=$1`, [lot]);
  ok(l1.section_id === sec.id && l1.shelf === "Top", "lot spot saved with the shelf's own spelling");
  await expectErr(`select set_lot_spot($1,$2,'9')`, [lot, sec.id], "no such shelf", "unknown shelf refused");
  const sec2 = (await one(`insert into location_sections (location_id, name, shelves) values ($1, 'Bucket row', array['Floor']) returning id`, [c2])).id;
  await expectErr(`select set_lot_spot($1,$2,null)`, [lot, sec2], "isn't in this lot's location", "section from another location refused");
  ok((await one(`select section_name, shelf, spot_from from v_lot_spot where lot_id=$1`, [lot])).spot_from === "stock", "spot view reads the stock's own spot");
  await q(`update location_sections set shelves=array['1','2'] where id=$1`, [sec.id]);
  ok((await one(`select shelf from lots where id=$1`, [lot])).shelf === null, "removing a shelf clears it from stock");
  // moving stock to another location clears its spot
  await q(`select set_lot_spot($1,$2,'1')`, [lot, sec.id]);
  const qty = Number((await one(`select qty_on_hand_base q from lots where id=$1`, [lot])).q);
  const moved = (await one(`select transfer_stock($1,$2,$3) id`, [lot, qty, c2])).id;
  ok((await one(`select section_id from lots where id=$1`, [moved])).section_id === null, "moved stock loses its old section");
  // home spot
  const prod = (await one(`select product_id from lots where id=$1`, [lot])).product_id;
  await q(`select set_home_location($1,$2,$3)`, [prod, c1.layout_id, c1.id]);
  await q(`select set_home_spot($1,$2,$3,'2')`, [prod, c1.layout_id, sec.id]);
  ok((await one(`select shelf from product_homes where product_id=$1 and layout_id=$2`, [prod, c1.layout_id])).shelf === "2", "home spot saved");
  await q(`select transfer_stock($1,$2,$3)`, [moved, qty, c1.id]);
  const back = await one(`select section_name, shelf, spot_from from v_lot_spot where lot_id=$1`, [moved]);
  ok(back.spot_from === "home" && back.section_name === "Rack A" && back.shelf === "2", "stock without its own spot uses the item's home spot");
  await q(`select set_home_location($1,$2,$3)`, [prod, c1.layout_id, c2]);
  ok((await one(`select section_id from product_homes where product_id=$1 and layout_id=$2`, [prod, c1.layout_id])).section_id === null, "moving the home clears its spot");
  await q(`delete from location_sections where id=$1`, [sec.id]);
  ok((await q(`select 1 from lots where section_id=$1`, [sec.id])).length === 0, "deleting a section frees stock");
  await as(sales);
  await db.exec(`set role authenticated`);
  await expectErr(`insert into location_sections (location_id, name) values ($1, 'X')`, [c2], "row-level security", "sales can't add sections");
  await expectErr(`select set_lot_spot($1,null,null)`, [moved], "Not authorized", "sales can't move stock spots");
  ok((await q(`select 1 from location_sections`)).length >= 1, "staff can read sections");
  await db.exec(`reset role`);
}


// ---- documents and signing ----
{
  await as(admin);
  await db.exec(`set role authenticated`);
  const d = (await one(`insert into wordsmith_docs (title) values ('Notes') returning id, owner_id`));
  ok(d.owner_id === admin, "a document belongs to whoever made it");
  await db.exec(`reset role`);
  await as(sales);
  await db.exec(`set role authenticated`);
  ok((await q(`select 1 from wordsmith_docs where id=$1`, [d.id])).length === 0, "nobody else can read someone's documents");
  const up = await db.query(`update wordsmith_docs set title='x' where id=$1 returning id`, [d.id]);
  ok(up.rows.length === 0, "nobody else can change them");
  const sd = (await one(`insert into signature_docs (name) values ('Credit application') returning id`)).id;
  ok(!!sd, "staff can add a document to sign");
  await expectErr(`insert into signature_requests (doc_id, token, recipient_email) values ($1,'t1','a@b.co')`, [sd], "row-level security", "requests are only created by the server");
  await db.exec(`reset role`);
  await q(`insert into signature_requests (doc_id, token, recipient_email, sender_id, sender_email) values ($1,'tok-1','Sam@Example.com',$2,'admin@x.co')`, [sd, admin]);
  await q(`update profiles set email='sam@example.com' where id=$1`, [sales]);
  const cu = (await one(`select profile_id from portal_accounts limit 1`)).profile_id;
  await as(cu);
  await db.exec(`set role authenticated`);
  ok((await q(`select 1 from signature_requests`)).length === 0, "a customer can't see requests sent to someone else");
  ok((await q(`select 1 from signature_docs`)).length === 0, "customers can't see documents to sign");
  await db.exec(`reset role`);
  await expectErr(`insert into signature_requests (token, recipient_email) values ('tok-2','not-an-email')`, [], "check", "recipient must be an email");
}


// ---- knowledge base articles ----
{
  await q(`update profiles set active=true, role='sales' where id=$1`, [sales]);
  await as(sales);
  await db.exec(`set role authenticated`);
  const a = await one(`insert into kb_articles (category, title, body) values ('Orders', ' Rush orders ', array[' Call the cooler first. ', '', 'Then mark MUST CHECK.']) returning id, title, body, author_id`);
  ok(a.title === "Rush orders" && a.body.length === 2 && a.author_id === sales, "staff add an article; text tidied");
  await expectErr(`insert into kb_articles (builtin_id, category, title) values ('labels-faq','Stock','Mine now')`, [], "row-level security", "staff can't change a built-in article");
  await expectErr(`insert into kb_articles (category, title, hidden) values ('Stock','x', true)`, [], "row-level security", "staff can't hide articles");
  await q(`update kb_articles set title='Rush orders (cooler first)' where id=$1`, [a.id]);
  ok((await one(`select title from kb_articles where id=$1`, [a.id])).title === "Rush orders (cooler first)", "author edits their article");
  await db.exec(`reset role`);
  await as(admin);
  await db.exec(`set role authenticated`);
  await q(`update kb_articles set body=array['Edited by admin'] where id=$1`, [a.id]);
  const e = await one(`select body, author_id, updated_by from kb_articles where id=$1`, [a.id]);
  ok(e.body[0] === "Edited by admin" && e.author_id === sales && e.updated_by === admin, "admin edits anyone's article; author kept");
  await q(`insert into kb_articles (builtin_id, category, title, hidden) values ('labels-faq','Stock','Label printing', true)`);
  ok((await q(`select 1 from kb_articles where builtin_id='labels-faq' and hidden`)).length === 1, "admin hides a built-in article");
  await db.exec(`reset role`);
  const w = "00000000-0000-0000-0000-0000000000a9";
  await q(`insert into auth.users (id, email) values ($1, 'wes@example.com') on conflict do nothing`, [w]);
  await q(`insert into profiles (id, email, role, active) values ($1, 'wes@example.com', 'warehouse', true) on conflict (id) do update set role='warehouse', active=true`, [w]);
  await as(w);
  await db.exec(`set role authenticated`);
  const up = await db.query(`update kb_articles set title='hijack' where id=$1 returning id`, [a.id]);
  ok(up.rows.length === 0, "someone else can't edit an article");
  const dl = await db.query(`delete from kb_articles where id=$1 returning id`, [a.id]);
  ok(dl.rows.length === 0, "or remove it");
  await db.exec(`reset role`);
  const cu = (await one(`select profile_id from portal_accounts limit 1`)).profile_id;
  await as(cu);
  await db.exec(`set role authenticated`);
  ok((await q(`select 1 from kb_articles`)).length === 0, "customers can't read the knowledge base");
  await db.exec(`reset role`);
}

console.log(`\n${pass} checks passed`);
