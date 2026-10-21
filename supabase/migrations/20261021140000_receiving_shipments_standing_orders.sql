-- =====================================================================
-- Receiving: inbound shipments (several POs each, planned up to a year
-- out) and standing orders that generate planned POs + shipments.
-- =====================================================================

create type shipment_status as enum ('planned','in_transit','arrived','received','cancelled');
create type standing_cadence as enum ('weekly','biweekly','monthly');

create sequence shipment_number_seq start 1001;

create table shipments (
  id              uuid primary key default gen_random_uuid(),
  shipment_number text not null unique default ('SHP-' || nextval('shipment_number_seq')),
  eta             date not null,
  carrier         text,
  tracking        text,                       -- AWB / tracking number
  status          shipment_status not null default 'planned',
  notes           text,
  received_at     timestamptz,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index shipments_eta_idx on shipments (eta);

create table standing_orders (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  vendor_id    uuid not null references vendors(id),
  cadence      standing_cadence not null default 'weekly',
  start_date   date not null,                 -- first arrival
  end_date     date,                          -- last possible arrival (optional)
  lead_days    integer not null default 7 check (lead_days between 0 and 120),
  carrier      text,
  freight_cost numeric not null default 0 check (freight_cost >= 0),
  active       boolean not null default true,
  notes        text,
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table standing_order_lines (
  id                uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  product_id        uuid not null references products(id),
  unit_id           uuid not null,
  qty               numeric not null check (qty > 0),
  unit_cost         numeric not null check (unit_cost >= 0),
  created_at        timestamptz not null default now(),
  foreign key (unit_id, product_id) references product_units(id, product_id)
);

alter table purchase_orders
  add column shipment_id       uuid references shipments(id) on delete set null,
  add column standing_order_id uuid references standing_orders(id) on delete set null,
  add column occurrence_date   date,
  add column customized        boolean not null default false;
create unique index purchase_orders_occurrence_uidx
  on purchase_orders (standing_order_id, occurrence_date) where standing_order_id is not null;
create index purchase_orders_shipment_idx on purchase_orders (shipment_id);

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------

-- ETA at most one year out; 'received' only through receive_shipment.
create function guard_shipment() returns trigger
language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = '1';
begin
  if (tg_op = 'INSERT' or new.eta is distinct from old.eta) and new.eta > (current_date + interval '1 year')::date then
    raise exception 'ETA can be at most one year out (by %)', to_char(current_date + interval '1 year', 'Mon DD, YYYY');
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status and not v_rpc
       and (new.status = 'received' or old.status in ('received','cancelled')) then
      raise exception 'Shipment status cannot be changed from % to % directly', old.status, new.status;
    end if;
    if old.status = 'received' and not v_rpc then
      raise exception 'Received shipments cannot be changed';
    end if;
    new.updated_at := now();
  elsif new.status = 'received' and not v_rpc then
    raise exception 'New shipments cannot start as received';
  end if;
  return new;
end $$;
create trigger shipments_guard before insert or update on shipments
  for each row execute function guard_shipment();

-- A manual edit to a generated PO (or its lines, or its shipment) marks it
-- customized, so pausing/ending the standing order leaves it alone.
create function mark_po_customized() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1'
     and new.standing_order_id is not null
     and (new.expected_date, new.order_date, new.freight_cost, new.other_cost, new.notes, new.vendor_id, new.status)
         is distinct from
         (old.expected_date, old.order_date, old.freight_cost, old.other_cost, old.notes, old.vendor_id, old.status) then
    new.customized := true;
  end if;
  return new;
end $$;
create trigger purchase_orders_customized before update on purchase_orders
  for each row execute function mark_po_customized();

create function mark_po_lines_customized() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1' then
    perform set_config('app.via_rpc', '1', true);
    update purchase_orders set customized = true
     where id = coalesce(new.po_id, old.po_id) and standing_order_id is not null and not customized;
    perform set_config('app.via_rpc', '', true);
  end if;
  return null;
end $$;
create trigger purchase_order_lines_customized after insert or update or delete on purchase_order_lines
  for each row execute function mark_po_lines_customized();

create function shipment_touch_pos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') = '1' then return null; end if;
  perform set_config('app.via_rpc', '1', true);
  if new.eta is distinct from old.eta then
    update purchase_orders set expected_date = new.eta
     where shipment_id = new.id and status in ('draft','ordered','partially_received');
  end if;
  if (new.eta, new.carrier, new.tracking, new.notes, new.status)
     is distinct from (old.eta, old.carrier, old.tracking, old.notes, old.status) then
    update purchase_orders set customized = true where shipment_id = new.id and standing_order_id is not null;
  end if;
  perform set_config('app.via_rpc', '', true);
  return null;
end $$;
create trigger shipments_touch_pos after update on shipments
  for each row execute function shipment_touch_pos();

-- Deleting a generated PO would let the schedule recreate it; skip it instead.
create function guard_generated_po_delete() returns trigger
language plpgsql as $$
begin
  if old.standing_order_id is not null and coalesce(current_setting('app.via_rpc', true), '') <> '1' then
    raise exception 'This order comes from a standing order. Skip it instead of deleting it.';
  end if;
  return old;
end $$;
create trigger purchase_orders_generated_delete before delete on purchase_orders
  for each row execute function guard_generated_po_delete();

-- ---------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------

-- Put a PO on a shipment (or take it off with null). Its expected date follows the ETA.
create function set_po_shipment(p_po_id uuid, p_shipment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_po purchase_orders; v_sh shipments;
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status not in ('draft','ordered','partially_received') then
    raise exception '% is % and can''t be moved between shipments', v_po.po_number, v_po.status;
  end if;
  if p_shipment_id is not null then
    select * into v_sh from shipments where id = p_shipment_id;
    if not found then raise exception 'Shipment not found'; end if;
    if v_sh.status in ('received','cancelled') then raise exception 'That shipment is %', v_sh.status; end if;
  end if;
  update purchase_orders
     set shipment_id = p_shipment_id,
         expected_date = coalesce(v_sh.eta, expected_date),
         customized = customized or standing_order_id is not null
   where id = p_po_id;
end $$;

-- Receive everything on a shipment in one go.
-- p_lines: [{ line_id, qty (line unit), location_id, expires_at?, lot_code? }]
-- Draft POs on the shipment are marked ordered first (the goods are here).
-- Each PO is received through receive_po, so landed cost and lots work the same.
create function receive_shipment(p_shipment_id uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sh    shipments;
  v_po    purchase_orders;
  v_lines jsonb;
  v_pos   integer := 0;
  v_lots  integer := 0;
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  select * into v_sh from shipments where id = p_shipment_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  if v_sh.status in ('received','cancelled') then raise exception 'This shipment is already %', v_sh.status; end if;

  -- every line must belong to a PO on this shipment
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines, '[]')) r
     where coalesce((r->>'qty')::numeric, 0) > 0
       and not exists (select 1 from purchase_order_lines l join purchase_orders po on po.id = l.po_id
                        where l.id = (r->>'line_id')::uuid and po.shipment_id = p_shipment_id)) then
    raise exception 'A line isn''t on this shipment';
  end if;

  for v_po in select * from purchase_orders
               where shipment_id = p_shipment_id and status in ('draft','ordered','partially_received')
               order by po_number loop
    select coalesce(jsonb_agg(r), '[]') into v_lines
      from jsonb_array_elements(coalesce(p_lines, '[]')) r
      join purchase_order_lines l on l.id = (r->>'line_id')::uuid
     where l.po_id = v_po.id and coalesce((r->>'qty')::numeric, 0) > 0;
    if jsonb_array_length(v_lines) = 0 then continue; end if;

    perform set_config('app.via_rpc', '1', true);
    if v_po.status = 'draft' then
      update purchase_orders set status = 'ordered', order_date = coalesce(order_date, current_date)
       where id = v_po.id;
    end if;
    perform receive_po(v_po.id, v_lines);
    v_pos := v_pos + 1;
    v_lots := v_lots + jsonb_array_length(v_lines);
  end loop;

  if v_pos = 0 then raise exception 'Enter a received quantity for at least one line'; end if;

  perform set_config('app.via_rpc', '1', true);
  update shipments set status = 'received', received_at = now() where id = p_shipment_id;
  perform set_config('app.via_rpc', '', true);
  return jsonb_build_object('pos', v_pos, 'lots', v_lots);
end $$;

-- Skip one planned occurrence: cancel its draft PO; cancel the shipment if nothing else is on it.
create function skip_planned_po(p_po_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_po purchase_orders;
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status <> 'draft' then raise exception 'Only planned (draft) orders can be skipped'; end if;
  perform set_config('app.via_rpc', '1', true);
  update purchase_orders set status = 'cancelled', shipment_id = null where id = p_po_id;
  if v_po.shipment_id is not null then
    update shipments set status = 'cancelled'
     where id = v_po.shipment_id and status = 'planned'
       and not exists (select 1 from purchase_orders where shipment_id = v_po.shipment_id);
  end if;
  perform set_config('app.via_rpc', '', true);
end $$;

-- Arrival dates of a standing order inside [from, to].
create function standing_occurrences(p_so standing_orders, p_from date, p_to date) returns setof date
language plpgsql stable as $$
declare d date; n integer := 0; v_to date := least(p_to, coalesce(p_so.end_date, p_to));
begin
  loop
    d := case p_so.cadence
           when 'weekly'   then p_so.start_date + n * 7
           when 'biweekly' then p_so.start_date + n * 14
           else (p_so.start_date + make_interval(months => n))::date end;
    exit when d > v_to or n > 600;
    if d >= p_from then return next d; end if;
    n := n + 1;
  end loop;
end $$;

-- Create the planned POs + shipments for the next 12 months (idempotent:
-- existing or skipped occurrences are never recreated).
create function generate_standing_orders(p_standing_order_id uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_so  standing_orders;
  d     date;
  v_sh  uuid;
  v_po  uuid;
  v_n   integer := 0;
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  for v_so in select * from standing_orders
               where active and (p_standing_order_id is null or id = p_standing_order_id) loop
    if not exists (select 1 from standing_order_lines where standing_order_id = v_so.id) then continue; end if;
    for d in select * from standing_occurrences(v_so, current_date, (current_date + interval '1 year')::date) loop
      if exists (select 1 from purchase_orders where standing_order_id = v_so.id and occurrence_date = d) then continue; end if;
      insert into shipments (eta, carrier, notes)
        values (d, v_so.carrier, 'Standing order: ' || v_so.name)
        returning id into v_sh;
      insert into purchase_orders (vendor_id, status, order_date, expected_date, freight_cost, notes,
                                   shipment_id, standing_order_id, occurrence_date)
        values (v_so.vendor_id, 'draft', greatest(current_date, d - v_so.lead_days), d, v_so.freight_cost,
                'Standing order: ' || v_so.name, v_sh, v_so.id, d)
        returning id into v_po;
      insert into purchase_order_lines (po_id, product_id, unit_id, qty, unit_cost)
        select v_po, product_id, unit_id, qty, unit_cost from standing_order_lines where standing_order_id = v_so.id;
      v_n := v_n + 1;
    end loop;
  end loop;
  perform set_config('app.via_rpc', '', true);
  return v_n;
end $$;

-- Remove future planned occurrences nobody has touched (used on pause/end/edit).
-- Returns how many were removed.
create function clear_untouched_occurrences(p_standing_order_id uuid, p_after date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer; v_ships uuid[];
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  select array_agg(shipment_id) into v_ships from purchase_orders
   where standing_order_id = p_standing_order_id and status = 'draft' and not customized and occurrence_date > p_after;
  delete from purchase_orders
   where standing_order_id = p_standing_order_id and status = 'draft' and not customized and occurrence_date > p_after;
  get diagnostics v_n = row_count;
  delete from shipments s
   where s.id = any(coalesce(v_ships, '{}')) and s.status = 'planned'
     and not exists (select 1 from purchase_orders po where po.shipment_id = s.id);
  perform set_config('app.via_rpc', '', true);
  return v_n;
end $$;

-- Pause / resume / end a standing order.
create function set_standing_order_state(p_id uuid, p_action text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0;
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  if p_action = 'pause' then
    update standing_orders set active = false where id = p_id;
    v_n := clear_untouched_occurrences(p_id);
  elsif p_action = 'end' then
    update standing_orders set active = false, end_date = greatest(start_date, current_date) where id = p_id;
    v_n := clear_untouched_occurrences(p_id);
  elsif p_action = 'resume' then
    update standing_orders set active = true where id = p_id;
    v_n := generate_standing_orders(p_id);
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create view v_shipments with (security_invoker = true) as
select s.*,
       (s.status in ('planned','in_transit') and s.eta < current_date) as is_late,
       coalesce(agg.po_count, 0) as po_count,
       coalesce(agg.value, 0) as value,
       agg.vendors,
       agg.standing
  from shipments s
  left join lateral (
    select count(*) as po_count,
           sum((select coalesce(sum(l.qty * l.unit_cost), 0) from purchase_order_lines l where l.po_id = po.id)
               + po.freight_cost + po.other_cost) as value,
           string_agg(distinct v.name, ', ') as vendors,
           bool_or(po.standing_order_id is not null) as standing
      from purchase_orders po join vendors v on v.id = po.vendor_id
     where po.shipment_id = s.id and po.status <> 'cancelled'
  ) agg on true;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table shipments            enable row level security;
alter table standing_orders      enable row level security;
alter table standing_order_lines enable row level security;

create policy "members read" on shipments            for select to authenticated using (is_member());
create policy "members read" on standing_orders      for select to authenticated using (is_member());
create policy "members read" on standing_order_lines for select to authenticated using (is_member());

create policy "buyers/warehouse insert" on shipments for insert to authenticated with check (has_role('buyer','warehouse'));
create policy "buyers/warehouse update" on shipments for update to authenticated
  using (has_role('buyer','warehouse')) with check (has_role('buyer','warehouse'));
create policy "buyers delete planned" on shipments for delete to authenticated
  using (has_role('buyer') and status = 'planned');

create policy "buyers write" on standing_orders for all to authenticated using (has_role('buyer')) with check (has_role('buyer'));
create policy "buyers write" on standing_order_lines for all to authenticated using (has_role('buyer')) with check (has_role('buyer'));
