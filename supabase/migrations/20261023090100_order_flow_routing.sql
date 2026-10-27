-- Order steps and routing.
--   draft      Draft (sales rep builds the order)
--   confirmed  Ready to pull (pick ticket printed)
--   fulfilled  Pulled (ticket turned in, stock taken out)
--   completed  Completed (orders manager checked it)  <- new
--   invoiced   Invoiced
-- Delivery addresses for customers and orders, shop addresses, a geocode
-- cache and saved route sheets for the Routing page.

-- ---------- Orders ----------
alter table sales_orders
  add column completed_at     timestamptz,
  add column completed_by     uuid references profiles(id),
  add column delivery_address text,
  add column layout_id        uuid references shop_layouts(id) on delete set null;

alter table customers add column delivery_address text;
alter table shop_layouts add column address text;

-- New orders deliver to the customer's delivery address (or main address)
-- and ship from the first shop unless told otherwise.
create function so_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delivery_address is null then
    select nullif(trim(coalesce(c.delivery_address, c.address, '')), '') into new.delivery_address
      from customers c where c.id = new.customer_id;
  end if;
  if new.layout_id is null then
    select id into new.layout_id from shop_layouts order by created_at, id limit 1;
  end if;
  return new;
end $$;
create trigger sales_orders_defaults before insert on sales_orders
  for each row execute function so_defaults();

update sales_orders so set
  delivery_address = nullif(trim(coalesce(c.delivery_address, c.address, '')), ''),
  layout_id = (select id from shop_layouts order by created_at, id limit 1)
  from customers c where c.id = so.customer_id;

-- "completed" joins the statuses only functions may set
create or replace function guard_status() returns trigger
language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = '1';
begin
  if new.status is distinct from old.status and not v_rpc then
    if new.status::text in ('partially_received','received','fulfilled','completed','invoiced')
       or old.status::text in ('partially_received','received','fulfilled','completed','invoiced','cancelled') then
      raise exception 'Status cannot be changed from % to % directly', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Orders manager: mark a pulled order completed (or send it back to pulled)
create function complete_sales_order(p_so_id uuid, p_undo boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('orders_manager') then raise exception 'Only the orders manager can complete orders'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if not p_undo then
    if v_so.status <> 'fulfilled' then raise exception 'Only pulled orders can be completed'; end if;
    update sales_orders set status = 'completed', completed_at = now(), completed_by = auth.uid() where id = p_so_id;
  else
    if v_so.status <> 'completed' then raise exception 'Only completed orders can be sent back'; end if;
    update sales_orders set status = 'fulfilled', completed_at = null, completed_by = null where id = p_so_id;
  end if;
end $$;
revoke execute on function complete_sales_order(uuid, boolean) from public;
grant execute on function complete_sales_order(uuid, boolean) to authenticated;

-- Orders managers may also invoice
create or replace function create_invoice(p_so_id uuid, p_tax_rate numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_terms integer; v_sub numeric; v_tax numeric; v_id uuid;
begin
  if not has_role('sales','orders_manager') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'completed' then raise exception 'Only completed orders can be invoiced. The orders manager marks an order completed once its pull ticket is turned in.'; end if;

  select payment_terms_days into v_terms from customers where id = v_so.customer_id;
  select round(coalesce(sum(qty * unit_price), 0), 2) into v_sub from sales_order_lines where so_id = p_so_id;
  v_tax := round(v_sub * coalesce(p_tax_rate, 0) / 100, 2);

  insert into invoices (so_id, customer_id, due_at, subtotal, tax_rate, tax, total)
  values (p_so_id, v_so.customer_id, current_date + coalesce(v_terms, 30), v_sub, coalesce(p_tax_rate, 0), v_tax, v_sub + v_tax)
  returning id into v_id;

  update sales_orders set status = 'invoiced' where id = p_so_id;
  return v_id;
end $$;

create or replace function void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices;
begin
  if not has_role('sales','orders_manager') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_inv from invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'open' then raise exception 'Only open (unpaid) invoices can be voided'; end if;
  update invoices set status = 'void' where id = p_invoice_id;
  update sales_orders set status = 'completed' where id = v_inv.so_id and status = 'invoiced';
end $$;

create or replace function create_return(p_so_id uuid, p_lines jsonb, p_reason text default null) returns uuid
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
  if v_so.status not in ('fulfilled','completed','invoiced') then
    raise exception 'Only pulled, completed or invoiced orders can take returns';
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

create or replace function complete_counter_sale(p_so_id uuid, p_tax_rate numeric default 0, p_payment jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_inv uuid; v_due numeric;
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.channel not in ('counter','terminal') then raise exception 'Not a counter sale'; end if;
  if v_so.status = 'confirmed' then
    perform fulfill_sales_order(p_so_id);
  end if;
  -- A counter sale is handed over on the spot, so it is completed right away
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set status = 'completed', completed_at = now(), completed_by = auth.uid()
   where id = p_so_id and status = 'fulfilled';
  select id into v_inv from invoices where so_id = p_so_id and status <> 'void';
  if v_inv is null then
    v_inv := create_invoice(p_so_id, coalesce(p_tax_rate, 0));
    perform set_config('app.via_rpc', '1', true);
    update invoices set due_at = issued_at where id = v_inv;
  end if;
  if p_payment is not null then
    v_due := so_total(p_so_id) - so_paid(p_so_id);
    if v_due > 0.005 then
      perform record_payment(p_so_id, (p_payment->>'method')::payment_method,
                             coalesce(nullif(p_payment->>'amount', '')::numeric, v_due),
                             p_payment->>'reference', coalesce(nullif(p_payment->>'tip', '')::numeric, 0), p_payment);
    end if;
  end if;
  perform settle_invoice(v_inv);
  return v_inv;
end $$;

create or replace view v_sales_lines with (security_invoker = true) as
select sl.id as line_id, so.id as so_id, so.so_number, so.customer_id, c.name as customer_name,
       so.fulfilled_at, sl.product_id, p.sku, p.name as product_name, p.kind, p.base_unit,
       sl.qty * u.factor as qty_base,
       sl.qty * sl.unit_price as revenue,
       coalesce(sl.cost_total, 0) as cost,
       sl.qty * sl.unit_price - coalesce(sl.cost_total, 0) as margin
  from sales_order_lines sl
  join sales_orders so on so.id = sl.so_id
  join customers c on c.id = so.customer_id
  join products p on p.id = sl.product_id
  join product_units u on u.id = sl.unit_id
 where so.status in ('fulfilled','completed','invoiced');

-- ---------- Routing ----------
-- One row of app-wide settings. The Maps key is a browser key (it is sent
-- to every page that shows a map), so it is readable by all members and
-- must be locked to the app's web addresses in Google Cloud.
create table app_settings (
  id              boolean primary key default true check (id),
  google_maps_key text check (google_maps_key is null or length(google_maps_key) between 10 and 200),
  updated_at      timestamptz not null default now()
);
insert into app_settings default values;
alter table app_settings enable row level security;
create policy "members read" on app_settings for select to authenticated using (is_member());
create policy "admin update" on app_settings for update to authenticated using (has_role('admin')) with check (has_role('admin'));

-- Address -> coordinates, filled in by the browser from Google Geocoding
create table geocodes (
  address    text primary key check (length(address) between 3 and 500),
  lat        numeric not null check (lat between -90 and 90),
  lng        numeric not null check (lng between -180 and 180),
  formatted  text,
  updated_at timestamptz not null default now()
);
alter table geocodes enable row level security;
create policy "members read" on geocodes for select to authenticated using (is_member());

create function geo_key(p text) returns text language sql immutable as
$$ select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')) $$;

-- p_rows: [{ address, lat, lng, formatted }]
create function save_geocodes(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0;
begin
  if not is_member() then raise exception 'Not authorized'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into geocodes (address, lat, lng, formatted)
    values (geo_key(r->>'address'), (r->>'lat')::numeric, (r->>'lng')::numeric, nullif(r->>'formatted', ''))
    on conflict (address) do update set lat = excluded.lat, lng = excluded.lng,
      formatted = excluded.formatted, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function save_geocodes(jsonb) from public;
grant execute on function save_geocodes(jsonb) to authenticated;

-- A day's delivery order for one shop
create table route_sheets (
  id         uuid primary key default gen_random_uuid(),
  route_date date not null,
  layout_id  uuid not null references shop_layouts(id) on delete cascade,
  stops      uuid[] not null default '{}',
  mode       text not null default 'manual' check (mode in ('manual','optimized')),
  driver     text check (driver is null or length(driver) <= 80),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (route_date, layout_id)
);
alter table route_sheets enable row level security;
create policy "members read" on route_sheets for select to authenticated using (is_member());
create policy "routers insert" on route_sheets for insert to authenticated with check (has_role('orders_manager','warehouse'));
create policy "routers update" on route_sheets for update to authenticated
  using (has_role('orders_manager','warehouse')) with check (has_role('orders_manager','warehouse'));
create policy "routers delete" on route_sheets for delete to authenticated using (has_role('orders_manager','warehouse'));
