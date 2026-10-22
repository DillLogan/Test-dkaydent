-- =====================================================================
-- Photos on items and lots, keyword category rules, CSV stock batches,
-- and the "Location in shop" floor plan.
-- =====================================================================

-- ---------- Photos ----------
alter table products add column image_path text;
alter table lots     add column image_path text;

-- ---------- Floor plan ----------
-- Areas on the plan are the existing locations, placed as rectangles in
-- percent of the plan's width/height (0-100).
alter table locations
  add column map_x numeric check (map_x between 0 and 100),
  add column map_y numeric check (map_y between 0 and 100),
  add column map_w numeric check (map_w > 0 and map_w <= 100),
  add column map_h numeric check (map_h > 0 and map_h <= 100),
  add column map_color text check (map_color ~ '^#[0-9a-fA-F]{6}$');

-- Where each item belongs in the shop
alter table products add column home_location_id uuid references locations(id) on delete set null;

-- One plan per shop: optional background image and its shape
create table shop_layout (
  id              integer primary key default 1 check (id = 1),
  background_path text,
  aspect          numeric not null default 1.6 check (aspect between 0.3 and 4),
  updated_at      timestamptz not null default now()
);
insert into shop_layout (id) values (1);

-- ---------- Category rules ----------
-- Keyword → category (and flower / hard good). A keyword matches at the start
-- of a word in the item name; the longest matching keyword wins, then priority.
create table category_rules (
  id         uuid primary key default gen_random_uuid(),
  keyword    text not null check (length(trim(keyword)) > 0),
  category   text not null check (length(trim(category)) > 0),
  kind       product_kind,
  priority   integer not null default 100,
  created_at timestamptz not null default now(),
  unique (keyword)
);

insert into category_rules (keyword, category, kind) values
  ('rose', 'Roses', 'flower'), ('spray rose', 'Spray Roses', 'flower'), ('garden rose', 'Garden Roses', 'flower'),
  ('hydrangea', 'Hydrangea', 'flower'), ('carnation', 'Carnations', 'flower'), ('mini carnation', 'Mini Carnations', 'flower'),
  ('alstroemeria', 'Alstroemeria', 'flower'), ('lily', 'Lilies', 'flower'), ('lilies', 'Lilies', 'flower'),
  ('calla', 'Calla Lilies', 'flower'), ('tulip', 'Tulips', 'flower'), ('peony', 'Peonies', 'flower'), ('peonies', 'Peonies', 'flower'),
  ('ranunculus', 'Ranunculus', 'flower'), ('anemone', 'Anemones', 'flower'), ('sunflower', 'Sunflowers', 'flower'),
  ('chrysanthemum', 'Chrysanthemums', 'flower'), ('pompon', 'Chrysanthemums', 'flower'), ('cushion mum', 'Chrysanthemums', 'flower'),
  ('gerbera', 'Gerberas', 'flower'), ('lisianthus', 'Lisianthus', 'flower'), ('snapdragon', 'Snapdragons', 'flower'),
  ('delphinium', 'Delphinium', 'flower'), ('larkspur', 'Delphinium', 'flower'), ('dahlia', 'Dahlias', 'flower'),
  ('freesia', 'Freesia', 'flower'), ('iris', 'Iris', 'flower'), ('orchid', 'Orchids', 'flower'), ('phalaenopsis', 'Orchids', 'flower'),
  ('cymbidium', 'Orchids', 'flower'), ('protea', 'Tropicals', 'flower'), ('anthurium', 'Tropicals', 'flower'), ('heliconia', 'Tropicals', 'flower'),
  ('gypsophila', 'Fillers', 'flower'), ('baby''s breath', 'Fillers', 'flower'), ('limonium', 'Fillers', 'flower'), ('statice', 'Fillers', 'flower'),
  ('waxflower', 'Fillers', 'flower'), ('solidago', 'Fillers', 'flower'), ('hypericum', 'Fillers', 'flower'), ('scabiosa', 'Fillers', 'flower'),
  ('eucalyptus', 'Greens', 'flower'), ('ruscus', 'Greens', 'flower'), ('salal', 'Greens', 'flower'), ('lemon leaf', 'Greens', 'flower'),
  ('leatherleaf', 'Greens', 'flower'), ('fern', 'Greens', 'flower'), ('pittosporum', 'Greens', 'flower'), ('myrtle', 'Greens', 'flower'),
  ('aspidistra', 'Greens', 'flower'), ('monstera', 'Greens', 'flower'),
  ('vase', 'Vases', 'hard_good'), ('cylinder', 'Vases', 'hard_good'), ('cube', 'Vases', 'hard_good'), ('compote', 'Vases', 'hard_good'),
  ('urn', 'Vases', 'hard_good'), ('bowl', 'Vases', 'hard_good'),
  ('foam', 'Mechanics', 'hard_good'), ('oasis', 'Mechanics', 'hard_good'), ('floral tape', 'Mechanics', 'hard_good'), ('tape', 'Mechanics', 'hard_good'),
  ('wire', 'Mechanics', 'hard_good'), ('stem wrap', 'Mechanics', 'hard_good'), ('frog', 'Mechanics', 'hard_good'), ('pin', 'Mechanics', 'hard_good'),
  ('ribbon', 'Ribbon', 'hard_good'), ('sleeve', 'Packaging', 'hard_good'), ('cello', 'Packaging', 'hard_good'), ('tissue', 'Packaging', 'hard_good'),
  ('wrap', 'Packaging', 'hard_good'), ('bucket', 'Buckets', 'hard_good'), ('procona', 'Buckets', 'hard_good'), ('basket', 'Baskets', 'hard_good'),
  ('candle', 'Candles', 'hard_good'), ('card', 'Accessories', 'hard_good'), ('pick', 'Accessories', 'hard_good'),
  ('pot', 'Containers', 'hard_good'), ('planter', 'Containers', 'hard_good'), ('cachepot', 'Containers', 'hard_good');

-- Best rule for an item name (same logic as lib/categorize.ts)
create function categorize(p_name text)
returns table (category text, kind product_kind, keyword text)
language sql stable set search_path = public as $$
  select r.category, r.kind, r.keyword
    from category_rules r
   where p_name ~* ('\m' || regexp_replace(r.keyword, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'))
   order by length(r.keyword) desc, r.priority, r.keyword
   limit 1;
$$;

-- ---------- Photo and home-area setters (buyers and warehouse) ----------
create function set_product_image(p_product_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  update products set image_path = nullif(p_path, '') where id = p_product_id;
  if not found then raise exception 'Item not found'; end if;
end $$;

create function set_lot_image(p_lot_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  update lots set image_path = nullif(p_path, '') where id = p_lot_id;
  if not found then raise exception 'Lot not found'; end if;
end $$;

create function set_home_location(p_product_id uuid, p_location_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  if p_location_id is not null and not exists (select 1 from locations where id = p_location_id) then
    raise exception 'Location not found';
  end if;
  update products set home_location_id = p_location_id where id = p_product_id;
  if not found then raise exception 'Item not found'; end if;
end $$;

-- ---------- CSV stock batch ----------
-- p_rows: [{ sku, name?, kind?, category?, base_unit?, units?: [{name, factor}], shelf_life_days?,
--            unit?, qty, unit_cost, location, expires_at?, lot_code? }]
-- Creates missing items (buyers only), then one lot + "receive" movement per row.
-- All-or-nothing; error messages name the CSV row (header = row 1).
create function import_stock_batch(p_rows jsonb, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r        jsonb;
  u        jsonb;
  v_row    integer := 1;
  v_p      products;
  v_unit   product_units;
  v_loc    uuid;
  v_qty    numeric;
  v_cost   numeric;
  v_lot    uuid;
  v_ref    text;
  v_cat    record;
  v_kind   product_kind;
  v_base   text;
  v_made   integer := 0;
  v_lots   integer := 0;
  v_value  numeric := 0;
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then raise exception 'The batch has no rows'; end if;
  v_ref := coalesce(nullif(trim(p_reference), ''), 'BATCH-' || to_char(now(), 'YYMMDD-HH24MI'));

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := v_row + 1;
    if coalesce(trim(r->>'sku'), '') = '' then raise exception 'Row %: SKU is required', v_row; end if;

    select * into v_p from products where upper(sku) = upper(trim(r->>'sku'));
    if not found then
      if not has_role('buyer') then
        raise exception 'Row %: % is a new item; only buyers can create items', v_row, upper(trim(r->>'sku'));
      end if;
      if coalesce(trim(r->>'name'), '') = '' then
        raise exception 'Row %: % is a new item, so it needs a name', v_row, upper(trim(r->>'sku'));
      end if;
      select * into v_cat from categorize(r->>'name');
      v_kind := coalesce(nullif(r->>'kind', '')::product_kind, v_cat.kind, 'flower');
      v_base := lower(coalesce(nullif(trim(r->>'base_unit'), ''), case when v_kind = 'hard_good' then 'each' else 'stem' end));
      insert into products (sku, name, kind, category, base_unit, shelf_life_days)
      values (upper(trim(r->>'sku')), trim(r->>'name'), v_kind,
              coalesce(nullif(trim(r->>'category'), ''), v_cat.category),
              v_base, nullif(r->>'shelf_life_days', '')::integer)
      returning * into v_p;
      for u in select * from jsonb_array_elements(coalesce(r->'units', '[]'::jsonb)) loop
        if lower(u->>'name') <> v_base then
          insert into product_units (product_id, name, factor)
          values (v_p.id, lower(trim(u->>'name')), (u->>'factor')::numeric)
          on conflict (product_id, name) do nothing;
        end if;
      end loop;
      v_made := v_made + 1;
    end if;

    select * into v_unit from product_units
     where product_id = v_p.id and name = lower(coalesce(nullif(trim(r->>'unit'), ''), v_p.base_unit));
    if not found then
      raise exception 'Row %: % has no "%" unit', v_row, v_p.sku, lower(r->>'unit');
    end if;

    select id into v_loc from locations where lower(name) = lower(trim(r->>'location')) and active;
    if v_loc is null then raise exception 'Row %: location "%" doesn''t exist or is inactive', v_row, r->>'location'; end if;

    v_qty := nullif(r->>'qty', '')::numeric;
    v_cost := nullif(r->>'unit_cost', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Row %: qty must be more than 0', v_row; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Row %: unit_cost is required', v_row; end if;

    insert into lots (lot_code, product_id, location_id, expires_at, qty_received_base, qty_on_hand_base, unit_cost_base)
    values (
      coalesce(nullif(trim(r->>'lot_code'), ''), 'L' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('lot_seq')::text, 4, '0')),
      v_p.id, v_loc,
      coalesce(nullif(r->>'expires_at', '')::date, case when v_p.shelf_life_days is not null then current_date + v_p.shelf_life_days end),
      v_qty * v_unit.factor, v_qty * v_unit.factor, v_cost / v_unit.factor)
    returning id into v_lot;

    insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reference, reason)
    values (v_lot, v_p.id, v_loc, 'receive', v_qty * v_unit.factor, v_ref, 'CSV stock batch');

    v_lots := v_lots + 1;
    v_value := v_value + v_qty * v_cost;
    v_loc := null;
  end loop;

  return jsonb_build_object('reference', v_ref, 'items_created', v_made, 'lots_created', v_lots, 'value', round(v_value, 2));
end $$;

revoke execute on function set_product_image(uuid, text), set_lot_image(uuid, text), set_home_location(uuid, uuid),
  import_stock_batch(jsonb, text) from public;
grant execute on function set_product_image(uuid, text), set_lot_image(uuid, text), set_home_location(uuid, uuid),
  import_stock_batch(jsonb, text), categorize(text) to authenticated;

-- ---------- RLS ----------
alter table shop_layout    enable row level security;
alter table category_rules enable row level security;

create policy "members read" on shop_layout    for select to authenticated using (is_member());
create policy "members read" on category_rules for select to authenticated using (is_member());
create policy "warehouse update" on shop_layout for update to authenticated
  using (has_role('warehouse')) with check (has_role('warehouse'));
create policy "buyers write" on category_rules for all to authenticated
  using (has_role('buyer')) with check (has_role('buyer'));

-- ---------- Views: add photo, category and home area (appended columns) ----------
create or replace view v_lot_aging with (security_invoker = true) as
select l.id as lot_id, l.lot_code, l.product_id, p.sku, p.name as product_name, p.kind, p.base_unit,
       l.location_id, loc.name as location_name, l.received_at, l.expires_at,
       l.qty_on_hand_base, l.unit_cost_base,
       l.qty_on_hand_base * l.unit_cost_base as value,
       (current_date - l.received_at::date) as age_days,
       (l.expires_at - current_date) as days_to_expiry,
       p.image_path as product_image, l.image_path as lot_image, p.category, p.home_location_id
  from lots l
  join products p on p.id = l.product_id
  join locations loc on loc.id = l.location_id
 where l.qty_on_hand_base > 0;

create or replace view v_product_stock with (security_invoker = true) as
select p.id as product_id, p.sku, p.name, p.kind, p.category, p.base_unit,
       p.reorder_point_base, p.active,
       coalesce(sum(l.qty_on_hand_base), 0) as qty_on_hand_base,
       coalesce(sum(l.qty_on_hand_base * l.unit_cost_base), 0) as value,
       case when sum(l.qty_on_hand_base) > 0
            then sum(l.qty_on_hand_base * l.unit_cost_base) / sum(l.qty_on_hand_base) end as avg_cost_base,
       min(l.received_at) as oldest_received_at,
       p.image_path, p.home_location_id
  from products p
  left join lots l on l.product_id = p.id and l.qty_on_hand_base > 0
 group by p.id;
