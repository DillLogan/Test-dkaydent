-- Customer account fields, payment type on orders, cash discount, denied orders.
--   route_code        1-3 letters, set by sales, groups deliveries
--   rep_id            the sales rep who looks after this customer
--   default_payment   cash | card | check, pre-filled on each order (null = ask every time)
--   discount_pct      the sales discount (already exists): off every price
--   cash_discount_pct a second, separate discount that only applies to cash orders
alter table customers
  add column route_code        text check (route_code ~ '^[A-Z]{1,3}$'),
  add column rep_id            uuid references profiles(id) on delete set null,
  add column default_payment   text check (default_payment in ('cash', 'card', 'check')),
  add column cash_discount_pct numeric not null default 0 check (cash_discount_pct between 0 and 100);

create function customers_route_upper() returns trigger
language plpgsql as $$
begin
  new.route_code := nullif(upper(trim(coalesce(new.route_code, ''))), '');
  return new;
end $$;
create trigger customers_route_upper before insert or update on customers
  for each row execute function customers_route_upper();

alter table sales_orders
  add column payment_type  text check (payment_type in ('cash', 'card', 'check')),
  add column denied_reason text,
  add column denied_by     uuid references profiles(id);

-- A login can only be verified once the account is complete
create or replace function portal_set_up(p_profile_id uuid, p_customer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_p profiles; v_c customers; v_missing text;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can set up customer logins'; end if;
  select * into v_p from profiles where id = p_profile_id for update;
  if not found then raise exception 'That person does not exist'; end if;
  if v_p.active and v_p.role <> 'customer' then raise exception 'That person already has staff access'; end if;
  select * into v_c from customers where id = p_customer_id and active;
  if not found then raise exception 'Pick a customer'; end if;
  v_missing := concat_ws(', ',
    case when coalesce(trim(v_c.name), '') = '' then 'name' end,
    case when v_c.route_code is null then 'route' end,
    case when coalesce(trim(v_c.address), '') = '' then 'address' end,
    case when coalesce(trim(v_c.phone), '') = '' then 'phone' end,
    case when v_c.rep_id is null then 'sales rep' end);
  if v_missing <> '' then raise exception 'Finish the customer account first. Missing: %', v_missing; end if;
  perform set_config('app.via_rpc', '1', true);
  update profiles set role = 'customer', active = false where id = p_profile_id;
  insert into portal_accounts (profile_id, customer_id, set_up_by) values (p_profile_id, p_customer_id, auth.uid())
    on conflict (profile_id) do update
      set customer_id = excluded.customer_id, set_up_by = excluded.set_up_by, set_up_at = now(),
          verified_by = null, verified_at = null;
end $$;

-- What a customer sees about themselves
create or replace function portal_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := portal_customer_id();
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  return (select jsonb_build_object('customer_id', c.id, 'name', c.name, 'discount_pct', c.discount_pct,
                                    'cash_discount_pct', c.cash_discount_pct, 'default_payment', c.default_payment,
                                    'route_code', c.route_code, 'address', c.address, 'phone', c.phone,
                                    'rep', (select coalesce(p.full_name, p.email) from profiles p where p.id = c.rep_id),
                                    'terms_days', c.payment_terms_days) from customers c where c.id = v_c);
end $$;

-- Order history with items, so a customer can see what they ordered and order it again
create or replace function portal_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := portal_customer_id();
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('so_number', so.so_number, 'status', so.status, 'order_date', so.order_date,
             'ship_date', so.ship_date, 'source', so.source, 'payment_type', so.payment_type,
             'denied_reason', so.denied_reason,
             'total', (select coalesce(sum(qty * unit_price), 0) from sales_order_lines where so_id = so.id),
             'lines', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', l.unit_id, 'name', p.name, 'unit', u.name,
                                                                    'qty', l.qty, 'unit_price', l.unit_price) order by l.created_at), '[]'::jsonb)
                         from sales_order_lines l join products p on p.id = l.product_id join product_units u on u.id = l.unit_id
                        where l.so_id = so.id)) order by so.created_at desc)
    from (select * from sales_orders where customer_id = v_c order by created_at desc limit 50) so), '[]'::jsonb);
end $$;

-- Carts: same as before, plus the payment type and the cash discount
drop function if exists portal_checkout(jsonb, text);
drop function if exists catalog_checkout(uuid, jsonb, text);
drop function if exists cart_to_order(uuid, jsonb, text, text, boolean);

create function cart_to_order(p_customer_id uuid, p_lines jsonb, p_notes text, p_source text, p_check_stock boolean, p_payment text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so uuid; ln jsonb; v_unit uuid; v_qty numeric; v_prod uuid; v_price numeric; v_bad text;
        v_pay text; v_cash numeric := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The cart is empty';
  end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'Too many lines in one order'; end if;
  select coalesce(p_payment, default_payment), cash_discount_pct into v_pay, v_cash from customers where id = p_customer_id;
  if p_source = 'portal' and v_pay is null then raise exception 'Choose how you will pay: cash, card or check'; end if;
  if v_pay is not null and v_pay not in ('cash', 'card', 'check') then raise exception 'Payment must be cash, card or check'; end if;
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
  insert into sales_orders (customer_id, status, notes, source, payment_type, created_by)
    values (p_customer_id, 'draft', nullif(left(trim(coalesce(p_notes, '')), 500), ''), p_source, v_pay, auth.uid())
    returning id into v_so;
  for ln in select value from jsonb_array_elements(p_lines) loop
    v_unit := (ln->>'unit_id')::uuid; v_qty := (ln->>'qty')::numeric;
    select product_id into v_prod from product_units where id = v_unit;
    v_price := customer_unit_price(p_customer_id, v_unit);
    if v_pay = 'cash' and v_cash > 0 then v_price := round(v_price * (1 - v_cash / 100), 2); end if;
    insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
      values (v_so, v_prod, v_unit, v_qty, coalesce(v_price, 0));
  end loop;
  return v_so;
end $$;
revoke all on function cart_to_order(uuid, jsonb, text, text, boolean, text) from public, anon, authenticated;

create function portal_checkout(p_lines jsonb, p_notes text, p_payment text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c uuid := portal_customer_id();
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  return cart_to_order(v_c, p_lines, p_notes, 'portal', true, p_payment);
end $$;

create function catalog_checkout(p_customer_id uuid, p_lines jsonb, p_notes text, p_payment text default null) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can build an order'; end if;
  if not exists (select 1 from customers where id = p_customer_id and active) then raise exception 'Pick a customer'; end if;
  return cart_to_order(p_customer_id, p_lines, p_notes, 'app', false, p_payment);
end $$;

revoke execute on function portal_checkout(jsonb, text, text) from public, anon;
grant execute on function portal_checkout(jsonb, text, text) to authenticated;
revoke execute on function catalog_checkout(uuid, jsonb, text, text) from public, anon;
grant execute on function catalog_checkout(uuid, jsonb, text, text) to authenticated;

-- Sales: open customer orders waiting for a decision (approve with a normal confirm, or deny here)
create function deny_order(p_so_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can deny an order'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason so the customer knows why'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'draft' then raise exception 'Only orders that are still drafts can be denied'; end if;
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set status = 'cancelled', denied_reason = left(trim(p_reason), 300), denied_by = auth.uid() where id = p_so_id;
end $$;
revoke execute on function deny_order(uuid, text) from public, anon;
grant execute on function deny_order(uuid, text) to authenticated;
