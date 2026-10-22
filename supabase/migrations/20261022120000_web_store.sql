-- =====================================================================
-- Web store connection: the shop's separate ordering website sends (or
-- serves) its inventory counts and web orders.
--   * Website stock is the source of truth for matched items: its count,
--     plus anything already promised to web orders not yet pulled, becomes
--     on-hand here ("Web sync" adjustments).
--   * Web orders become confirmed sales orders (once each).
-- Payloads arrive already mapped to the shapes below (lib/webstore.ts does
-- the field mapping from the website's own JSON).
-- =====================================================================

create table web_store_settings (
  id                integer primary key default 1 check (id = 1),
  enabled           boolean not null default false,
  inventory_url     text,
  orders_url        text,
  api_key           text,           -- sent to the website as "Authorization: Bearer …"
  webhook_secret    text,           -- the website signs webhooks with this (HMAC-SHA256)
  stock_location_id uuid references locations(id) on delete set null,  -- where increases land
  web_customer_id   uuid references customers(id) on delete set null,   -- orders without a matching customer
  field_map         jsonb not null default '{}'::jsonb,
  last_order_sync   timestamptz,
  updated_at        timestamptz not null default now()
);
insert into web_store_settings (id) values (1);

-- A website SKU that isn't one of our SKUs, linked to an item and unit here
create table web_sku_links (
  external_sku text primary key,
  product_id   uuid not null references products(id) on delete cascade,
  unit_id      uuid not null,
  created_at   timestamptz not null default now(),
  foreign key (unit_id, product_id) references product_units(id, product_id) on delete cascade
);

-- Website SKUs we couldn't match yet
create table web_unmatched_skus (
  external_sku text primary key,
  seen_in      text not null,           -- 'inventory' or 'order'
  last_qty     numeric,
  last_seen    timestamptz not null default now()
);

create table web_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('inventory', 'orders')),
  source      text not null check (source in ('webhook', 'pull', 'manual')),
  ok          boolean not null,
  summary     jsonb,
  error       text,
  created_at  timestamptz not null default now()
);
create index web_sync_runs_recent on web_sync_runs (created_at desc);

alter table sales_orders
  add column source      text not null default 'app' check (source in ('app', 'web')),
  add column external_id text;
create unique index sales_orders_external_uidx on sales_orders (external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- Who may sync: the website's webhook / scheduled job (service key), or
-- Admin and Warehouse pressing "Sync now".
-- ---------------------------------------------------------------------
create function web_sync_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                           nullif(current_setting('request.jwt.claim.role', true), '')) = 'service_role', false)
      or has_role('warehouse');
$$;

-- Website SKU → (product, unit): a saved link first, else our own SKU (base unit).
create function web_resolve_sku(p_sku text, out product_id uuid, out unit_id uuid, out factor numeric)
language sql stable security definer set search_path = public as $$
  select l.product_id, l.unit_id, u.factor
    from web_sku_links l join product_units u on u.id = l.unit_id
   where lower(l.external_sku) = lower(trim(p_sku))
  union all
  select p.id, u.id, u.factor
    from products p join product_units u on u.product_id = p.id and u.factor = 1
   where lower(p.sku) = lower(trim(p_sku))
     and not exists (select 1 from web_sku_links l where lower(l.external_sku) = lower(trim(p_sku)))
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Inventory: p_items = [{ "sku": text, "qty": number }]
-- Sets on-hand for each matched item to the website's count plus what open
-- web orders still need. Decreases come out of the oldest lots first;
-- increases land in the chosen stock location at the item's average cost.
-- ---------------------------------------------------------------------
create function web_store_apply_inventory(p_items jsonb, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set      web_store_settings;
  v_item     jsonb;
  v_res      record;
  v_target   jsonb := '{}'::jsonb;      -- product_id → base qty from the website
  v_pid      uuid;
  v_web      numeric;
  v_reserved numeric;
  v_have     numeric;
  v_delta    numeric;
  v_lot      lots;
  v_take     numeric;
  v_cost     numeric;
  v_loc      uuid;
  v_up int := 0; v_same int := 0;
  v_unmatched text[] := '{}';
  v_summary  jsonb;
begin
  if not web_sync_allowed() then raise exception 'Not authorized'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Inventory must be a list of { sku, qty }'; end if;
  select * into v_set from web_store_settings where id = 1;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(trim(v_item->>'sku'), '') = '' then continue; end if;
    if (v_item->>'qty') is null or (v_item->>'qty') !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'SKU %: quantity "%" is not a number', v_item->>'sku', v_item->>'qty';
    end if;
    select * into v_res from web_resolve_sku(v_item->>'sku');
    if v_res.product_id is null then
      v_unmatched := v_unmatched || (v_item->>'sku');
      insert into web_unmatched_skus (external_sku, seen_in, last_qty) values (trim(v_item->>'sku'), 'inventory', (v_item->>'qty')::numeric)
      on conflict (external_sku) do update set last_qty = excluded.last_qty, last_seen = now(), seen_in = 'inventory';
      continue;
    end if;
    v_target := jsonb_set(v_target, array[v_res.product_id::text],
      to_jsonb(coalesce((v_target->>v_res.product_id::text)::numeric, 0) + greatest(0, (v_item->>'qty')::numeric) * v_res.factor));
  end loop;

  perform set_config('app.via_rpc', '1', true);
  for v_pid, v_web in select key::uuid, value::text::numeric from jsonb_each(v_target) loop
    -- stock already promised to web orders that haven't been pulled yet
    select coalesce(sum(l.qty * u.factor), 0) into v_reserved
      from sales_order_lines l
      join sales_orders so on so.id = l.so_id
      join product_units u on u.id = l.unit_id
     where so.source = 'web' and so.status in ('draft', 'confirmed') and l.product_id = v_pid;
    select coalesce(sum(qty_on_hand_base), 0) into v_have from lots where product_id = v_pid;
    v_delta := (v_web + v_reserved) - v_have;
    if abs(v_delta) < 1e-9 then v_same := v_same + 1; continue; end if;
    v_up := v_up + 1;

    if v_delta < 0 then
      v_take := -v_delta;
      for v_lot in select * from lots where product_id = v_pid and qty_on_hand_base > 0
                    order by received_at, created_at for update loop
        exit when v_take <= 0;
        v_cost := least(v_take, v_lot.qty_on_hand_base);
        update lots set qty_on_hand_base = qty_on_hand_base - v_cost where id = v_lot.id;
        insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
        values (v_lot.id, v_pid, v_lot.location_id, 'adjust', -v_cost, 'Web sync', 'WEB-SYNC');
        v_take := v_take - v_cost;
      end loop;
    else
      v_loc := coalesce(v_set.stock_location_id,
                        (select id from locations where active and kind = 'dock' order by name limit 1),
                        (select id from locations where active order by name limit 1));
      if v_loc is null then raise exception 'Add a location first, or choose where web stock goes in Web store settings'; end if;
      select coalesce(
               (select sum(qty_on_hand_base * unit_cost_base) / nullif(sum(qty_on_hand_base), 0) from lots where product_id = v_pid and qty_on_hand_base > 0),
               (select unit_cost_base from lots where product_id = v_pid order by received_at desc limit 1),
               0) into v_cost;
      insert into lots (product_id, location_id, qty_received_base, qty_on_hand_base, unit_cost_base)
      values (v_pid, v_loc, v_delta, v_delta, v_cost) returning * into v_lot;
      insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
      values (v_lot.id, v_pid, v_loc, 'adjust', v_delta, 'Web sync', 'WEB-SYNC');
    end if;
  end loop;
  perform set_config('app.via_rpc', '', true);

  v_summary := jsonb_build_object('items', jsonb_array_length(p_items), 'updated', v_up, 'unchanged', v_same, 'unmatched', to_jsonb(v_unmatched));
  insert into web_sync_runs (kind, source, ok, summary) values ('inventory', coalesce(p_source, 'manual'), true, v_summary);
  return v_summary;
end $$;

-- ---------------------------------------------------------------------
-- One web order: { "external_id", "number"?, "email"?, "name"?, "phone"?,
--   "ordered_at"?, "ship_date"?, "notes"?, "cancelled"?: bool,
--   "lines": [{ "sku", "qty", "price"? }] }
-- New → confirmed sales order (draft if some SKUs didn't match).
-- Seen before → left as is, unless the website cancelled it.
-- ---------------------------------------------------------------------
create function web_store_upsert_order(p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set    web_store_settings;
  v_ext    text := nullif(trim(p_order->>'external_id'), '');
  v_so     sales_orders;
  v_cust   uuid;
  v_line   jsonb;
  v_res    record;
  v_price  numeric;
  v_bad    text[] := '{}';
  v_notes  text;
  v_ship   date;
  v_n      int := 0;
begin
  if not web_sync_allowed() then raise exception 'Not authorized'; end if;
  if v_ext is null then raise exception 'A web order needs an id'; end if;
  select * into v_set from web_store_settings where id = 1;
  select * into v_so from sales_orders where external_id = 'web:' || v_ext for update;

  if found then
    if coalesce((p_order->>'cancelled')::boolean, false) and v_so.status in ('draft', 'confirmed') then
      perform set_config('app.via_rpc', '1', true);
      update sales_orders set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Cancelled on the website') where id = v_so.id;
      perform set_config('app.via_rpc', '', true);
      return jsonb_build_object('so_id', v_so.id, 'result', 'cancelled');
    end if;
    return jsonb_build_object('so_id', v_so.id, 'result', 'exists');
  end if;
  if coalesce((p_order->>'cancelled')::boolean, false) then
    return jsonb_build_object('result', 'skipped_cancelled');
  end if;
  if jsonb_typeof(p_order->'lines') <> 'array' or jsonb_array_length(p_order->'lines') = 0 then
    raise exception 'Web order % has no items', v_ext;
  end if;

  -- customer: same email, else the web orders customer (made on first use)
  if nullif(trim(p_order->>'email'), '') is not null then
    select id into v_cust from customers where lower(email) = lower(trim(p_order->>'email')) and active order by created_at limit 1;
  end if;
  if v_cust is null then
    v_cust := v_set.web_customer_id;
    if v_cust is null then
      select id into v_cust from customers where name = 'Web orders' order by created_at limit 1;
      if v_cust is null then
        insert into customers (name, notes, payment_terms_days) values ('Web orders', 'Orders from the web store without a matching customer', 0) returning id into v_cust;
      end if;
      update web_store_settings set web_customer_id = v_cust where id = 1;
    end if;
  end if;

  v_ship := coalesce(nullif(p_order->>'ship_date', '')::date, nullif(p_order->>'ordered_at', '')::timestamptz::date, current_date);
  v_notes := concat_ws(E'\n',
    'Web order ' || coalesce(nullif(p_order->>'number', ''), v_ext),
    nullif(concat_ws(' · ', nullif(p_order->>'name', ''), nullif(p_order->>'email', ''), nullif(p_order->>'phone', '')), ''),
    nullif(p_order->>'notes', ''));

  insert into sales_orders (customer_id, status, order_date, ship_date, notes, source, external_id)
  values (v_cust, 'draft', coalesce(nullif(p_order->>'ordered_at', '')::timestamptz::date, current_date), v_ship, v_notes, 'web', 'web:' || v_ext)
  returning * into v_so;

  for v_line in select * from jsonb_array_elements(p_order->'lines') loop
    select * into v_res from web_resolve_sku(v_line->>'sku');
    if v_res.product_id is null then
      v_bad := v_bad || coalesce(v_line->>'sku', '?');
      insert into web_unmatched_skus (external_sku, seen_in, last_qty) values (trim(coalesce(v_line->>'sku', '?')), 'order', nullif(v_line->>'qty', '')::numeric)
      on conflict (external_sku) do update set last_qty = excluded.last_qty, last_seen = now(), seen_in = 'order';
      continue;
    end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then continue; end if;
    v_price := coalesce(nullif(v_line->>'price', '')::numeric, customer_unit_price(v_cust, v_res.unit_id));
    insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
    values (v_so.id, v_res.product_id, v_res.unit_id, (v_line->>'qty')::numeric, v_price);
    v_n := v_n + 1;
  end loop;

  if cardinality(v_bad) = 0 and v_n > 0 then
    update sales_orders set status = 'confirmed' where id = v_so.id;
  else
    update sales_orders set notes = concat_ws(E'\n', notes, 'Website SKUs not matched yet: ' || array_to_string(v_bad, ', ')) where id = v_so.id;
  end if;
  return jsonb_build_object('so_id', v_so.id, 'result', case when cardinality(v_bad) = 0 and v_n > 0 then 'created' else 'needs_review' end,
                            'unmatched', to_jsonb(v_bad));
end $$;

create function web_store_log(p_kind text, p_source text, p_ok boolean, p_summary jsonb, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not web_sync_allowed() then raise exception 'Not authorized'; end if;
  insert into web_sync_runs (kind, source, ok, summary, error) values (p_kind, p_source, p_ok, p_summary, left(p_error, 2000));
  if p_kind = 'orders' and p_ok then update web_store_settings set last_order_sync = now() where id = 1; end if;
end $$;

-- Link a website SKU to an item and unit; clears it from the unmatched list.
create function web_link_sku(p_sku text, p_product_id uuid, p_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer', 'warehouse') then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_sku), '') = '' then raise exception 'Enter the website SKU'; end if;
  insert into web_sku_links (external_sku, product_id, unit_id) values (trim(p_sku), p_product_id, p_unit_id)
  on conflict (external_sku) do update set product_id = excluded.product_id, unit_id = excluded.unit_id;
  delete from web_unmatched_skus where lower(external_sku) = lower(trim(p_sku));
end $$;

-- The webhook / scheduled job reads its settings through this (service key only).
create function web_store_config() returns web_store_settings
language plpgsql stable security definer set search_path = public as $$
declare v web_store_settings;
begin
  if not (has_role('admin') or coalesce(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
          nullif(current_setting('request.jwt.claim.role', true), '')) = 'service_role', false)) then
    raise exception 'Not authorized';
  end if;
  select * into v from web_store_settings where id = 1;
  return v;
end $$;

revoke execute on function web_sync_allowed(), web_resolve_sku(text), web_store_apply_inventory(jsonb, text), web_store_upsert_order(jsonb),
  web_store_log(text, text, boolean, jsonb, text), web_link_sku(text, uuid, uuid), web_store_config() from public;
grant execute on function web_sync_allowed(), web_resolve_sku(text), web_store_apply_inventory(jsonb, text), web_store_upsert_order(jsonb),
  web_store_log(text, text, boolean, jsonb, text), web_link_sku(text, uuid, uuid), web_store_config() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function web_sync_allowed(), web_resolve_sku(text), web_store_apply_inventory(jsonb, text), web_store_upsert_order(jsonb), web_store_log(text, text, boolean, jsonb, text), web_store_config() to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RLS: settings (they hold the API key and webhook secret) are Admin only.
-- ---------------------------------------------------------------------
alter table web_store_settings  enable row level security;
alter table web_sku_links       enable row level security;
alter table web_unmatched_skus  enable row level security;
alter table web_sync_runs       enable row level security;
create policy "admin read"  on web_store_settings for select to authenticated using (has_role('admin'));
create policy "admin write" on web_store_settings for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "members read" on web_sku_links      for select to authenticated using (is_member());
create policy "buyers delete" on web_sku_links     for delete to authenticated using (has_role('buyer', 'warehouse'));
create policy "members read" on web_unmatched_skus for select to authenticated using (is_member());
create policy "buyers delete" on web_unmatched_skus for delete to authenticated using (has_role('buyer', 'warehouse'));
create policy "members read" on web_sync_runs      for select to authenticated using (is_member());
