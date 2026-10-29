-- =====================================================================
-- Receiving records where new stock goes inside its location: a section and shelf can be chosen per line
-- (section_id, shelf in p_lines). Left empty, the item's usual spot is used when the stock goes into its home location.
-- Same as before otherwise. receive_shipment calls this, so it picks the spot up too.
-- =====================================================================

create or replace function receive_po(p_po_id uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po       purchase_orders;
  v_line     purchase_order_lines;
  v_receipt  uuid;
  v_subtotal numeric;
  v_uplift   numeric;
  v_factor   numeric;
  v_qty_base numeric;
  v_shelf    integer;
  v_lot      uuid;
  v_loc      uuid;
  v_sec      uuid;
  v_spot     text;
  v_any      boolean := false;
  r          jsonb;
begin
  if not has_role('buyer','warehouse') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);

  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status not in ('ordered','partially_received') then
    raise exception 'Only ordered purchase orders can be received';
  end if;

  select coalesce(sum(qty * unit_cost), 0) into v_subtotal
    from purchase_order_lines where po_id = p_po_id;
  v_uplift := case when v_subtotal > 0
                   then (v_po.freight_cost + v_po.other_cost) / v_subtotal
                   else 0 end;

  insert into receipts (po_id) values (p_po_id) returning id into v_receipt;

  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((r->>'qty')::numeric, 0) <= 0 then continue; end if;

    select * into v_line from purchase_order_lines
      where id = (r->>'line_id')::uuid and po_id = p_po_id for update;
    if not found then raise exception 'Line is not on this purchase order'; end if;

    v_loc := nullif(r->>'location_id', '')::uuid;
    if v_loc is null then raise exception 'Choose a location for every received line'; end if;

    -- section and shelf: as chosen, else the item's usual spot when it goes into its home location
    v_sec  := nullif(r->>'section_id', '')::uuid;
    v_spot := nullif(btrim(coalesce(r->>'shelf', '')), '');
    if v_sec is null then
      select h.section_id, h.shelf into v_sec, v_spot
        from product_homes h join locations loc on loc.id = v_loc
       where h.product_id = v_line.product_id and h.layout_id = loc.layout_id and h.location_id = v_loc
       limit 1;
    end if;

    select factor into v_factor from product_units where id = v_line.unit_id;
    select shelf_life_days into v_shelf from products where id = v_line.product_id;
    v_qty_base := (r->>'qty')::numeric * v_factor;

    insert into lots (lot_code, product_id, location_id, section_id, shelf, po_line_id, receipt_id,
                      expires_at, qty_received_base, qty_on_hand_base, unit_cost_base)
    values (
      coalesce(nullif(r->>'lot_code', ''), 'L' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('lot_seq')::text, 4, '0')),
      v_line.product_id, v_loc, v_sec, v_spot, v_line.id, v_receipt,
      coalesce(nullif(r->>'expires_at', '')::date,
               case when v_shelf is not null then current_date + v_shelf end),
      v_qty_base, v_qty_base,
      (v_line.unit_cost / v_factor) * (1 + v_uplift))
    returning id into v_lot;

    insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reference)
    values (v_lot, v_line.product_id, v_loc, 'receive', v_qty_base, v_po.po_number);

    update purchase_order_lines
       set qty_received_base = qty_received_base + v_qty_base
     where id = v_line.id;
    v_any := true;
  end loop;

  if not v_any then raise exception 'Enter a quantity for at least one line'; end if;

  update purchase_orders
     set status = case when exists (
           select 1 from purchase_order_lines l
             join product_units u on u.id = l.unit_id
            where l.po_id = p_po_id and l.qty_received_base < l.qty * u.factor)
         then 'partially_received'::po_status else 'received'::po_status end
   where id = p_po_id;

  return v_receipt;
end $$;
