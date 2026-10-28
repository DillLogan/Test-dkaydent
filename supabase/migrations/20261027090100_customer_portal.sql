-- =====================================================================
-- Customer shopping login ("customer" role)
--  * a customer sees only their own prices, through functions; direct table access is closed
--  * a login is set up by one sales/admin person and verified by a different one
--  * carts become draft orders for sales to approve
-- =====================================================================

-- Customers are not "members": every read policy built on is_member() now excludes them.
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role <> 'customer');
$$;

alter table customers add column discount_pct numeric not null default 0 check (discount_pct >= 0 and discount_pct <= 100);
-- sales_orders.source already exists ('app' | 'web'); add 'portal' for customer carts.
alter table sales_orders drop constraint if exists sales_orders_source_check;
alter table sales_orders add constraint sales_orders_source_check check (source in ('app', 'web', 'portal'));

-- Special price for one customer and one unit (replaces tier price and discount)
create table customer_prices (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  product_unit_id uuid not null references product_units(id) on delete cascade,
  price           numeric not null check (price >= 0),
  set_by          uuid references profiles(id) default auth.uid(),
  updated_at      timestamptz not null default now(),
  unique (customer_id, product_unit_id)
);
alter table customer_prices enable row level security;
create policy "members read" on customer_prices for select to authenticated using (is_member());
create policy "sales write" on customer_prices for all to authenticated
  using (has_role('sales')) with check (has_role('sales'));

-- Which login belongs to which customer, and who set it up / verified it
create table portal_accounts (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  set_up_by   uuid not null references profiles(id),
  set_up_at   timestamptz not null default now(),
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  check (verified_by is null or verified_by <> set_up_by)
);
alter table portal_accounts enable row level security;
create policy "sales read" on portal_accounts for select to authenticated using (has_role('sales'));

-- Only the functions below may make someone a customer or switch a customer on
create function guard_customer_profile() returns trigger
language plpgsql as $$
begin
  if new.role = 'customer'
     and (old.role is distinct from 'customer' or (new.active and not old.active))
     and coalesce(current_setting('app.via_rpc', true), '') <> '1' then
    raise exception 'Customer logins are set up and verified on the Customer logins page';
  end if;
  return new;
end $$;
create trigger profiles_customer_guard before update on profiles
  for each row execute function guard_customer_profile();

-- ---------------------------------------------------------------------
-- Pricing: special price, else the tier/cost price less the customer's discount
-- ---------------------------------------------------------------------
create function portal_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select pa.customer_id from portal_accounts pa join profiles p on p.id = pa.profile_id
   where p.id = auth.uid() and p.active and p.role = 'customer' and pa.verified_by is not null
$$;

create function customer_list_price(p_customer_id uuid, p_unit_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  with u as (select id, product_id, factor from product_units where id = p_unit_id),
       c as (select price_tier_id from customers where id = p_customer_id),
       t as (select pt.id, pt.markup_pct from price_tiers pt, c where pt.id = c.price_tier_id),
       cost as (
         select coalesce(
           (select sum(l.qty_on_hand_base * l.unit_cost_base) / nullif(sum(l.qty_on_hand_base), 0)
              from lots l, u where l.product_id = u.product_id and l.qty_on_hand_base > 0),
           (select l.unit_cost_base from lots l, u where l.product_id = u.product_id order by l.received_at desc limit 1)) as base)
  select coalesce(
    (select tp.price from tier_prices tp, t where tp.tier_id = t.id and tp.product_unit_id = p_unit_id),
    round((select base from cost) * (select factor from u) * (1 + coalesce((select markup_pct from t), 35) / 100), 2),
    0)
$$;
revoke all on function customer_list_price(uuid, uuid) from public, anon, authenticated;

create or replace function customer_unit_price(p_customer_id uuid, p_unit_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case
    -- a customer login can only ask about itself
    when exists (select 1 from profiles where id = auth.uid() and role = 'customer')
         and p_customer_id is distinct from portal_customer_id() then null
    else coalesce(
      (select cp.price from customer_prices cp where cp.customer_id = p_customer_id and cp.product_unit_id = p_unit_id),
      round(customer_list_price(p_customer_id, p_unit_id)
            * (1 - coalesce((select discount_pct from customers where id = p_customer_id), 0) / 100), 2))
  end
$$;

-- Stock a customer may order: on hand less what is already on orders waiting to be pulled
create function product_available_base(p_product_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0,
    coalesce((select sum(qty_on_hand_base) from lots where product_id = p_product_id), 0)
    - coalesce((select sum(sol.qty * u.factor)
                  from sales_order_lines sol
                  join sales_orders so on so.id = sol.so_id and so.status = 'confirmed'
                  join product_units u on u.id = sol.unit_id
                 where sol.product_id = p_product_id), 0))
$$;
revoke all on function product_available_base(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- What a customer sees
-- ---------------------------------------------------------------------
create function portal_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := portal_customer_id();
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  return (select jsonb_build_object('customer_id', c.id, 'name', c.name, 'discount_pct', c.discount_pct,
                                    'terms_days', c.payment_terms_days) from customers c where c.id = v_c);
end $$;

create function portal_catalog() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := portal_customer_id(); v_disc numeric;
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  select discount_pct into v_disc from customers where id = v_c;
  return coalesce((
    select jsonb_agg(r order by r->>'category', r->>'name', (r->>'factor')::numeric)
    from (
      select jsonb_build_object(
        'unit_id', u.id, 'product_id', p.id, 'sku', p.sku, 'name', p.name, 'kind', p.kind,
        'category', coalesce(p.category, 'Other'), 'unit', u.name, 'factor', u.factor,
        'price', customer_unit_price(v_c, u.id),
        'list_price', customer_list_price(v_c, u.id),
        'special', exists (select 1 from customer_prices cp where cp.customer_id = v_c and cp.product_unit_id = u.id),
        'discount_pct', v_disc,
        'available', floor(product_available_base(p.id) / u.factor)) as r
      from products p join product_units u on u.product_id = p.id
      where p.active and customer_unit_price(v_c, u.id) > 0
    ) s), '[]'::jsonb);
end $$;

create function portal_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := portal_customer_id();
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('so_number', so.so_number, 'status', so.status, 'order_date', so.order_date,
             'ship_date', so.ship_date, 'source', so.source,
             'total', (select coalesce(sum(qty * unit_price), 0) from sales_order_lines where so_id = so.id)) order by so.created_at desc)
    from (select * from sales_orders where customer_id = v_c order by created_at desc limit 50) so), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Carts become draft orders. Prices are always worked out here, never trusted from the browser.
-- ---------------------------------------------------------------------
create function cart_to_order(p_customer_id uuid, p_lines jsonb, p_notes text, p_source text, p_check_stock boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so uuid; ln jsonb; v_unit uuid; v_qty numeric; v_prod uuid; v_price numeric; v_bad text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The cart is empty';
  end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'Too many lines in one order'; end if;
  for ln in select value from jsonb_array_elements(p_lines) loop
    v_qty := (ln->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Quantities must be more than 0'; end if;
    if not exists (select 1 from product_units u join products p on p.id = u.product_id
                    where u.id = (ln->>'unit_id')::uuid and p.active) then
      raise exception 'An item in the cart is no longer sold';
    end if;
  end loop;
  if p_check_stock then
    select string_agg(x.name, ', ') into v_bad from (
      select p.name from (
        select u.product_id, sum((j.value->>'qty')::numeric * u.factor) as need
          from jsonb_array_elements(p_lines) j join product_units u on u.id = (j.value->>'unit_id')::uuid
         group by u.product_id) n
      join products p on p.id = n.product_id
      where n.need > product_available_base(n.product_id)) x;
    if v_bad is not null then raise exception 'Not enough in stock: %', v_bad; end if;
  end if;
  perform set_config('app.via_rpc', '1', true);
  insert into sales_orders (customer_id, status, notes, source, created_by)
    values (p_customer_id, 'draft', nullif(left(trim(coalesce(p_notes, '')), 500), ''), p_source, auth.uid())
    returning id into v_so;
  for ln in select value from jsonb_array_elements(p_lines) loop
    v_unit := (ln->>'unit_id')::uuid; v_qty := (ln->>'qty')::numeric;
    select product_id into v_prod from product_units where id = v_unit;
    v_price := customer_unit_price(p_customer_id, v_unit);
    insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
      values (v_so, v_prod, v_unit, v_qty, coalesce(v_price, 0));
  end loop;
  return v_so;
end $$;
revoke all on function cart_to_order(uuid, jsonb, text, text, boolean) from public, anon, authenticated;

create function portal_checkout(p_lines jsonb, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c uuid := portal_customer_id();
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  return cart_to_order(v_c, p_lines, p_notes, 'portal', true);
end $$;

create function catalog_checkout(p_customer_id uuid, p_lines jsonb, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can build an order'; end if;
  if not exists (select 1 from customers where id = p_customer_id and active) then raise exception 'Pick a customer'; end if;
  return cart_to_order(p_customer_id, p_lines, p_notes, 'app', false);
end $$;

-- ---------------------------------------------------------------------
-- Customer logins: set up by one person, verified by a different one
-- ---------------------------------------------------------------------
create function portal_set_up(p_profile_id uuid, p_customer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can set up customer logins'; end if;
  select * into v_p from profiles where id = p_profile_id for update;
  if not found then raise exception 'That person does not exist'; end if;
  if v_p.active and v_p.role <> 'customer' then raise exception 'That person already has staff access'; end if;
  if not exists (select 1 from customers where id = p_customer_id and active) then raise exception 'Pick a customer'; end if;
  perform set_config('app.via_rpc', '1', true);
  update profiles set role = 'customer', active = false where id = p_profile_id;
  insert into portal_accounts (profile_id, customer_id, set_up_by) values (p_profile_id, p_customer_id, auth.uid())
    on conflict (profile_id) do update
      set customer_id = excluded.customer_id, set_up_by = excluded.set_up_by, set_up_at = now(),
          verified_by = null, verified_at = null;
end $$;

create function portal_verify(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_a portal_accounts;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can verify customer logins'; end if;
  select * into v_a from portal_accounts where profile_id = p_profile_id for update;
  if not found then raise exception 'That login has not been set up'; end if;
  if v_a.verified_by is not null then raise exception 'That login is already verified'; end if;
  if v_a.set_up_by = auth.uid() then raise exception 'A different person must verify this login'; end if;
  perform set_config('app.via_rpc', '1', true);
  update portal_accounts set verified_by = auth.uid(), verified_at = now() where profile_id = p_profile_id;
  update profiles set active = true where id = p_profile_id;
end $$;

create function portal_remove(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can remove customer logins'; end if;
  perform set_config('app.via_rpc', '1', true);
  update profiles set active = false where id = p_profile_id and role = 'customer';
  delete from portal_accounts where profile_id = p_profile_id;
end $$;

-- ---------------------------------------------------------------------
-- Close the helper functions a customer login could otherwise call
-- ---------------------------------------------------------------------
create or replace function so_total(p_so_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from profiles where id = auth.uid() and role = 'customer') then null else
    coalesce(
      (select total from invoices where so_id = p_so_id and status <> 'void' limit 1),
      (select round(coalesce(sum(qty * unit_price), 0), 2) from sales_order_lines where so_id = p_so_id)) end
$$;
create or replace function so_paid(p_so_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from profiles where id = auth.uid() and role = 'customer') then null else
    coalesce((select sum(amount) from payments where so_id = p_so_id and status = 'completed'), 0) end
$$;
revoke all on function settle_invoice(uuid), walk_in_customer() from public, anon, authenticated;
