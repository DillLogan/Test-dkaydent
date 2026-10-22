-- =====================================================================
-- Recurring sales orders: a customer's repeat order plans draft sales
-- orders 12 months ahead. Each draft can be edited or skipped; drafts
-- nobody edited are re-priced at the customer's current tier price
-- whenever the schedule refreshes.
-- =====================================================================

create table recurring_sales (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  customer_id uuid not null references customers(id),
  cadence     standing_cadence not null default 'weekly',
  start_date  date not null,                 -- first ship / pickup date
  end_date    date,
  active      boolean not null default true,
  notes       text,
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table recurring_sale_lines (
  id           uuid primary key default gen_random_uuid(),
  recurring_id uuid not null references recurring_sales(id) on delete cascade,
  product_id   uuid not null references products(id),
  unit_id      uuid not null,
  qty          numeric not null check (qty > 0),
  created_at   timestamptz not null default now(),
  foreign key (unit_id, product_id) references product_units(id, product_id)
);

alter table sales_orders
  add column recurring_id     uuid references recurring_sales(id) on delete set null,
  add column occurrence_date  date,
  add column customized       boolean not null default false;
create unique index sales_orders_occurrence_uidx
  on sales_orders (recurring_id, occurrence_date) where recurring_id is not null;

-- ---------------------------------------------------------------------
-- Price a unit for a customer: the tier's set price, else average landed
-- cost (or the latest lot's cost) plus the tier markup (35% without a tier).
-- ---------------------------------------------------------------------
create function customer_unit_price(p_customer_id uuid, p_unit_id uuid) returns numeric
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

-- ---------------------------------------------------------------------
-- Guards: edits mark a planned order customized; planned orders are skipped, not deleted
-- ---------------------------------------------------------------------
create function mark_so_customized() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1'
     and new.recurring_id is not null
     and (new.ship_date, new.notes, new.customer_id, new.status)
         is distinct from (old.ship_date, old.notes, old.customer_id, old.status) then
    new.customized := true;
  end if;
  return new;
end $$;
create trigger sales_orders_customized before update on sales_orders
  for each row execute function mark_so_customized();

create function mark_so_lines_customized() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1' then
    perform set_config('app.via_rpc', '1', true);
    update sales_orders set customized = true
     where id = coalesce(new.so_id, old.so_id) and recurring_id is not null and not customized;
    perform set_config('app.via_rpc', '', true);
  end if;
  return null;
end $$;
create trigger sales_order_lines_customized after insert or update or delete on sales_order_lines
  for each row execute function mark_so_lines_customized();

create function guard_recurring_so_delete() returns trigger
language plpgsql as $$
begin
  if old.recurring_id is not null and coalesce(current_setting('app.via_rpc', true), '') <> '1' then
    raise exception 'This order comes from a recurring order. Skip it instead of deleting it.';
  end if;
  return old;
end $$;
create trigger sales_orders_recurring_delete before delete on sales_orders
  for each row execute function guard_recurring_so_delete();

-- ---------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------

-- Plan draft orders for the next 12 months (idempotent: existing or skipped
-- dates are never recreated) and re-price planned drafts nobody edited.
create function generate_recurring_sales(p_recurring_id uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r   recurring_sales;
  d   date;
  v_so uuid;
  v_n integer := 0;
  v_as_standing standing_orders;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  for r in select * from recurring_sales
            where active and (p_recurring_id is null or id = p_recurring_id) loop
    if not exists (select 1 from recurring_sale_lines where recurring_id = r.id) then continue; end if;
    -- reuse the standing-order date rules
    v_as_standing.cadence := r.cadence; v_as_standing.start_date := r.start_date; v_as_standing.end_date := r.end_date;
    for d in select * from standing_occurrences(v_as_standing, current_date, (current_date + interval '1 year')::date) loop
      if exists (select 1 from sales_orders where recurring_id = r.id and occurrence_date = d) then continue; end if;
      insert into sales_orders (customer_id, status, order_date, ship_date, notes, recurring_id, occurrence_date)
        values (r.customer_id, 'draft', current_date, d, 'Recurring order: ' || r.name, r.id, d)
        returning id into v_so;
      insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
        select v_so, product_id, unit_id, qty, customer_unit_price(r.customer_id, unit_id)
          from recurring_sale_lines where recurring_id = r.id;
      v_n := v_n + 1;
    end loop;
    -- current prices on untouched planned drafts
    update sales_order_lines l
       set unit_price = customer_unit_price(so.customer_id, l.unit_id)
      from sales_orders so
     where so.id = l.so_id and so.recurring_id = r.id and so.status = 'draft' and not so.customized
       and l.unit_price is distinct from customer_unit_price(so.customer_id, l.unit_id);
  end loop;
  perform set_config('app.via_rpc', '', true);
  return v_n;
end $$;

-- Remove future planned drafts nobody edited.
create function clear_untouched_recurring(p_recurring_id uuid, p_after date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  delete from sales_orders
   where recurring_id = p_recurring_id and status = 'draft' and not customized and occurrence_date > p_after;
  get diagnostics v_n = row_count;
  perform set_config('app.via_rpc', '', true);
  return v_n;
end $$;

create function skip_recurring_sale(p_so_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.recurring_id is null then raise exception 'Not a recurring order'; end if;
  if v_so.status not in ('draft','confirmed') then raise exception 'Only planned or confirmed orders can be skipped'; end if;
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set status = 'cancelled' where id = p_so_id;
  perform set_config('app.via_rpc', '', true);
end $$;

create function set_recurring_sale_state(p_id uuid, p_action text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  if p_action = 'pause' then
    update recurring_sales set active = false where id = p_id;
    v_n := clear_untouched_recurring(p_id);
  elsif p_action = 'end' then
    update recurring_sales set active = false, end_date = greatest(start_date, current_date) where id = p_id;
    v_n := clear_untouched_recurring(p_id);
  elsif p_action = 'resume' then
    update recurring_sales set active = true where id = p_id;
    v_n := generate_recurring_sales(p_id);
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table recurring_sales      enable row level security;
alter table recurring_sale_lines enable row level security;
create policy "members read" on recurring_sales      for select to authenticated using (is_member());
create policy "members read" on recurring_sale_lines for select to authenticated using (is_member());
create policy "sales write" on recurring_sales      for all to authenticated using (has_role('sales')) with check (has_role('sales'));
create policy "sales write" on recurring_sale_lines for all to authenticated using (has_role('sales')) with check (has_role('sales'));
