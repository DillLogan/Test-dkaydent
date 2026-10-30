-- =====================================================================
-- Direct ship: purchase orders bought for one customer. Receiving one
-- can put what came in straight onto a new order for that customer,
-- with the stock held for that order so nobody else sells it.
-- Partial shipments: a shipment that came in short stays open
-- ("arrived") until the rest is received, moved or closed short.
-- =====================================================================

alter table standing_orders add column direct_customer_id uuid references customers(id) on delete set null;
alter table purchase_orders add column direct_customer_id uuid references customers(id) on delete set null;
alter table sales_orders    add column from_po_id uuid references purchase_orders(id) on delete set null;
alter table lots            add column held_for_line uuid references sales_order_lines(id) on delete set null;
create index lots_held_idx on lots (held_for_line) where held_for_line is not null;
create index sales_orders_from_po_idx on sales_orders (from_po_id) where from_po_id is not null;

-- Generated POs carry the standing order's direct-ship customer.
create or replace function generate_standing_orders(p_standing_order_id uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_so  standing_orders;
  d     date;
  v_sh  uuid;
  v_po  uuid;
  v_n   integer := 0;
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  for v_so in select * from standing_orders
               where active and (p_standing_order_id is null or id = p_standing_order_id) loop
    if not exists (select 1 from standing_order_lines where standing_order_id = v_so.id) then continue; end if;
    for d in select * from standing_occurrences(v_so, current_date, (current_date + interval '1 year')::date) loop
      if exists (select 1 from purchase_orders where standing_order_id = v_so.id and occurrence_date = d) then continue; end if;
      insert into shipments (eta, carrier, notes)
        values (d, v_so.carrier, 'Standing order: ' || v_so.name)
        returning id into v_sh;
      insert into purchase_orders (vendor_id, status, order_date, expected_date, freight_cost, notes,
                                   shipment_id, standing_order_id, occurrence_date, direct_customer_id)
        values (v_so.vendor_id, 'draft', greatest(current_date, d - v_so.lead_days), d, v_so.freight_cost,
                'Standing order: ' || v_so.name, v_sh, v_so.id, d, v_so.direct_customer_id)
        returning id into v_po;
      insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost)
        select v_po, product_id, unit_id, qty, unit_cost from standing_order_lines where standing_order_id = v_so.id;
      v_n := v_n + 1;
    end loop;
  end loop;
  perform set_config('app.via_rpc', '', true);
  return v_n;
end $$;

-- Changing a generated PO's direct-ship customer by hand counts as customizing it.
create or replace function mark_po_customized() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1'
     and new.standing_order_id is not null
     and (new.expected_date, new.order_date, new.freight_cost, new.other_cost, new.notes, new.vendor_id, new.status, new.direct_customer_id)
         is distinct from
         (old.expected_date, old.order_date, old.freight_cost, old.other_cost, old.notes, old.vendor_id, old.status, old.direct_customer_id) then
    new.customized := true;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Shipments that came in short
-- ---------------------------------------------------------------------

-- A partly received shipment is done once none of its POs are still open.
create function settle_shipment(p_shipment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(current_setting('app.via_rpc', true), '');
begin
  if p_shipment_id is null then return; end if;
  if exists (select 1 from shipments where id = p_shipment_id and status = 'arrived' and received_at is not null)
     and not exists (select 1 from purchase_orders where shipment_id = p_shipment_id
                      and status in ('draft','ordered','partially_received')) then
    perform set_config('app.via_rpc', '1', true);
    update shipments set status = 'received' where id = p_shipment_id;
    perform set_config('app.via_rpc', v_prev, true);
  end if;
end $$;
revoke all on function settle_shipment(uuid) from public, anon, authenticated;

create function po_settle_shipment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.shipment_id is distinct from old.shipment_id then
    perform settle_shipment(old.shipment_id);
    if new.shipment_id is distinct from old.shipment_id then perform settle_shipment(new.shipment_id); end if;
  end if;
  return null;
end $$;
create trigger purchase_orders_settle_shipment after update on purchase_orders
  for each row execute function po_settle_shipment();

-- ---------------------------------------------------------------------
-- Direct ship → customer order
-- ---------------------------------------------------------------------

-- The customer's order for one receipt of a direct-ship PO: a line per lot
-- received, at the customer's usual prices, ready to pull, its stock held.
create function direct_ship_order(p_po_id uuid, p_receipt uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po   purchase_orders;
  v_pay  text;
  v_cash numeric;
  v_so   uuid;
  v_line uuid;
  v_price numeric;
  r      record;
begin
  select * into v_po from purchase_orders where id = p_po_id;
  select default_payment, cash_discount_pct into v_pay, v_cash from customers where id = v_po.direct_customer_id;
  perform set_config('app.via_rpc', '1', true);
  insert into sales_orders (customer_id, status, notes, payment_type, from_po_id, created_by)
    values (v_po.direct_customer_id, 'confirmed', 'Direct ship from ' || v_po.po_number, v_pay, v_po.id, auth.uid())
    returning id into v_so;
  for r in select l.id as lot_id, l.product_id, pl.unit_id, u.factor, l.qty_received_base
             from lots l
             join purchase_order_lines pl on pl.id = l.po_line_id
             join product_units u on u.id = pl.unit_id
            where l.receipt_id = p_receipt
            order by l.created_at, l.id loop
    v_price := customer_unit_price(v_po.direct_customer_id, r.unit_id);
    if v_pay = 'cash' and coalesce(v_cash, 0) > 0 then v_price := round(v_price * (1 - v_cash / 100), 2); end if;
    insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
      values (v_so, r.product_id, r.unit_id, trim_scale(round(r.qty_received_base / r.factor, 6)), coalesce(v_price, 0))
      returning id into v_line;
    update lots set held_for_line = v_line where id = r.lot_id;
  end loop;
  return v_so;
end $$;
revoke all on function direct_ship_order(uuid, uuid) from public, anon, authenticated;

create function direct_ship_check(p_po purchase_orders) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_po.direct_customer_id is null then
    raise exception '% isn''t a direct-ship order', p_po.po_number;
  end if;
  if not exists (select 1 from customers where id = p_po.direct_customer_id and active) then
    raise exception 'The direct-ship customer on % is no longer active', p_po.po_number;
  end if;
end $$;
revoke all on function direct_ship_check(purchase_orders) from public, anon, authenticated;

-- Receive a direct-ship PO (same lines as receive_po) and make the customer's order.
create function receive_po_to_customer(p_po_id uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_po purchase_orders; v_receipt uuid;
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  select * into v_po from purchase_orders where id = p_po_id;
  if not found then raise exception 'Purchase order not found'; end if;
  perform direct_ship_check(v_po);
  v_receipt := receive_po(p_po_id, p_lines);
  return direct_ship_order(p_po_id, v_receipt);
end $$;

-- Receive a shipment. POs listed in p_to_customer go to their customer's order.
-- A shipment that came in short stays "arrived" until the rest is settled.
drop function receive_shipment(uuid, jsonb);
create function receive_shipment(p_shipment_id uuid, p_lines jsonb, p_to_customer uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sh     shipments;
  v_po     purchase_orders;
  v_lines  jsonb;
  v_pos    integer := 0;
  v_lots   integer := 0;
  v_rcpt   uuid;
  v_orders uuid[] := '{}';
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  select * into v_sh from shipments where id = p_shipment_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  if v_sh.status in ('received','cancelled') then raise exception 'This shipment is already %', v_sh.status; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines, '[]')) r
     where coalesce((r->>'qty')::numeric, 0) > 0
       and not exists (select 1 from purchase_order_lines l join purchase_orders po on po.id = l.po_id
                        where l.id = (r->>'line_id')::uuid and po.shipment_id = p_shipment_id)) then
    raise exception 'A line isn''t on this shipment';
  end if;

  for v_po in select * from purchase_orders
               where shipment_id = p_shipment_id and status in ('draft','ordered','partially_received')
               order by po_number loop
    select coalesce(jsonb_agg(r), '[]') into v_lines
      from jsonb_array_elements(coalesce(p_lines, '[]')) r
      join purchase_order_lines l on l.id = (r->>'line_id')::uuid
     where l.po_id = v_po.id and coalesce((r->>'qty')::numeric, 0) > 0;
    if jsonb_array_length(v_lines) = 0 then continue; end if;
    if v_po.id = any(coalesce(p_to_customer, '{}')) then perform direct_ship_check(v_po); end if;

    perform set_config('app.via_rpc', '1', true);
    if v_po.status = 'draft' then
      update purchase_orders set status = 'ordered', order_date = coalesce(order_date, current_date)
       where id = v_po.id;
    end if;
    v_rcpt := receive_po(v_po.id, v_lines);
    if v_po.id = any(coalesce(p_to_customer, '{}')) then
      v_orders := v_orders || direct_ship_order(v_po.id, v_rcpt);
    end if;
    v_pos := v_pos + 1;
    v_lots := v_lots + jsonb_array_length(v_lines);
  end loop;

  if v_pos = 0 then raise exception 'Enter a received quantity for at least one line'; end if;

  perform set_config('app.via_rpc', '1', true);
  update shipments
     set status = case when exists (select 1 from purchase_orders where shipment_id = p_shipment_id
                                     and status in ('draft','ordered','partially_received'))
                       then 'arrived'::shipment_status else 'received'::shipment_status end,
         received_at = now()
   where id = p_shipment_id;
  perform set_config('app.via_rpc', '', true);
  return jsonb_build_object('pos', v_pos, 'lots', v_lots, 'orders', to_jsonb(v_orders),
                            'open', (select status = 'arrived' from shipments where id = p_shipment_id));
end $$;

-- ---------------------------------------------------------------------
-- Held stock: only its own order may take it
-- ---------------------------------------------------------------------

create or replace function fulfill_sales_order(p_so_id uuid, p_picks jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_so     sales_orders;
  v_line   record;
  v_lot    lots;
  v_pick   record;
  v_need   numeric;
  v_take   numeric;
  v_cost   numeric;
  v_picked numeric;
begin
  if not has_role('sales','warehouse') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);

  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'confirmed' then raise exception 'Only confirmed orders can be fulfilled'; end if;
  if not exists (select 1 from sales_order_lines where so_id = p_so_id) then
    raise exception 'Order has no lines';
  end if;

  for v_line in
    select l.*, u.factor, p.name as product_name, p.base_unit
      from sales_order_lines l
      join product_units u on u.id = l.unit_id
      join products p on p.id = l.product_id
     where l.so_id = p_so_id
     order by l.created_at
  loop
    v_need := v_line.qty * v_line.factor;
    v_cost := 0;

    select coalesce(sum((e->>'qty_base')::numeric), 0) into v_picked
      from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) e
     where (e->>'so_line_id')::uuid = v_line.id and coalesce((e->>'qty_base')::numeric, 0) > 0;

    if v_picked > 0 then
      if v_picked <> v_need then
        raise exception 'Picked % % of % but the line needs %', v_picked, v_line.base_unit, v_line.product_name, v_need;
      end if;
      for v_pick in
        select (e->>'lot_id')::uuid as lot_id, sum((e->>'qty_base')::numeric) as qty
          from jsonb_array_elements(p_picks) e
         where (e->>'so_line_id')::uuid = v_line.id and coalesce((e->>'qty_base')::numeric, 0) > 0
         group by 1
      loop
        select * into v_lot from lots where id = v_pick.lot_id for update;
        if not found or v_lot.product_id <> v_line.product_id then
          raise exception 'A picked lot is not % stock', v_line.product_name;
        end if;
        if v_lot.held_for_line is not null and v_lot.held_for_line <> v_line.id then
          raise exception 'Lot % is held for another order', v_lot.lot_code;
        end if;
        if v_pick.qty > v_lot.qty_on_hand_base then
          raise exception 'Lot % only has % % of %', v_lot.lot_code, v_lot.qty_on_hand_base, v_line.base_unit, v_line.product_name;
        end if;
        update lots set qty_on_hand_base = qty_on_hand_base - v_pick.qty where id = v_lot.id;
        insert into sales_allocations (so_line_id, lot_id, qty_base, unit_cost_base)
        values (v_line.id, v_lot.id, v_pick.qty, v_lot.unit_cost_base);
        insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reference)
        values (v_lot.id, v_line.product_id, v_lot.location_id, 'sale', -v_pick.qty, v_so.so_number);
        v_cost := v_cost + v_pick.qty * v_lot.unit_cost_base;
      end loop;
    else
      -- its own held stock first, then oldest first; stock held for other orders is left alone
      for v_lot in
        select * from lots
         where product_id = v_line.product_id and qty_on_hand_base > 0
           and (held_for_line is null or held_for_line = v_line.id)
         order by (held_for_line is distinct from v_line.id), received_at, created_at
         for update
      loop
        exit when v_need <= 0;
        v_take := least(v_need, v_lot.qty_on_hand_base);
        update lots set qty_on_hand_base = qty_on_hand_base - v_take where id = v_lot.id;
        insert into sales_allocations (so_line_id, lot_id, qty_base, unit_cost_base)
        values (v_line.id, v_lot.id, v_take, v_lot.unit_cost_base);
        insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reference)
        values (v_lot.id, v_line.product_id, v_lot.location_id, 'sale', -v_take, v_so.so_number);
        v_cost := v_cost + v_take * v_lot.unit_cost_base;
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then
        raise exception 'Not enough stock for %: short % %', v_line.product_name, v_need, v_line.base_unit;
      end if;
    end if;

    update sales_order_lines set cost_total = v_cost where id = v_line.id;
  end loop;

  update sales_orders set status = 'fulfilled', fulfilled_at = now() where id = p_so_id;
end $$;

-- Pulled or cancelled: the hold has done its job (or isn't needed).
create function release_held_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status::text in ('fulfilled','cancelled') then
    update lots set held_for_line = null
     where held_for_line in (select id from sales_order_lines where so_id = new.id);
  end if;
  return null;
end $$;
create trigger sales_orders_release_held after update on sales_orders
  for each row execute function release_held_stock();

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function receive_po_to_customer(uuid, jsonb), receive_shipment(uuid, jsonb, uuid[]) from public, anon;
grant execute on function receive_po_to_customer(uuid, jsonb), receive_shipment(uuid, jsonb, uuid[]) to authenticated;
