-- Pull sheet hand-offs and box labels.
--   returned   Delivery/Order Management found a problem on a pulled order and sent it back to sales.
--              Sales fixes the lines (quantities can only go down; the difference goes back on the shelf),
--              then sends it on, and it returns to the pulled step for Delivery/Order Management to check.
--   label_count  how many box labels were printed for the order (also a line on the pull sheet)
alter table sales_orders
  add column returned_note text,
  add column returned_at   timestamptz,
  add column returned_by   uuid references profiles(id),
  add column label_count   integer check (label_count is null or label_count between 0 and 500);

create or replace function guard_status() returns trigger
language plpgsql as $$
declare v_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = '1';
begin
  if new.status is distinct from old.status and not v_rpc then
    if new.status::text in ('partially_received','received','fulfilled','returned','completed','invoiced')
       or old.status::text in ('partially_received','received','returned','completed','invoiced','cancelled') then
      raise exception 'Status cannot be changed from % to % directly', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Delivery/Order Management sends a pulled order back to sales, with a note saying what is wrong
create function return_to_sales(p_so_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('orders_manager') then raise exception 'Only Delivery/Order Management can send an order back to sales'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note saying what sales needs to fix'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'fulfilled' then raise exception 'Only pulled orders can be sent back to sales'; end if;
  update sales_orders set status = 'returned', returned_note = left(trim(p_note), 500), returned_at = now(), returned_by = auth.uid()
   where id = p_so_id;
end $$;

-- Sales lowers a quantity on a returned order. The difference goes back to the lots it came from (newest first).
create function adjust_returned_line(p_so_id uuid, p_line_id uuid, p_new_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_line record; v_back numeric; v_alloc record; v_take numeric;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can edit a returned order'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'returned' then raise exception 'Only orders sent back to sales can be edited'; end if;
  select l.*, u.factor into v_line from sales_order_lines l join product_units u on u.id = l.unit_id
   where l.id = p_line_id and l.so_id = p_so_id for update of l;
  if not found then raise exception 'That line is not on this order'; end if;
  if p_new_qty is null or p_new_qty < 0 then raise exception 'Quantity cannot be negative'; end if;
  if p_new_qty > v_line.qty then raise exception 'The quantity cannot be more than was pulled (%). Add a new order for extras.', v_line.qty; end if;
  if exists (select 1 from return_lines where so_line_id = p_line_id) then raise exception 'This line already has a customer return'; end if;
  v_back := (v_line.qty - p_new_qty) * v_line.factor;
  for v_alloc in
    select a.id, a.lot_id, a.qty_base, l.location_id
      from sales_allocations a join lots l on l.id = a.lot_id
     where a.so_line_id = p_line_id order by l.received_at desc, a.id
  loop
    exit when v_back <= 0;
    v_take := least(v_back, v_alloc.qty_base);
    update lots set qty_on_hand_base = qty_on_hand_base + v_take where id = v_alloc.lot_id;
    insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
      values (v_alloc.lot_id, v_line.product_id, v_alloc.location_id, 'return', v_take, 'Order edited after pulling', v_so.so_number);
    if v_take >= v_alloc.qty_base then delete from sales_allocations where id = v_alloc.id;
    else update sales_allocations set qty_base = qty_base - v_take where id = v_alloc.id; end if;
    v_back := v_back - v_take;
  end loop;
  if v_back > 0 then raise exception 'Could not match the change to the lots this order was pulled from'; end if;
  if p_new_qty = 0 then
    delete from sales_order_lines where id = p_line_id;
  else
    update sales_order_lines set qty = p_new_qty,
           cost_total = coalesce((select sum(qty_base * unit_cost_base) from sales_allocations where so_line_id = p_line_id), 0)
     where id = p_line_id;
  end if;
end $$;

-- Sales sends the fixed order back to Delivery/Order Management
create function resubmit_returned(p_so_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can send it on'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'returned' then raise exception 'Only orders sent back to sales can be sent on'; end if;
  if not exists (select 1 from sales_order_lines where so_id = p_so_id) then raise exception 'The order has no lines left. Cancel it with a return instead.'; end if;
  update sales_orders set status = 'fulfilled' where id = p_so_id;
end $$;

-- Box labels: how many were printed
create function set_label_count(p_so_id uuid, p_count integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('sales', 'warehouse', 'orders_manager') then raise exception 'Not authorized'; end if;
  if p_count is null or p_count < 0 or p_count > 500 then raise exception 'Enter how many labels, from 0 to 500'; end if;
  update sales_orders set label_count = p_count where id = p_so_id and status not in ('invoiced', 'cancelled');
  if not found then raise exception 'That order is closed or does not exist'; end if;
end $$;

revoke execute on function return_to_sales(uuid, text), adjust_returned_line(uuid, uuid, numeric),
  resubmit_returned(uuid), set_label_count(uuid, integer) from public, anon;
grant execute on function return_to_sales(uuid, text), adjust_returned_line(uuid, uuid, numeric),
  resubmit_returned(uuid), set_label_count(uuid, integer) to authenticated;
