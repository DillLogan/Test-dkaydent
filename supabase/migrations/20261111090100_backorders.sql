-- Backorders.
-- When stock goes down (shrink, count correction, web sync) and what's left can't cover the
-- Ready-to-pull tickets, the shortfall comes off the newest tickets onto a "backorder" ticket
-- for the same customer. The original is held until its rep confirms it. Once the rep confirms
-- the backorder, purchasing is told and sets the date stock is due. When stock is actually in,
-- the backorder goes back to Ready to pull; if only part is in, what's covered goes and the rest
-- moves to a new backorder (still confirmed, purchasing dates it again).

alter table sales_orders
  add column backorder_of    uuid references sales_orders(id) on delete set null,
  add column backorder_hold  boolean not null default false,
  add column hold_note       text,
  add column bo_confirmed_at timestamptz,
  add column bo_confirmed_by uuid references profiles(id) on delete set null,
  add column stock_due       date,
  add column stock_due_by    uuid references profiles(id) on delete set null,
  add column released_at     timestamptz;
create index sales_orders_backorder_of_idx on sales_orders (backorder_of) where backorder_of is not null;

-- messages the app sends itself have no sender (shown as "DKaydent alerts")
alter table chat_messages alter column sender_id drop not null;

-- "backorder" is set and left only through the functions below
create or replace function guard_status() returns trigger
language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = '1';
begin
  if new.status is distinct from old.status and not v_rpc then
    if new.status::text in ('partially_received','received','fulfilled','completed','invoiced','backorder')
       or old.status::text in ('partially_received','received','fulfilled','completed','invoiced','cancelled','backorder') then
      raise exception 'Status cannot be changed from % to % directly', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create function guard_backorder_cols() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1'
     and (new.backorder_of, new.backorder_hold, new.bo_confirmed_at, new.stock_due, new.released_at)
         is distinct from (old.backorder_of, old.backorder_hold, old.bo_confirmed_at, old.stock_due, old.released_at) then
    raise exception 'Backorder details can only be changed with the backorder buttons';
  end if;
  -- a held order can't be pulled
  if new.status = 'fulfilled' and old.status <> 'fulfilled' and old.backorder_hold then
    raise exception '% is on hold: items were moved to a backorder. The sales rep has to confirm it first', old.so_number;
  end if;
  return new;
end $$;
create trigger sales_orders_backorder_guard before update on sales_orders
  for each row execute function guard_backorder_cols();

-- ---------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------

create function bo_team_post(p_role app_role, p_body text, p_as_system boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_ch uuid;
begin
  select id into v_ch from chat_channels where kind = 'team' and team_role = p_role order by created_at limit 1;
  if v_ch is null then return; end if;
  insert into chat_messages (channel_id, sender_id, body)
    values (v_ch, case when p_as_system then null else auth.uid() end, left(p_body, 4000));
end $$;

-- DM from whoever made the change to the customer's rep. No person (web sync), or no rep:
-- an alert in the Sales channel. The rep doing it themselves gets no message (they know).
create function bo_tell_rep(p_customer uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare v_rep uuid; v_me uuid := auth.uid(); v_key text; v_ch uuid; v_name text;
begin
  -- an inactive rep counts as no rep
  select p.id, coalesce(nullif(trim(p.full_name), ''), p.email) into v_rep, v_name
    from customers c left join profiles p on p.id = c.rep_id and p.active
   where c.id = p_customer;
  if v_rep is not null and v_me = v_rep then return; end if;
  if v_rep is null or v_me is null or not exists (select 1 from profiles where id = v_me and active) then
    perform bo_team_post('sales', case when v_rep is null then '' else '@' || v_name || ' ' end || p_body, true);
    return;
  end if;
  v_key := least(v_me::text, v_rep::text) || ':' || greatest(v_me::text, v_rep::text);
  select id into v_ch from chat_channels where dm_key = v_key;
  if v_ch is null then
    insert into chat_channels (kind, dm_key, created_by) values ('dm', v_key, v_me) returning id into v_ch;
    insert into chat_members (channel_id, user_id) values (v_ch, v_me), (v_ch, v_rep);
  end if;
  insert into chat_messages (channel_id, sender_id, body) values (v_ch, v_me, left(p_body, 4000));
end $$;

-- ---------------------------------------------------------------------
-- stock math (base units)
-- ---------------------------------------------------------------------

create function bo_on_hand(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty_on_hand_base), 0) from lots where product_id = p_product;
$$;

-- what Ready-to-pull tickets need
create function bo_committed(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.qty * u.factor), 0)
    from sales_order_lines l
    join sales_orders so on so.id = l.so_id
    join product_units u on u.id = l.unit_id
   where l.product_id = p_product and so.status = 'confirmed';
$$;

-- "4 bunch Freedom rose 60cm, 1 box Eucalyptus"
create function bo_lines_text(p_so uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(trim_scale(l.qty)::text || ' ' || u.name || ' ' || p.name, ', ' order by p.name), '')
    from sales_order_lines l join product_units u on u.id = l.unit_id join products p on p.id = l.product_id
   where l.so_id = p_so;
$$;

-- ---------------------------------------------------------------------
-- split shortfalls off onto backorders
-- ---------------------------------------------------------------------

create function backorder_shortfall(p_product uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_prev  text := coalesce(current_setting('app.via_rpc', true), '');
  v_short numeric;
  r       record;
  v_move  numeric;
  v_bo    uuid;
  v_line  uuid;
  v_pname text;
  v_hit   jsonb := '{}';
  k       text;
  v_so    sales_orders;
  v_bonum text;
begin
  v_short := bo_committed(p_product) - bo_on_hand(p_product);
  if v_short <= 0 then return 0; end if;
  select name into v_pname from products where id = p_product;
  perform set_config('app.via_rpc', '1', true);

  -- newest orders give up stock first
  for r in select l.id, l.so_id, l.qty, l.unit_id, l.unit_price, u.factor, u.name as unit_name
             from sales_order_lines l
             join sales_orders so on so.id = l.so_id
             join product_units u on u.id = l.unit_id
            where l.product_id = p_product and so.status = 'confirmed'
            order by so.created_at desc, so.id desc, l.created_at desc, l.id desc loop
    exit when v_short <= 0;
    -- whole units come off when the line is in whole units, so what stays is fully covered
    v_move := least(r.qty, case when r.qty = trunc(r.qty) then ceil(v_short / r.factor) else v_short / r.factor end);
    if v_move <= 0 then continue; end if;

    select * into v_so from sales_orders where id = r.so_id;
    select id into v_bo from sales_orders where backorder_of = r.so_id and status = 'backorder' order by created_at limit 1;
    if v_bo is null then
      insert into sales_orders (customer_id, status, backorder_of, payment_type, notes, delivery_address, layout_id, created_by)
        values (v_so.customer_id, 'backorder', v_so.id, v_so.payment_type, 'Backorder from ' || v_so.so_number,
                v_so.delivery_address, v_so.layout_id, auth.uid())
        returning id into v_bo;
    end if;
    select id into v_line from sales_order_lines
     where so_id = v_bo and product_id = p_product and unit_id = r.unit_id and unit_price = r.unit_price limit 1;
    if v_line is null then
      insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
        values (v_bo, p_product, r.unit_id, v_move, r.unit_price);
    else
      update sales_order_lines set qty = qty + v_move where id = v_line;
    end if;

    if v_move >= r.qty then delete from sales_order_lines where id = r.id;
    else update sales_order_lines set qty = qty - v_move where id = r.id; end if;

    select so_number into v_bonum from sales_orders where id = v_bo;
    update sales_orders
       set backorder_hold = true,
           hold_note = concat_ws('; ', hold_note, trim_scale(v_move)::text || ' ' || r.unit_name || ' ' || v_pname || ' moved to ' || v_bonum)
     where id = r.so_id;
    v_hit := v_hit || jsonb_build_object(r.so_id::text, coalesce(v_hit->r.so_id::text, '[]'::jsonb)
                                         || to_jsonb(trim_scale(v_move)::text || ' ' || r.unit_name || ' ' || v_pname));
    v_short := v_short - v_move * r.factor;
  end loop;

  for k in select jsonb_object_keys(v_hit) loop
    select * into v_so from sales_orders where id = k::uuid;
    select so_number into v_bonum from sales_orders where backorder_of = v_so.id and status = 'backorder' order by created_at limit 1;
    perform bo_tell_rep(v_so.customer_id,
      v_so.so_number || ' (' || (select name from customers where id = v_so.customer_id) || ') is on hold. Stock was removed, so '
      || (select string_agg(x, ', ') from jsonb_array_elements_text(v_hit->k) x)
      || ' came off it and went onto backorder ' || coalesce(v_bonum, '') || '. Please confirm both orders in the app.');
  end loop;

  perform set_config('app.via_rpc', v_prev, true);
  return (select count(*) from jsonb_object_keys(v_hit));
end $$;
revoke all on function backorder_shortfall(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- back to Ready to pull when the stock is really in
-- ---------------------------------------------------------------------

create function release_backorders(p_product uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_prev  text := coalesce(current_setting('app.via_rpc', true), '');
  b       sales_orders;
  r       record;
  v_avail jsonb;
  v_have  numeric;
  v_give  numeric;
  v_any   boolean;
  v_short boolean;
  v_rest  uuid;
  v_rnum  text;
  v_cust  text;
  v_n     integer := 0;
begin
  -- only backorders the rep has confirmed; oldest first
  for b in select so.* from sales_orders so
            where so.status = 'backorder' and so.bo_confirmed_at is not null
              and (p_product is null or exists (select 1 from sales_order_lines l where l.so_id = so.id and l.product_id = p_product))
            order by so.created_at, so.id loop
    if not exists (select 1 from sales_order_lines where so_id = b.id) then continue; end if;
    -- stock not already on a ticket, per item on this backorder
    select jsonb_object_agg(product_id, bo_on_hand(product_id) - bo_committed(product_id)) into v_avail
      from (select distinct product_id from sales_order_lines where so_id = b.id) t;
    v_any := false; v_short := false; v_rest := null;
    perform set_config('app.via_rpc', '1', true);
    for r in select l.*, u.factor from sales_order_lines l join product_units u on u.id = l.unit_id
              where l.so_id = b.id order by l.created_at, l.id loop
      v_have := greatest((v_avail->>r.product_id::text)::numeric, 0);
      v_give := least(r.qty, case when r.qty = trunc(r.qty) then floor(v_have / r.factor) else v_have / r.factor end);
      v_avail := jsonb_set(v_avail, array[r.product_id::text], to_jsonb(v_have - v_give * r.factor));
      if v_give > 0 then v_any := true; end if;
      if v_give < r.qty then
        v_short := true;
        if v_rest is null then
          -- what's still missing: a new backorder, still confirmed, due date to be set again
          insert into sales_orders (customer_id, status, backorder_of, payment_type, notes, delivery_address, layout_id,
                                    bo_confirmed_at, bo_confirmed_by, created_by)
            values (b.customer_id, 'backorder', b.backorder_of, b.payment_type, b.notes, b.delivery_address, b.layout_id,
                    b.bo_confirmed_at, b.bo_confirmed_by, auth.uid())
            returning id into v_rest;
        end if;
        insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
          values (v_rest, r.product_id, r.unit_id, r.qty - v_give, r.unit_price);
        if v_give > 0 then update sales_order_lines set qty = v_give where id = r.id;
        else delete from sales_order_lines where id = r.id; end if;
      end if;
    end loop;
    if not v_any then
      -- nothing in yet, put it back the way it was
      if v_rest is not null then
        update sales_order_lines set so_id = b.id where so_id = v_rest;
        delete from sales_orders where id = v_rest;
      end if;
      perform set_config('app.via_rpc', v_prev, true);
      continue;
    end if;
    update sales_orders set status = 'confirmed', released_at = now() where id = b.id;
    perform set_config('app.via_rpc', v_prev, true);
    select name into v_cust from customers where id = b.customer_id;
    if v_short then
      select so_number into v_rnum from sales_orders where id = v_rest;
      perform bo_tell_rep(b.customer_id, 'Part of backorder ' || b.so_number || ' (' || v_cust || ') is in: '
        || bo_lines_text(b.id) || ' is now Ready to pull. The rest (' || bo_lines_text(v_rest) || ') moved to backorder ' || v_rnum || '.');
      perform bo_team_post('buyer', 'Backorder ' || v_rnum || ' for ' || v_cust || ' is what''s still missing from '
        || b.so_number || ': ' || bo_lines_text(v_rest) || '. Please set when the stock is due (Purchasing > Backorders).');
    else
      perform bo_tell_rep(b.customer_id, 'Stock is in: backorder ' || b.so_number || ' (' || v_cust || ') is now Ready to pull.');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function release_backorders(uuid) from public, anon, authenticated;

create function stock_movement_backorders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.qty_base < 0 and new.kind::text in ('shrink','adjust') then
    perform backorder_shortfall(new.product_id);
  elsif new.qty_base > 0 and new.kind::text in ('receive','adjust','return') then
    perform release_backorders(new.product_id);
  end if;
  return null;
end $$;
create trigger stock_movements_backorders after insert on stock_movements
  for each row execute function stock_movement_backorders();

-- ---------------------------------------------------------------------
-- buttons
-- ---------------------------------------------------------------------

-- rep: the held original can go out without what came off it
create function confirm_hold(p_so uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so for update;
  if not found then raise exception 'Order not found'; end if;
  if not v_so.backorder_hold then raise exception '% isn''t on hold', v_so.so_number; end if;
  -- an emptied ticket stays (empty) for the rep to cancel or add to
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set backorder_hold = false where id = p_so;
  perform set_config('app.via_rpc', '', true);
end $$;

-- rep: keep the backorder; purchasing is told and stock already in releases it straight away
create function confirm_backorder(p_so uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_orig text;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so for update;
  if not found or v_so.status <> 'backorder' then raise exception 'That isn''t an open backorder'; end if;
  if v_so.bo_confirmed_at is not null then raise exception '% is already confirmed', v_so.so_number; end if;
  if not exists (select 1 from sales_order_lines where so_id = p_so) then raise exception '% has nothing on it', v_so.so_number; end if;
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set bo_confirmed_at = now(), bo_confirmed_by = auth.uid() where id = p_so;
  perform set_config('app.via_rpc', '', true);
  select so_number into v_orig from sales_orders where id = v_so.backorder_of;
  perform bo_team_post('buyer', 'Backorder ' || v_so.so_number || ' for ' || (select name from customers where id = v_so.customer_id)
    || coalesce(' (from ' || v_orig || ')', '') || ' is confirmed: ' || bo_lines_text(p_so)
    || '. Please set when the stock is due (Purchasing > Backorders).');
  perform release_backorders(null);
end $$;

create function cancel_backorder(p_so uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so for update;
  if not found or v_so.status <> 'backorder' then raise exception 'That isn''t an open backorder'; end if;
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set status = 'cancelled' where id = p_so;
  perform set_config('app.via_rpc', '', true);
end $$;

-- purchasing: when the stock should be in
create function set_stock_due(p_so uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('buyer') then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so for update;
  if not found or v_so.status <> 'backorder' then raise exception 'That isn''t an open backorder'; end if;
  if p_date is not null and p_date < current_date then raise exception 'Pick today or a later date'; end if;
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set stock_due = p_date, stock_due_by = auth.uid() where id = p_so;
  perform set_config('app.via_rpc', '', true);
end $$;

-- the latest of each item's next incoming date (shipment ETA, else PO expected date); null if any item isn't coming
create function backorder_suggested_due(p_so uuid) returns date
language sql stable security definer set search_path = public as $$
  select case when bool_and(d is not null) then max(d) end
    from (select l.product_id,
                 (select min(coalesce(sh.eta, po.expected_date))
                    from purchase_order_lines pl
                    join purchase_orders po on po.id = pl.po_id
                    join product_units u on u.id = pl.unit_id
                    left join shipments sh on sh.id = po.shipment_id and sh.status not in ('received','cancelled')
                   where pl.product_id = l.product_id
                     and po.status in ('draft','ordered','partially_received')
                     and pl.qty_received_base < pl.qty * u.factor
                     and coalesce(sh.eta, po.expected_date) is not null) d
            from sales_order_lines l where l.so_id = p_so) t;
$$;

revoke execute on function confirm_hold(uuid), confirm_backorder(uuid), cancel_backorder(uuid), set_stock_due(uuid, date),
  backorder_suggested_due(uuid) from public, anon;
grant execute on function confirm_hold(uuid), confirm_backorder(uuid), cancel_backorder(uuid), set_stock_due(uuid, date),
  backorder_suggested_due(uuid) to authenticated;
revoke all on function bo_team_post(app_role, text, boolean), bo_tell_rep(uuid, text), bo_on_hand(uuid), bo_committed(uuid),
  bo_lines_text(uuid) from public, anon, authenticated;
