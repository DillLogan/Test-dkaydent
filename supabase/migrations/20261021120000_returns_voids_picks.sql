-- =====================================================================
-- Returns & credits, invoice voids, hand-picked lots at fulfillment
-- =====================================================================

-- ---------- Invoice voids ----------
-- An order can be re-invoiced after its invoice is voided, so only one
-- non-void invoice may exist per order.
alter table invoices drop constraint if exists invoices_so_id_key;
create unique index invoices_one_active_per_so on invoices (so_id) where status <> 'void';

create function guard_invoice_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'void' then
      raise exception 'A void invoice cannot be reopened';
    end if;
    if new.status = 'void' and coalesce(current_setting('app.via_rpc', true), '') <> '1' then
      raise exception 'Use Void invoice to void';
    end if;
  end if;
  return new;
end $$;

create trigger invoices_guard before update on invoices
  for each row execute function guard_invoice_status();

-- Void an open invoice. The order goes back to "fulfilled" so it can be
-- corrected and invoiced again. Stock is not touched (use a return for that).
create function void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_inv from invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'open' then raise exception 'Only open (unpaid) invoices can be voided'; end if;
  update invoices set status = 'void' where id = p_invoice_id;
  update sales_orders set status = 'fulfilled' where id = v_inv.so_id and status = 'invoiced';
end $$;

-- ---------- Returns & credits ----------
create type credit_status as enum ('open','applied','refunded');
create sequence return_number_seq start 1001;

create table returns (
  id            uuid primary key default gen_random_uuid(),
  return_number text not null unique default ('RMA-' || nextval('return_number_seq')),
  so_id         uuid not null references sales_orders(id),
  customer_id   uuid not null references customers(id),
  reason        text,
  subtotal      numeric not null default 0,
  tax           numeric not null default 0,
  total         numeric not null default 0,
  credit_status credit_status not null default 'open',
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create table return_lines (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references returns(id) on delete cascade,
  so_line_id      uuid not null references sales_order_lines(id),
  product_id      uuid not null references products(id),
  qty             numeric not null check (qty > 0),   -- in the sale line's unit
  qty_base        numeric not null,
  restock         boolean not null,
  credit          numeric not null,                   -- qty × sale price
  cost_total      numeric not null                    -- FIFO cost of the returned units
);

-- Which sale allocations (and so which lots) each return reversed.
create table return_allocations (
  id                  uuid primary key default gen_random_uuid(),
  return_line_id      uuid not null references return_lines(id) on delete cascade,
  sales_allocation_id uuid not null references sales_allocations(id),
  lot_id              uuid not null references lots(id),
  qty_base            numeric not null,
  unit_cost_base      numeric not null
);

-- Return items from a fulfilled or invoiced order.
-- p_lines: [{ "so_line_id": uuid, "qty": number (in the line's unit), "restock": bool }]
-- Every returned unit goes back into the exact lot it was sold from.
-- Items that can't be resold are returned and immediately written off as
-- shrink, so the loss shows in shrink reports.
create function create_return(p_so_id uuid, p_lines jsonb, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_so       sales_orders;
  v_ret      uuid;
  v_ret_no   text;
  v_tax_rate numeric;
  v_line     record;
  v_alloc    record;
  v_rl       uuid;
  v_need     numeric;
  v_take     numeric;
  v_cost     numeric;
  v_sub      numeric := 0;
  v_restock  boolean;
  v_qty      numeric;
  v_done     numeric;
  v_any      boolean := false;
  r          jsonb;
begin
  if not has_role('sales','warehouse') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);

  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status not in ('fulfilled','invoiced') then
    raise exception 'Only fulfilled or invoiced orders can take returns';
  end if;

  select tax_rate into v_tax_rate from invoices where so_id = p_so_id and status <> 'void';
  v_tax_rate := coalesce(v_tax_rate, 0);

  insert into returns (so_id, customer_id, reason)
  values (p_so_id, v_so.customer_id, nullif(trim(coalesce(p_reason, '')), ''))
  returning id, return_number into v_ret, v_ret_no;

  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((r->>'qty')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    v_restock := coalesce((r->>'restock')::boolean, true);

    select l.*, u.factor, p.name as product_name, p.base_unit
      into v_line
      from sales_order_lines l
      join product_units u on u.id = l.unit_id
      join products p on p.id = l.product_id
     where l.id = (r->>'so_line_id')::uuid and l.so_id = p_so_id;
    if not found then raise exception 'Line is not on this order'; end if;

    v_need := v_qty * v_line.factor;
    select coalesce(sum(qty_base), 0) into v_done from return_lines where so_line_id = v_line.id;
    if v_done + v_need > v_line.qty * v_line.factor then
      raise exception 'Can''t return more % than was sold (% % already returned of % %)',
        v_line.product_name, v_done, v_line.base_unit, v_line.qty * v_line.factor, v_line.base_unit;
    end if;

    insert into return_lines (return_id, so_line_id, product_id, qty, qty_base, restock, credit, cost_total)
    values (v_ret, v_line.id, v_line.product_id, v_qty, v_need, v_restock, round(v_qty * v_line.unit_price, 2), 0)
    returning id into v_rl;

    v_cost := 0;
    -- Reverse the most recent allocations first
    for v_alloc in
      select a.id, a.lot_id, a.unit_cost_base,
             a.qty_base - coalesce((select sum(ra.qty_base) from return_allocations ra where ra.sales_allocation_id = a.id), 0) as remaining
        from sales_allocations a
        join lots l on l.id = a.lot_id
       where a.so_line_id = v_line.id
       order by l.received_at desc, a.id
    loop
      exit when v_need <= 0;
      continue when v_alloc.remaining <= 0;
      v_take := least(v_need, v_alloc.remaining);

      insert into return_allocations (return_line_id, sales_allocation_id, lot_id, qty_base, unit_cost_base)
      values (v_rl, v_alloc.id, v_alloc.lot_id, v_take, v_alloc.unit_cost_base);

      update lots set qty_on_hand_base = qty_on_hand_base + v_take where id = v_alloc.lot_id;
      insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
      select v_alloc.lot_id, v_line.product_id, l.location_id, 'return', v_take, p_reason, v_ret_no
        from lots l where l.id = v_alloc.lot_id;

      if not v_restock then
        update lots set qty_on_hand_base = qty_on_hand_base - v_take where id = v_alloc.lot_id;
        insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
        select v_alloc.lot_id, v_line.product_id, l.location_id, 'shrink', -v_take,
               'Customer return, not resellable' || coalesce(' — ' || nullif(trim(p_reason), ''), ''), v_ret_no
          from lots l where l.id = v_alloc.lot_id;
      end if;

      v_cost := v_cost + v_take * v_alloc.unit_cost_base;
      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then raise exception 'Could not match the return to the lots this order shipped from'; end if;
    update return_lines set cost_total = v_cost where id = v_rl;
    v_sub := v_sub + round(v_qty * v_line.unit_price, 2);
    v_any := true;
  end loop;

  if not v_any then raise exception 'Enter a quantity for at least one line'; end if;

  update returns
     set subtotal = v_sub,
         tax = round(v_sub * v_tax_rate / 100, 2),
         total = v_sub + round(v_sub * v_tax_rate / 100, 2)
   where id = v_ret;
  return v_ret;
end $$;

-- ---------- Fulfillment with optional hand-picked lots ----------
-- p_picks: [{ "so_line_id": uuid, "lot_id": uuid, "qty_base": number }]
-- Lines with picks use exactly those lots (must total the line's quantity);
-- lines without picks use oldest lots first.
drop function if exists fulfill_sales_order(uuid);

create function fulfill_sales_order(p_so_id uuid, p_picks jsonb default null) returns void
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
      for v_lot in
        select * from lots
         where product_id = v_line.product_id and qty_on_hand_base > 0
         order by received_at, created_at
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

revoke execute on function void_invoice(uuid), create_return(uuid, jsonb, text), fulfill_sales_order(uuid, jsonb) from public;
grant execute on function void_invoice(uuid), create_return(uuid, jsonb, text), fulfill_sales_order(uuid, jsonb) to authenticated;

-- ---------- Reporting ----------
create view v_return_lines with (security_invoker = true) as
select rl.id as line_id, r.id as return_id, r.return_number, r.created_at, r.so_id,
       r.customer_id, c.name as customer_name, r.credit_status,
       rl.product_id, p.sku, p.name as product_name, p.kind, p.base_unit,
       rl.qty_base, rl.restock, rl.credit, rl.cost_total as cost
  from return_lines rl
  join returns r on r.id = rl.return_id
  join customers c on c.id = r.customer_id
  join products p on p.id = rl.product_id;

-- ---------- RLS ----------
alter table returns            enable row level security;
alter table return_lines       enable row level security;
alter table return_allocations enable row level security;

create policy "members read" on returns            for select to authenticated using (is_member());
create policy "members read" on return_lines       for select to authenticated using (is_member());
create policy "members read" on return_allocations for select to authenticated using (is_member());

-- Sales can move a credit from open to applied/refunded; everything else comes from create_return.
create policy "sales update credit" on returns for update to authenticated
  using (has_role('sales')) with check (has_role('sales'));

create function guard_return_update() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1'
     and (new.subtotal, new.tax, new.total, new.so_id, new.customer_id)
         is distinct from (old.subtotal, old.tax, old.total, old.so_id, old.customer_id) then
    raise exception 'Only the credit status of a return can be changed';
  end if;
  return new;
end $$;

create trigger returns_guard before update on returns
  for each row execute function guard_return_update();
