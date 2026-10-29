-- =====================================================================
-- Sections inside locations, and shelves inside sections.
--   Location (Cooler 1) → Section (Rack A, drawn on the floor plan) → Shelf (1, 2, Top…)
--   * Stock (lots) records its own section and shelf.
--   * An item's home can name a usual section and shelf too.
--   Pull tickets use the stock's spot, else the item's home spot in that location.
-- =====================================================================

create table location_sections (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  shelves     text[] not null default '{}' check (cardinality(shelves) <= 60),
  map_shape   jsonb check (map_shape is null or (jsonb_typeof(map_shape) = 'array' and jsonb_array_length(map_shape) between 3 and 60)),
  map_x numeric, map_y numeric, map_w numeric, map_h numeric,
  map_color   text check (map_color is null or map_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now()
);
create unique index location_sections_name_uidx on location_sections (location_id, lower(trim(name)));
alter table location_sections enable row level security;
create policy "members read" on location_sections for select to authenticated using (is_member());
create policy "warehouse write" on location_sections for all to authenticated
  using (has_role('warehouse')) with check (has_role('warehouse'));

-- Shelf names: trimmed, 1–30 characters, no repeats (ignoring case)
create function clean_section_shelves() returns trigger
language plpgsql as $$
declare v text[] := '{}'; s text;
begin
  foreach s in array coalesce(new.shelves, '{}') loop
    s := btrim(s);
    if s = '' then continue; end if;
    if length(s) > 30 then raise exception 'Shelf names are up to 30 characters'; end if;
    if exists (select 1 from unnest(v) x where lower(x) = lower(s)) then continue; end if;
    v := v || s;
  end loop;
  new.shelves := v;
  new.name := btrim(new.name);
  return new;
end $$;
create trigger location_sections_clean before insert or update on location_sections
  for each row execute function clean_section_shelves();

-- ---------- where stock sits ----------
alter table lots add column section_id uuid references location_sections(id) on delete set null,
                 add column shelf text check (shelf is null or length(shelf) between 1 and 30);

-- A lot's section must be in the lot's location and its shelf on that section; moving the lot clears both.
create function check_lot_spot() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.location_id is distinct from old.location_id and new.section_id is not distinct from old.section_id then
    new.section_id := null; new.shelf := null;
  end if;
  if new.section_id is null then new.shelf := null; return new; end if;
  if not exists (select 1 from location_sections s where s.id = new.section_id and s.location_id = new.location_id) then
    raise exception 'That section isn''t in this lot''s location';
  end if;
  if new.shelf is not null then
    select x into new.shelf from location_sections s, unnest(s.shelves) x where s.id = new.section_id and lower(x) = lower(btrim(new.shelf)) limit 1;
    if new.shelf is null then raise exception 'That section has no such shelf'; end if;
  end if;
  return new;
end $$;
create trigger lots_spot before insert or update of section_id, shelf, location_id on lots
  for each row execute function check_lot_spot();

-- ---------- an item's usual spot inside its home ----------
alter table product_homes add column section_id uuid references location_sections(id) on delete set null,
                          add column shelf text check (shelf is null or length(shelf) between 1 and 30);
create function check_home_spot() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.location_id is distinct from old.location_id and new.section_id is not distinct from old.section_id then
    new.section_id := null; new.shelf := null;
  end if;
  if new.section_id is null then new.shelf := null; return new; end if;
  if not exists (select 1 from location_sections s where s.id = new.section_id and s.location_id = new.location_id) then
    raise exception 'That section isn''t in the item''s home area';
  end if;
  if new.shelf is not null then
    select x into new.shelf from location_sections s, unnest(s.shelves) x where s.id = new.section_id and lower(x) = lower(btrim(new.shelf)) limit 1;
    if new.shelf is null then raise exception 'That section has no such shelf'; end if;
  end if;
  return new;
end $$;
create trigger product_homes_spot before insert or update on product_homes
  for each row execute function check_home_spot();

-- A section that loses a shelf, or moves to another location, lets go of stock and homes that used it.
create function section_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is distinct from old.location_id then
    update lots set section_id = null, shelf = null where section_id = new.id;
    update product_homes set section_id = null, shelf = null where section_id = new.id;
    new.map_shape := null; new.map_x := null; new.map_y := null; new.map_w := null; new.map_h := null;
  else
    update lots set shelf = null where section_id = new.id and shelf is not null and not exists (select 1 from unnest(new.shelves) x where lower(x) = lower(lots.shelf));
    update product_homes set shelf = null where section_id = new.id and shelf is not null and not exists (select 1 from unnest(new.shelves) x where lower(x) = lower(product_homes.shelf));
  end if;
  return new;
end $$;
create trigger location_sections_changed before update of location_id, shelves on location_sections
  for each row execute function section_changed();

-- A location moved to another shop takes its sections along, off the plan.
create function location_sections_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.layout_id is distinct from old.layout_id then
    update location_sections set map_shape = null, map_x = null, map_y = null, map_w = null, map_h = null where location_id = new.id;
  end if;
  return new;
end $$;
create trigger locations_sections_follow after update of layout_id on locations
  for each row execute function location_sections_follow();

-- ---------- operations ----------
-- Where this stock sits inside its location (null section clears it).
create function set_lot_spot(p_lot_id uuid, p_section_id uuid, p_shelf text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('warehouse') then raise exception 'Not authorized'; end if;
  update lots set section_id = p_section_id, shelf = nullif(btrim(coalesce(p_shelf, '')), '') where id = p_lot_id;
  if not found then raise exception 'Lot not found'; end if;
end $$;

-- An item's usual section and shelf inside its home in one shop (null section clears it).
create function set_home_spot(p_product_id uuid, p_layout_id uuid, p_section_id uuid, p_shelf text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  update product_homes set section_id = p_section_id, shelf = nullif(btrim(coalesce(p_shelf, '')), '')
   where product_id = p_product_id and layout_id = p_layout_id;
  if not found then raise exception 'Set the home area first'; end if;
end $$;

revoke execute on function set_lot_spot(uuid, uuid, text), set_home_spot(uuid, uuid, uuid, text) from public;
grant execute on function set_lot_spot(uuid, uuid, text), set_home_spot(uuid, uuid, uuid, text) to authenticated;

-- set_home_location keeps the spot when the home stays the same, and clears it when the home moves (trigger above)
create or replace function set_home_location(p_product_id uuid, p_layout_id uuid, p_location_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from products where id = p_product_id) then raise exception 'Item not found'; end if;
  if not exists (select 1 from shop_layouts where id = p_layout_id) then raise exception 'Layout not found'; end if;
  if p_location_id is null then
    delete from product_homes where product_id = p_product_id and layout_id = p_layout_id;
    return;
  end if;
  if not exists (select 1 from locations where id = p_location_id and layout_id = p_layout_id) then
    raise exception 'That section isn''t in this shop';
  end if;
  insert into product_homes (product_id, layout_id, location_id) values (p_product_id, p_layout_id, p_location_id)
  on conflict (product_id, layout_id) do update set location_id = excluded.location_id;
end $$;

-- The spot for each lot: its own, else the item's home spot when the lot sits in its home location.
create view v_lot_spot with (security_invoker = true) as
select l.id as lot_id, l.location_id,
       coalesce(s.name, hs.name) as section_name,
       case when s.id is not null then l.shelf else h.shelf end as shelf,
       case when s.id is not null then 'stock' when hs.id is not null then 'home' end as spot_from
  from lots l
  join locations loc on loc.id = l.location_id
  left join location_sections s on s.id = l.section_id
  left join product_homes h on h.product_id = l.product_id and h.layout_id = loc.layout_id and h.location_id = l.location_id and l.section_id is null
  left join location_sections hs on hs.id = h.section_id;
