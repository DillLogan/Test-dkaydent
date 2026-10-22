-- =====================================================================
-- Several floor plans (one per shop), entries and exits on each plan,
-- and an item's home section per shop.
-- =====================================================================

-- ---------- Layouts ----------
create table shop_layouts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 1 and 60),
  background_path text,
  aspect          numeric not null default 1.6 check (aspect between 0.3 and 4),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index shop_layouts_name_uidx on shop_layouts (lower(trim(name)));

insert into shop_layouts (name, background_path, aspect)
select 'Main shop', background_path, aspect from shop_layout;
insert into shop_layouts (name) select 'Main shop' where not exists (select 1 from shop_layouts);

-- Every section belongs to one shop
alter table locations add column layout_id uuid references shop_layouts(id);
update locations set layout_id = (select id from shop_layouts order by created_at limit 1);
alter table locations alter column layout_id set not null;
alter table locations add constraint locations_id_layout_uniq unique (id, layout_id);

-- New sections without a shop go to the first one
create function default_location_layout() returns trigger
language plpgsql as $$
begin
  if new.layout_id is null then
    select id into new.layout_id from shop_layouts order by created_at, id limit 1;
  end if;
  return new;
end $$;
create trigger locations_default_layout before insert on locations
  for each row execute function default_location_layout();

-- ---------- Entries and exits ----------
create type door_kind as enum ('entry', 'exit');
create table plan_doors (
  id         uuid primary key default gen_random_uuid(),
  layout_id  uuid not null references shop_layouts(id) on delete cascade,
  kind       door_kind not null,
  label      text not null check (length(trim(label)) between 1 and 60),
  side       text not null check (side in ('top', 'right', 'bottom', 'left')),
  pos        numeric not null default 50 check (pos between 0 and 100),   -- percent along that wall
  created_at timestamptz not null default now()
);

-- ---------- Home section per shop ----------
create table product_homes (
  product_id  uuid not null references products(id) on delete cascade,
  layout_id   uuid not null,
  location_id uuid not null,
  primary key (product_id, layout_id),
  foreign key (location_id, layout_id) references locations(id, layout_id) on delete cascade
);
insert into product_homes (product_id, layout_id, location_id)
select p.id, l.layout_id, l.id from products p join locations l on l.id = p.home_location_id;

-- A section moved to another shop leaves its old plan and stops being anyone's home
create function location_layout_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.layout_id is distinct from old.layout_id then
    delete from product_homes where location_id = old.id;
    new.map_x := null; new.map_y := null; new.map_w := null; new.map_h := null;
  end if;
  return new;
end $$;
create trigger locations_layout_moved before update of layout_id on locations
  for each row execute function location_layout_moved();

-- Views drop the old single home column
drop view v_lot_aging;
drop view v_product_stock;
create view v_lot_aging with (security_invoker = true) as
select l.id as lot_id, l.lot_code, l.product_id, p.sku, p.name as product_name, p.kind, p.base_unit,
       l.location_id, loc.name as location_name, l.received_at, l.expires_at,
       l.qty_on_hand_base, l.unit_cost_base,
       l.qty_on_hand_base * l.unit_cost_base as value,
       (current_date - l.received_at::date) as age_days,
       (l.expires_at - current_date) as days_to_expiry,
       p.image_path as product_image, l.image_path as lot_image, p.category, loc.layout_id
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
       min(l.received_at) as oldest_received_at,
       p.image_path
  from products p
  left join lots l on l.product_id = p.id and l.qty_on_hand_base > 0
 group by p.id;

drop function set_home_location(uuid, uuid);
alter table products drop column home_location_id;
drop table shop_layout;

-- ---------- Operations ----------
-- Set (or clear, with a null section) an item's home section in one shop.
create function set_home_location(p_product_id uuid, p_layout_id uuid, p_location_id uuid) returns void
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

-- Delete a layout; its sections move (unplaced) to another shop.
create function delete_shop_layout(p_id uuid, p_move_to uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('warehouse') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from shop_layouts where id = p_id) then raise exception 'Layout not found'; end if;
  if (select count(*) from shop_layouts) < 2 then raise exception 'Keep at least one layout'; end if;
  if p_move_to is null or p_move_to = p_id or not exists (select 1 from shop_layouts where id = p_move_to) then
    raise exception 'Choose another layout for its sections';
  end if;
  update locations set layout_id = p_move_to where layout_id = p_id;
  delete from shop_layouts where id = p_id;
end $$;

revoke execute on function set_home_location(uuid, uuid, uuid), delete_shop_layout(uuid, uuid) from public;
grant execute on function set_home_location(uuid, uuid, uuid), delete_shop_layout(uuid, uuid) to authenticated;

-- ---------- RLS ----------
alter table shop_layouts  enable row level security;
alter table plan_doors    enable row level security;
alter table product_homes enable row level security;
create policy "members read" on shop_layouts  for select to authenticated using (is_member());
create policy "members read" on plan_doors    for select to authenticated using (is_member());
create policy "members read" on product_homes for select to authenticated using (is_member());
create policy "warehouse insert" on shop_layouts for insert to authenticated with check (has_role('warehouse'));
create policy "warehouse update" on shop_layouts for update to authenticated
  using (has_role('warehouse')) with check (has_role('warehouse'));
create policy "warehouse write" on plan_doors for all to authenticated
  using (has_role('warehouse')) with check (has_role('warehouse'));
-- product_homes changes only through set_home_location
