-- =====================================================================
-- Customer carts saved on the account (like Amazon or eBay): the first Add makes the cart, it follows the login
-- to any device, and it stays until the order is placed. Items can be saved for later.
-- No stock is held; adding more than is available is refused with how many are left.
-- Prices always come from the server (customer_unit_price); placing the order goes through cart_to_order.
-- =====================================================================
create table portal_carts (
  profile_id uuid primary key references profiles(id) on delete cascade,
  payment    text check (payment is null or payment in ('cash', 'card', 'check')),
  notes      text check (notes is null or length(notes) <= 500),
  updated_at timestamptz not null default now()
);
create table portal_cart_items (
  profile_id      uuid not null references profiles(id) on delete cascade,
  unit_id         uuid not null references product_units(id) on delete cascade,
  qty             numeric not null check (qty > 0 and qty <= 100000),
  saved_for_later boolean not null default false,
  added_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (profile_id, unit_id)
);
alter table portal_carts enable row level security;
alter table portal_cart_items enable row level security;
-- a customer reads only their own cart; changes go through the functions below
create policy "own cart" on portal_carts for select to authenticated using (profile_id = auth.uid());
create policy "own cart items" on portal_cart_items for select to authenticated using (profile_id = auth.uid());

-- Set how many of one item are in the cart (0 takes it out). Refuses more than is available.
create function portal_cart_set(p_unit_id uuid, p_qty numeric, p_saved boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c uuid := portal_customer_id(); v_prod uuid; v_factor numeric; v_name text; v_left numeric; v_unit text; v_saved boolean;
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  select u.product_id, u.factor, p.name, u.name into v_prod, v_factor, v_name, v_unit
    from product_units u join products p on p.id = u.product_id where u.id = p_unit_id and p.active;
  if not found or customer_unit_price(v_c, p_unit_id) <= 0 then raise exception 'That item is not sold to you any more'; end if;
  if p_qty is null or p_qty <= 0 then
    delete from portal_cart_items where profile_id = auth.uid() and unit_id = p_unit_id;
  else
    if p_qty <> floor(p_qty) or p_qty > 100000 then raise exception 'Quantities are whole numbers'; end if;
    select coalesce(p_saved, (select saved_for_later from portal_cart_items where profile_id = auth.uid() and unit_id = p_unit_id), false) into v_saved;
    v_left := floor(product_available_base(v_prod) / v_factor);
    if not v_saved and p_qty > v_left then
      raise exception 'Only % % of % left', greatest(v_left, 0), v_unit, v_name;
    end if;
    insert into portal_carts (profile_id) values (auth.uid()) on conflict (profile_id) do update set updated_at = now();
    insert into portal_cart_items (profile_id, unit_id, qty, saved_for_later) values (auth.uid(), p_unit_id, p_qty, v_saved)
    on conflict (profile_id, unit_id) do update set qty = excluded.qty, saved_for_later = excluded.saved_for_later, updated_at = now();
  end if;
  return jsonb_build_object('unit_id', p_unit_id, 'qty', greatest(coalesce(p_qty, 0), 0), 'available', v_left);
end $$;

-- Payment choice and notes for the order, kept with the cart.
create function portal_cart_details(p_payment text, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if portal_customer_id() is null then raise exception 'This login is not set up for shopping yet'; end if;
  if p_payment is not null and p_payment not in ('cash', 'card', 'check') then raise exception 'Payment must be cash, card or check'; end if;
  insert into portal_carts (profile_id, payment, notes) values (auth.uid(), p_payment, nullif(left(trim(coalesce(p_notes, '')), 500), ''))
  on conflict (profile_id) do update set payment = excluded.payment, notes = excluded.notes, updated_at = now();
end $$;

-- Place the order from the saved cart (items saved for later stay behind), then empty the cart.
create function portal_cart_checkout() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c uuid := portal_customer_id(); v_lines jsonb; v_cart portal_carts; v_so uuid;
begin
  if v_c is null then raise exception 'This login is not set up for shopping yet'; end if;
  select * into v_cart from portal_carts where profile_id = auth.uid();
  select jsonb_agg(jsonb_build_object('unit_id', unit_id, 'qty', qty) order by added_at) into v_lines
    from portal_cart_items where profile_id = auth.uid() and not saved_for_later;
  if v_lines is null then raise exception 'The cart is empty'; end if;
  v_so := cart_to_order(v_c, v_lines, v_cart.notes, 'portal', true, v_cart.payment);
  delete from portal_cart_items where profile_id = auth.uid() and not saved_for_later;
  update portal_carts set notes = null, updated_at = now() where profile_id = auth.uid();
  return v_so;
end $$;

revoke execute on function portal_cart_set(uuid, numeric, boolean), portal_cart_details(text, text), portal_cart_checkout() from public, anon;
grant execute on function portal_cart_set(uuid, numeric, boolean), portal_cart_details(text, text), portal_cart_checkout() to authenticated;

-- =====================================================================
-- Rep's customer page: a rep (sales or admin) shops for a customer who calls or walks in.
-- Each rep has their own saved cart per customer; the customer's online cart can be pulled in.
-- Placing it makes the order under the customer, already approved (Ready to pull).
-- =====================================================================
create table rep_carts (
  rep_id      uuid not null references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  payment     text check (payment is null or payment in ('cash', 'card', 'check')),
  notes       text check (notes is null or length(notes) <= 500),
  updated_at  timestamptz not null default now(),
  primary key (rep_id, customer_id)
);
create table rep_cart_items (
  rep_id          uuid not null references profiles(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  unit_id         uuid not null references product_units(id) on delete cascade,
  qty             numeric not null check (qty > 0 and qty <= 100000),
  saved_for_later boolean not null default false,
  added_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (rep_id, customer_id, unit_id)
);
alter table rep_carts enable row level security;
alter table rep_cart_items enable row level security;
create policy "own rep cart" on rep_carts for select to authenticated using (rep_id = auth.uid() and has_role('sales'));
create policy "own rep cart items" on rep_cart_items for select to authenticated using (rep_id = auth.uid() and has_role('sales'));

create function rep_cart_set(p_customer_id uuid, p_unit_id uuid, p_qty numeric, p_saved boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prod uuid; v_factor numeric; v_name text; v_unit text; v_left numeric; v_saved boolean;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can shop for a customer'; end if;
  if not exists (select 1 from customers where id = p_customer_id and active) then raise exception 'Pick a customer'; end if;
  select u.product_id, u.factor, p.name, u.name into v_prod, v_factor, v_name, v_unit
    from product_units u join products p on p.id = u.product_id where u.id = p_unit_id and p.active;
  if not found then raise exception 'That item is no longer sold'; end if;
  if p_qty is null or p_qty <= 0 then
    delete from rep_cart_items where rep_id = auth.uid() and customer_id = p_customer_id and unit_id = p_unit_id;
  else
    if p_qty <> floor(p_qty) or p_qty > 100000 then raise exception 'Quantities are whole numbers'; end if;
    select coalesce(p_saved, (select saved_for_later from rep_cart_items where rep_id = auth.uid() and customer_id = p_customer_id and unit_id = p_unit_id), false) into v_saved;
    v_left := floor(product_available_base(v_prod) / v_factor);
    if not v_saved and p_qty > v_left then raise exception 'Only % % of % left', greatest(v_left, 0), v_unit, v_name; end if;
    insert into rep_carts (rep_id, customer_id) values (auth.uid(), p_customer_id) on conflict (rep_id, customer_id) do update set updated_at = now();
    insert into rep_cart_items (rep_id, customer_id, unit_id, qty, saved_for_later) values (auth.uid(), p_customer_id, p_unit_id, p_qty, v_saved)
    on conflict (rep_id, customer_id, unit_id) do update set qty = excluded.qty, saved_for_later = excluded.saved_for_later, updated_at = now();
  end if;
  return jsonb_build_object('unit_id', p_unit_id, 'qty', greatest(coalesce(p_qty, 0), 0), 'available', v_left);
end $$;

create function rep_cart_details(p_customer_id uuid, p_payment text, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can shop for a customer'; end if;
  if p_payment is not null and p_payment not in ('cash', 'card', 'check') then raise exception 'Payment must be cash, card or check'; end if;
  insert into rep_carts (rep_id, customer_id, payment, notes) values (auth.uid(), p_customer_id, p_payment, nullif(left(trim(coalesce(p_notes, '')), 500), ''))
  on conflict (rep_id, customer_id) do update set payment = excluded.payment, notes = excluded.notes, updated_at = now();
end $$;

-- What the customer has in their own online cart (all of their logins), for the rep to see and pull in.
create function rep_customer_online_cart(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can shop for a customer'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('unit_id', unit_id, 'qty', q)) from (
    select i.unit_id, sum(i.qty) q from portal_cart_items i join portal_accounts pa on pa.profile_id = i.profile_id
     where pa.customer_id = p_customer_id and not i.saved_for_later group by i.unit_id) x), '[]'::jsonb);
end $$;

create function rep_cart_pull_online(p_customer_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select value from jsonb_array_elements(rep_customer_online_cart(p_customer_id)) loop
    insert into rep_carts (rep_id, customer_id) values (auth.uid(), p_customer_id) on conflict (rep_id, customer_id) do nothing;
    insert into rep_cart_items (rep_id, customer_id, unit_id, qty) values (auth.uid(), p_customer_id, (r->>'unit_id')::uuid, (r->>'qty')::numeric)
    on conflict (rep_id, customer_id, unit_id) do update set qty = greatest(rep_cart_items.qty, excluded.qty), saved_for_later = false, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- Place the order for the customer. The rep is approving it as they build it, so it is Ready to pull straight away.
create function rep_cart_checkout(p_customer_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v_cart rep_carts; v_so uuid;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can shop for a customer'; end if;
  if not exists (select 1 from customers where id = p_customer_id and active) then raise exception 'Pick a customer'; end if;
  select * into v_cart from rep_carts where rep_id = auth.uid() and customer_id = p_customer_id;
  select jsonb_agg(jsonb_build_object('unit_id', unit_id, 'qty', qty) order by added_at) into v_lines
    from rep_cart_items where rep_id = auth.uid() and customer_id = p_customer_id and not saved_for_later;
  if v_lines is null then raise exception 'The cart is empty'; end if;
  v_so := cart_to_order(p_customer_id, v_lines, v_cart.notes, 'app', true, v_cart.payment);
  update sales_orders set status = 'confirmed' where id = v_so;
  delete from rep_cart_items where rep_id = auth.uid() and customer_id = p_customer_id and not saved_for_later;
  update rep_carts set notes = null, updated_at = now() where rep_id = auth.uid() and customer_id = p_customer_id;
  return v_so;
end $$;

revoke execute on function rep_cart_set(uuid, uuid, numeric, boolean), rep_cart_details(uuid, text, text), rep_customer_online_cart(uuid), rep_cart_pull_online(uuid), rep_cart_checkout(uuid) from public, anon;
grant execute on function rep_cart_set(uuid, uuid, numeric, boolean), rep_cart_details(uuid, text, text), rep_customer_online_cart(uuid), rep_cart_pull_online(uuid), rep_cart_checkout(uuid) to authenticated;
