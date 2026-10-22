-- =====================================================================
-- DKaydent Wholesale — initial schema
-- Purchasing, inventory (lots / locations / movements), sales,
-- invoicing, reporting views, roles and row-level security.
--
-- Quantities are stored in each product's BASE unit (e.g. stem, each).
-- product_units holds conversions (box = 250 stems, bunch = 25 stems,
-- case = 12 each). Order lines keep the unit they were entered in.
-- =====================================================================

-- ---------- Enums ----------
create type app_role       as enum ('admin','buyer','warehouse','sales');
create type product_kind   as enum ('flower','hard_good');
create type po_status      as enum ('draft','ordered','partially_received','received','cancelled');
create type so_status      as enum ('draft','confirmed','fulfilled','invoiced','cancelled');
create type invoice_status as enum ('open','paid','void');
create type movement_kind  as enum ('receive','transfer_out','transfer_in','sale','shrink','adjust');
create type location_kind  as enum ('cooler','shelf','dock','other');
create type vendor_kind    as enum ('grower','distributor','supplier');

-- =====================================================================
-- Profiles and roles
-- =====================================================================
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       app_role not null default 'sales',
  active     boolean  not null default false,
  created_at timestamptz not null default now()
);

-- First user to sign up becomes an active admin. Everyone after that
-- starts as an inactive "sales" user until an admin activates them.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  select not exists (select 1 from profiles) into v_first;
  insert into profiles (id, email, full_name, role, active)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          case when v_first then 'admin'::app_role else 'sales'::app_role end,
          v_first);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- Admin always passes.
create function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active and (role = 'admin' or role = any(roles))
  );
$$;

-- =====================================================================
-- Catalog
-- =====================================================================
create table products (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null unique,
  name               text not null,
  kind               product_kind not null,
  category           text,
  variety            text,
  color              text,
  grade              text,
  stem_length_cm     integer,
  base_unit          text not null,
  shelf_life_days    integer,          -- default expiry when receiving
  reorder_point_base numeric not null default 0,
  active             boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now()
);

create table product_units (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name       text not null,
  factor     numeric not null check (factor > 0),   -- base units per 1 of this unit
  created_at timestamptz not null default now(),
  unique (product_id, name),
  unique (id, product_id)
);

-- Every product automatically gets its base unit (factor 1).
create function add_base_unit() returns trigger
language plpgsql as $$
begin
  insert into product_units (product_id, name, factor) values (new.id, new.base_unit, 1);
  return new;
end $$;

create trigger products_base_unit
  after insert on products
  for each row execute function add_base_unit();

-- =====================================================================
-- Parties and places
-- =====================================================================
create table vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          vendor_kind not null default 'grower',
  contact_name  text,
  email         text,
  phone         text,
  country       text,
  payment_terms text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  kind       location_kind not null default 'cooler',
  temp_c     numeric,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table price_tiers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  markup_pct numeric not null default 35,   -- fallback markup over average cost
  created_at timestamptz not null default now()
);

create table tier_prices (
  id              uuid primary key default gen_random_uuid(),
  tier_id         uuid not null references price_tiers(id) on delete cascade,
  product_unit_id uuid not null references product_units(id) on delete cascade,
  price           numeric not null check (price >= 0),
  unique (tier_id, product_unit_id)
);

create table customers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  contact_name       text,
  email              text,
  phone              text,
  address            text,
  price_tier_id      uuid references price_tiers(id) on delete set null,
  payment_terms_days integer not null default 30,
  resale_certificate text,
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- =====================================================================
-- Purchasing
-- =====================================================================
create sequence po_number_seq start 1001;

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  po_number     text not null unique default ('PO-' || nextval('po_number_seq')),
  vendor_id     uuid not null references vendors(id),
  status        po_status not null default 'draft',
  order_date    date,
  expected_date date,
  freight_cost  numeric not null default 0 check (freight_cost >= 0),
  other_cost    numeric not null default 0 check (other_cost >= 0),
  notes         text,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  po_id             uuid not null references purchase_orders(id) on delete cascade,
  product_id        uuid not null references products(id),
  unit_id           uuid not null,
  qty               numeric not null check (qty > 0),
  unit_cost         numeric not null check (unit_cost >= 0),
  qty_received_base numeric not null default 0,
  created_at        timestamptz not null default now(),
  foreign key (unit_id, product_id) references product_units(id, product_id)
);

create table receipts (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references purchase_orders(id) on delete cascade,
  received_at timestamptz not null default now(),
  received_by uuid references profiles(id) default auth.uid(),
  notes       text
);

-- =====================================================================
-- Inventory
-- =====================================================================
create sequence lot_seq start 1;

create table lots (
  id                uuid primary key default gen_random_uuid(),
  lot_code          text not null default ('L' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('lot_seq')::text, 4, '0')),
  product_id        uuid not null references products(id),
  location_id       uuid not null references locations(id),
  po_line_id        uuid references purchase_order_lines(id) on delete set null,
  receipt_id        uuid references receipts(id) on delete set null,
  received_at       timestamptz not null default now(),
  expires_at        date,
  qty_received_base numeric not null,
  qty_on_hand_base  numeric not null check (qty_on_hand_base >= 0),
  unit_cost_base    numeric not null,          -- landed cost per base unit
  created_at        timestamptz not null default now()
);
create index lots_fifo_idx on lots (product_id, received_at) where qty_on_hand_base > 0;

create table stock_movements (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid not null references lots(id),
  product_id  uuid not null references products(id),
  location_id uuid not null references locations(id),
  kind        movement_kind not null,
  qty_base    numeric not null,                -- signed: + in, - out
  reason      text,
  reference   text,
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index stock_movements_created_idx on stock_movements (created_at desc);
create index stock_movements_lot_idx on stock_movements (lot_id);

-- =====================================================================
-- Sales and invoicing
-- =====================================================================
create sequence so_number_seq start 1001;
create sequence invoice_number_seq start 1001;

create table sales_orders (
  id           uuid primary key default gen_random_uuid(),
  so_number    text not null unique default ('SO-' || nextval('so_number_seq')),
  customer_id  uuid not null references customers(id),
  status       so_status not null default 'draft',
  order_date   date not null default current_date,
  ship_date    date,
  notes        text,
  fulfilled_at timestamptz,
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table sales_order_lines (
  id         uuid primary key default gen_random_uuid(),
  so_id      uuid not null references sales_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  unit_id    uuid not null,
  qty        numeric not null check (qty > 0),
  unit_price numeric not null check (unit_price >= 0),
  cost_total numeric,                           -- set at fulfillment (FIFO)
  created_at timestamptz not null default now(),
  foreign key (unit_id, product_id) references product_units(id, product_id)
);

-- Which lots each sale line drew from (exact COGS + traceability).
create table sales_allocations (
  id             uuid primary key default gen_random_uuid(),
  so_line_id     uuid not null references sales_order_lines(id) on delete cascade,
  lot_id         uuid not null references lots(id),
  qty_base       numeric not null,
  unit_cost_base numeric not null
);

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default ('INV-' || nextval('invoice_number_seq')),
  so_id          uuid not null unique references sales_orders(id),
  customer_id    uuid not null references customers(id),
  issued_at      date not null default current_date,
  due_at         date not null,
  subtotal       numeric not null,
  tax_rate       numeric not null default 0,
  tax            numeric not null default 0,
  total          numeric not null,
  status         invoice_status not null default 'open',
  paid_at        date,
  created_at     timestamptz not null default now()
);

-- =====================================================================
-- Status guard: system-controlled statuses can only be set (or left)
-- through the functions below, never by a direct table update.
-- =====================================================================
create function guard_status() returns trigger
language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = '1';
begin
  if new.status is distinct from old.status and not v_rpc then
    if new.status::text in ('partially_received','received','fulfilled','invoiced')
       or old.status::text in ('partially_received','received','fulfilled','invoiced','cancelled') then
      raise exception 'Status cannot be changed from % to % directly', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger purchase_orders_guard before update on purchase_orders
  for each row execute function guard_status();
create trigger sales_orders_guard before update on sales_orders
  for each row execute function guard_status();

-- =====================================================================
-- Business operations (atomic, role-checked)
-- =====================================================================

-- Receive against a PO.
-- p_lines: [{ "line_id": uuid, "qty": number (in the line's unit),
--             "location_id": uuid, "expires_at": "YYYY-MM-DD"?, "lot_code": text? }]
-- Landed cost = vendor unit cost + freight/other spread by line value.
create function receive_po(p_po_id uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po       purchase_orders;
  v_line     purchase_order_lines;
  v_receipt  uuid;
  v_subtotal numeric;
  v_uplift   numeric;
  v_factor   numeric;
  v_qty_base numeric;
  v_shelf    integer;
  v_lot      uuid;
  v_loc      uuid;
  v_any      boolean := false;
  r          jsonb;
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);

  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status not in ('ordered','partially_received') then
    raise exception 'Only ordered purchase orders can be received';
  end if;

  select coalesce(sum(qty * unit_cost), 0) into v_subtotal
    from purchase_order_lines where po_id = p_po_id;
  v_uplift := case when v_subtotal > 0
                   then (v_po.freight_cost + v_po.other_cost) / v_subtotal
                   else 0 end;

  insert into receipts (po_id) values (p_po_id) returning id into v_receipt;

  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((r->>'qty')::numeric, 0) <= 0 then continue; end if;

    select * into v_line from purchase_order_lines
      where id = (r->>'line_id')::uuid and po_id = p_po_id for update;
    if not found then raise exception 'Line is not on this purchase order'; end if;

    v_loc := nullif(r->>'location_id', '')::uuid;
    if v_loc is null then raise exception 'Choose a location for every received line'; end if;

    select factor into v_factor from product_units where id = v_line.unit_id;
    select shelf_life_days into v_shelf from products where id = v_line.product_id;
    v_qty_base := (r->>'qty')::numeric * v_factor;

    insert into lots (lot_code, product_id, location_id, po_line_id, receipt_id,
                      expires_at, qty_received_base, qty_on_hand_base, unit_cost_base)
    values (
      coalesce(nullif(r->>'lot_code', ''), 'L' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('lot_seq')::text, 4, '0')),
      v_line.product_id, v_loc, v_line.id, v_receipt,
      coalesce(nullif(r->>'expires_at', '')::date,
               case when v_shelf is not null then current_date + v_shelf end),
      v_qty_base, v_qty_base,
      (v_line.unit_cost / v_factor) * (1 + v_uplift))
    returning id into v_lot;

    insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reference)
    values (v_lot, v_line.product_id, v_loc, 'receive', v_qty_base, v_po.po_number);

    update purchase_order_lines
       set qty_received_base = qty_received_base + v_qty_base
     where id = v_line.id;
    v_any := true;
  end loop;

  if not v_any then raise exception 'Enter a quantity for at least one line'; end if;

  update purchase_orders
     set status = case when exists (
           select 1 from purchase_order_lines l
             join product_units u on u.id = l.unit_id
            where l.po_id = p_po_id and l.qty_received_base < l.qty * u.factor)
         then 'partially_received'::po_status else 'received'::po_status end
   where id = p_po_id;

  return v_receipt;
end $$;

-- Close out a partially received PO (vendor shorted the rest).
create function close_po(p_po_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  update purchase_orders set status = 'received'
   where id = p_po_id and status = 'partially_received';
  if not found then raise exception 'Only partially received purchase orders can be closed'; end if;
end $$;

-- Move some or all of a lot to another location. Returns the lot id at the destination.
create function transfer_stock(p_lot_id uuid, p_qty_base numeric, p_to_location uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lot lots; v_new uuid;
begin
  if not has_role('warehouse') then raise exception 'Not authorized'; end if;
  select * into v_lot from lots where id = p_lot_id for update;
  if not found then raise exception 'Lot not found'; end if;
  if p_to_location is null then raise exception 'Choose a destination'; end if;
  if p_to_location = v_lot.location_id then raise exception 'Lot is already in that location'; end if;
  if p_qty_base is null or p_qty_base <= 0 or p_qty_base > v_lot.qty_on_hand_base then
    raise exception 'Quantity must be more than 0 and no more than %', v_lot.qty_on_hand_base;
  end if;

  if p_qty_base = v_lot.qty_on_hand_base then
    update lots set location_id = p_to_location where id = p_lot_id;
    v_new := p_lot_id;
  else
    update lots set qty_on_hand_base = qty_on_hand_base - p_qty_base where id = p_lot_id;
    insert into lots (lot_code, product_id, location_id, po_line_id, receipt_id, received_at,
                      expires_at, qty_received_base, qty_on_hand_base, unit_cost_base)
    values (v_lot.lot_code || '-S', v_lot.product_id, p_to_location, v_lot.po_line_id, v_lot.receipt_id,
            v_lot.received_at, v_lot.expires_at, p_qty_base, p_qty_base, v_lot.unit_cost_base)
    returning id into v_new;
  end if;

  insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reference)
  values (p_lot_id, v_lot.product_id, v_lot.location_id, 'transfer_out', -p_qty_base, v_lot.lot_code),
         (v_new,    v_lot.product_id, p_to_location,     'transfer_in',   p_qty_base, v_lot.lot_code);
  return v_new;
end $$;

-- Record spoilage / damage / dump.
create function record_shrink(p_lot_id uuid, p_qty_base numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_lot lots;
begin
  if not has_role('warehouse') then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into v_lot from lots where id = p_lot_id for update;
  if not found then raise exception 'Lot not found'; end if;
  if p_qty_base is null or p_qty_base <= 0 or p_qty_base > v_lot.qty_on_hand_base then
    raise exception 'Quantity must be more than 0 and no more than %', v_lot.qty_on_hand_base;
  end if;
  update lots set qty_on_hand_base = qty_on_hand_base - p_qty_base where id = p_lot_id;
  insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
  values (p_lot_id, v_lot.product_id, v_lot.location_id, 'shrink', -p_qty_base, p_reason, v_lot.lot_code);
end $$;

-- Cycle count: set a lot to the counted quantity.
create function adjust_lot(p_lot_id uuid, p_counted_base numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_lot lots; v_delta numeric;
begin
  if not has_role('warehouse') then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_counted_base is null or p_counted_base < 0 then raise exception 'Counted quantity cannot be negative'; end if;
  select * into v_lot from lots where id = p_lot_id for update;
  if not found then raise exception 'Lot not found'; end if;
  v_delta := p_counted_base - v_lot.qty_on_hand_base;
  if v_delta = 0 then return; end if;
  update lots set qty_on_hand_base = p_counted_base where id = p_lot_id;
  insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
  values (p_lot_id, v_lot.product_id, v_lot.location_id, 'adjust', v_delta, p_reason, v_lot.lot_code);
end $$;

-- Pull stock for a confirmed order, oldest lots first (FIFO). All-or-nothing.
create function fulfill_sales_order(p_so_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_so     sales_orders;
  v_line   record;
  v_lot    lots;
  v_need   numeric;
  v_take   numeric;
  v_cost   numeric;
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
    update sales_order_lines set cost_total = v_cost where id = v_line.id;
  end loop;

  update sales_orders set status = 'fulfilled', fulfilled_at = now() where id = p_so_id;
end $$;

-- Invoice a fulfilled order. p_tax_rate is a percent (e.g. 7 for 7%).
create function create_invoice(p_so_id uuid, p_tax_rate numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_terms integer; v_sub numeric; v_tax numeric; v_id uuid;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'fulfilled' then raise exception 'Only fulfilled orders can be invoiced'; end if;

  select payment_terms_days into v_terms from customers where id = v_so.customer_id;
  select round(coalesce(sum(qty * unit_price), 0), 2) into v_sub from sales_order_lines where so_id = p_so_id;
  v_tax := round(v_sub * coalesce(p_tax_rate, 0) / 100, 2);

  insert into invoices (so_id, customer_id, due_at, subtotal, tax_rate, tax, total)
  values (p_so_id, v_so.customer_id, current_date + coalesce(v_terms, 30), v_sub, coalesce(p_tax_rate, 0), v_tax, v_sub + v_tax)
  returning id into v_id;

  update sales_orders set status = 'invoiced' where id = p_so_id;
  return v_id;
end $$;

revoke execute on function receive_po(uuid, jsonb), close_po(uuid), transfer_stock(uuid, numeric, uuid),
  record_shrink(uuid, numeric, text), adjust_lot(uuid, numeric, text),
  fulfill_sales_order(uuid), create_invoice(uuid, numeric) from public;
grant execute on function receive_po(uuid, jsonb), close_po(uuid), transfer_stock(uuid, numeric, uuid),
  record_shrink(uuid, numeric, text), adjust_lot(uuid, numeric, text),
  fulfill_sales_order(uuid), create_invoice(uuid, numeric) to authenticated;

-- =====================================================================
-- Reporting views (respect RLS of the caller)
-- =====================================================================
create view v_lot_aging with (security_invoker = true) as
select l.id as lot_id, l.lot_code, l.product_id, p.sku, p.name as product_name, p.kind, p.base_unit,
       l.location_id, loc.name as location_name, l.received_at, l.expires_at,
       l.qty_on_hand_base, l.unit_cost_base,
       l.qty_on_hand_base * l.unit_cost_base as value,
       (current_date - l.received_at::date) as age_days,
       (l.expires_at - current_date) as days_to_expiry
  from lots l
  join products p on p.id = l.product_id
  join locations loc on loc.id = l.location_id
 where l.qty_on_hand_base > 0;

create view v_product_stock with (security_invoker = true) as
select p.id as product_id, p.sku, p.name, p.kind, p.category, p.base_unit,
       p.reorder_point_base, p.active,
       coalesce(sum(l.qty_on_hand_base), 0) as qty_on_hand_base,
       coalesce(sum(l.qty_on_hand_base * l.unit_cost_base), 0) as value,
       case when sum(l.qty_on_hand_base) > 0
            then sum(l.qty_on_hand_base * l.unit_cost_base) / sum(l.qty_on_hand_base) end as avg_cost_base,
       min(l.received_at) as oldest_received_at
  from products p
  left join lots l on l.product_id = p.id and l.qty_on_hand_base > 0
 group by p.id;

create view v_sales_lines with (security_invoker = true) as
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
 where so.status in ('fulfilled','invoiced');

create view v_shrink with (security_invoker = true) as
select m.id, m.created_at, m.product_id, p.sku, p.name as product_name, p.kind, p.base_unit,
       m.location_id, m.lot_id, -m.qty_base as qty_base,
       -m.qty_base * l.unit_cost_base as value, m.reason
  from stock_movements m
  join lots l on l.id = m.lot_id
  join products p on p.id = m.product_id
 where m.kind = 'shrink';

-- =====================================================================
-- Row-level security
-- Everyone active can read. Writes are by role; stock-changing
-- tables (receipts, lots, movements, allocations) are written only
-- by the functions above.
-- =====================================================================
alter table profiles             enable row level security;
alter table products             enable row level security;
alter table product_units        enable row level security;
alter table vendors              enable row level security;
alter table locations            enable row level security;
alter table price_tiers          enable row level security;
alter table tier_prices          enable row level security;
alter table customers            enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_lines enable row level security;
alter table receipts             enable row level security;
alter table lots                 enable row level security;
alter table stock_movements      enable row level security;
alter table sales_orders         enable row level security;
alter table sales_order_lines    enable row level security;
alter table sales_allocations    enable row level security;
alter table invoices             enable row level security;

-- Profiles
create policy "read own or members" on profiles for select to authenticated
  using (id = auth.uid() or is_member());
create policy "admins update" on profiles for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- Read access for all active members
create policy "members read" on products             for select to authenticated using (is_member());
create policy "members read" on product_units        for select to authenticated using (is_member());
create policy "members read" on vendors              for select to authenticated using (is_member());
create policy "members read" on locations            for select to authenticated using (is_member());
create policy "members read" on price_tiers          for select to authenticated using (is_member());
create policy "members read" on tier_prices          for select to authenticated using (is_member());
create policy "members read" on customers            for select to authenticated using (is_member());
create policy "members read" on purchase_orders      for select to authenticated using (is_member());
create policy "members read" on purchase_order_lines for select to authenticated using (is_member());
create policy "members read" on receipts             for select to authenticated using (is_member());
create policy "members read" on lots                 for select to authenticated using (is_member());
create policy "members read" on stock_movements      for select to authenticated using (is_member());
create policy "members read" on sales_orders         for select to authenticated using (is_member());
create policy "members read" on sales_order_lines    for select to authenticated using (is_member());
create policy "members read" on sales_allocations    for select to authenticated using (is_member());
create policy "members read" on invoices             for select to authenticated using (is_member());

-- Buyers: catalog, vendors, purchasing
create policy "buyers insert" on products for insert to authenticated with check (has_role('buyer'));
create policy "buyers update" on products for update to authenticated using (has_role('buyer')) with check (has_role('buyer'));

create policy "buyers insert" on product_units for insert to authenticated with check (has_role('buyer'));
create policy "buyers delete" on product_units for delete to authenticated
  using (has_role('buyer') and name <> (select base_unit from products where id = product_id));

create policy "buyers insert" on vendors for insert to authenticated with check (has_role('buyer'));
create policy "buyers update" on vendors for update to authenticated using (has_role('buyer')) with check (has_role('buyer'));

create policy "buyers insert" on purchase_orders for insert to authenticated with check (has_role('buyer'));
create policy "buyers update" on purchase_orders for update to authenticated using (has_role('buyer')) with check (has_role('buyer'));
create policy "buyers delete drafts" on purchase_orders for delete to authenticated
  using (has_role('buyer') and status = 'draft');

create policy "buyers edit draft lines" on purchase_order_lines for all to authenticated
  using (has_role('buyer') and exists (select 1 from purchase_orders po where po.id = po_id and po.status = 'draft'))
  with check (has_role('buyer') and exists (select 1 from purchase_orders po where po.id = po_id and po.status = 'draft'));

-- Warehouse: locations
create policy "warehouse insert" on locations for insert to authenticated with check (has_role('warehouse'));
create policy "warehouse update" on locations for update to authenticated using (has_role('warehouse')) with check (has_role('warehouse'));

-- Sales: customers, pricing, orders, invoices
create policy "sales insert" on customers for insert to authenticated with check (has_role('sales'));
create policy "sales update" on customers for update to authenticated using (has_role('sales')) with check (has_role('sales'));

create policy "sales insert" on price_tiers for insert to authenticated with check (has_role('sales'));
create policy "sales update" on price_tiers for update to authenticated using (has_role('sales')) with check (has_role('sales'));

create policy "sales write" on tier_prices for all to authenticated
  using (has_role('sales')) with check (has_role('sales'));

create policy "sales insert" on sales_orders for insert to authenticated with check (has_role('sales'));
create policy "sales update" on sales_orders for update to authenticated using (has_role('sales')) with check (has_role('sales'));
create policy "sales delete drafts" on sales_orders for delete to authenticated
  using (has_role('sales') and status = 'draft');

create policy "sales edit draft lines" on sales_order_lines for all to authenticated
  using (has_role('sales') and exists (select 1 from sales_orders so where so.id = so_id and so.status = 'draft'))
  with check (has_role('sales') and exists (select 1 from sales_orders so where so.id = so_id and so.status = 'draft'));

create policy "sales update" on invoices for update to authenticated
  using (has_role('sales')) with check (has_role('sales'));
