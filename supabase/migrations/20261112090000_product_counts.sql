-- Sales gets the same stock, inventory and receiving rights as Warehouse,
-- plus counting and moving a whole product from the Inventory page.

-- ---------------------------------------------------------------------
-- Sales can do what Warehouse does with stock and receiving
-- ---------------------------------------------------------------------

-- These functions only differ in who may call them, so swap the role check
-- in the current definition rather than copying each body here.
do $$
declare
  fn  record;
  def text;
  upd text;
begin
  for fn in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'adjust_lot', 'record_shrink', 'transfer_stock', 'set_lot_spot', 'set_home_location', 'set_home_spot',
      'set_lot_image', 'set_product_image', 'delete_shop_layout', 'import_stock_batch',
      'receive_po', 'receive_po_to_customer', 'receive_shipment', 'set_po_shipment')
  loop
    def := pg_get_functiondef(fn.oid);
    upd := replace(replace(def,
      'has_role(''warehouse'')', 'has_role(''warehouse'',''sales'')'),
      'has_role(''buyer'',''warehouse'')', 'has_role(''buyer'',''warehouse'',''sales'')');
    if upd = def then raise exception 'No warehouse check found in %', fn.proname; end if;
    execute upd;
  end loop;
end $$;

drop policy "warehouse insert" on locations;
drop policy "warehouse update" on locations;
create policy "warehouse insert" on locations for insert to authenticated with check (has_role('warehouse','sales'));
create policy "warehouse update" on locations for update to authenticated
  using (has_role('warehouse','sales')) with check (has_role('warehouse','sales'));

drop policy "warehouse write" on location_sections;
create policy "warehouse write" on location_sections for all to authenticated
  using (has_role('warehouse','sales')) with check (has_role('warehouse','sales'));

drop policy "warehouse insert" on shop_layouts;
drop policy "warehouse update" on shop_layouts;
create policy "warehouse insert" on shop_layouts for insert to authenticated with check (has_role('warehouse','sales'));
create policy "warehouse update" on shop_layouts for update to authenticated
  using (has_role('warehouse','sales')) with check (has_role('warehouse','sales'));

drop policy "warehouse write" on plan_doors;
create policy "warehouse write" on plan_doors for all to authenticated
  using (has_role('warehouse','sales')) with check (has_role('warehouse','sales'));

drop policy "buyers/warehouse insert" on shipments;
drop policy "buyers/warehouse update" on shipments;
create policy "buyers/warehouse insert" on shipments for insert to authenticated
  with check (has_role('buyer','warehouse','sales'));
create policy "buyers/warehouse update" on shipments for update to authenticated
  using (has_role('buyer','warehouse','sales')) with check (has_role('buyer','warehouse','sales'));

-- item photos live in storage, which only exists on the hosted database
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists "item images insert" on storage.objects';
    execute 'drop policy if exists "item images update" on storage.objects';
    execute 'drop policy if exists "item images delete" on storage.objects';
    execute $p$create policy "item images insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'item-images' and public.has_role('buyer', 'warehouse', 'sales'))$p$;
    execute $p$create policy "item images update" on storage.objects for update to authenticated
      using (bucket_id = 'item-images' and public.has_role('buyer', 'warehouse', 'sales'))$p$;
    execute $p$create policy "item images delete" on storage.objects for delete to authenticated
      using (bucket_id = 'item-images' and public.has_role('buyer', 'warehouse', 'sales'))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Count a whole product
-- ---------------------------------------------------------------------

-- A count can touch several lots. Backorders are worked out once at the end
-- instead of after every lot, so the rep gets one message.
create or replace function stock_movement_backorders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.bo_defer', true) = '1' then return null; end if;
  if new.qty_base < 0 and new.kind::text in ('shrink','adjust') then
    perform backorder_shortfall(new.product_id);
  elsif new.qty_base > 0 and new.kind::text in ('receive','adjust','return') then
    perform release_backorders(new.product_id);
  end if;
  return null;
end $$;

-- p_location: only that location's stock (null = every location)
-- p_expected_base: what the person saw on screen; the difference from it is what changes,
--   so stock that moved while they were counting isn't counted twice
-- going up needs p_into_lot (an existing lot) or p_new_lot_location (a new lot at the last cost)
create function count_product(p_product uuid, p_location uuid, p_counted_base numeric, p_expected_base numeric,
                              p_into_lot uuid default null, p_new_lot_location uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_delta   numeric;
  v_on_hand numeric;
  v_need    numeric;
  v_take    numeric;
  v_lot     lots;
  v_cost    numeric;
  v_shelf   integer;
  v_loc     uuid;
begin
  if not has_role('warehouse','sales') then raise exception 'Not authorized'; end if;
  if p_counted_base is null or p_counted_base < 0 then raise exception 'Counted quantity cannot be negative'; end if;
  if p_expected_base is null or p_expected_base < 0 then raise exception 'Missing the on-hand amount you counted against'; end if;
  v_delta := p_counted_base - p_expected_base;
  if v_delta = 0 then return 0; end if;

  perform 1 from lots where product_id = p_product and (p_location is null or location_id = p_location) for update;
  select coalesce(sum(qty_on_hand_base), 0) into v_on_hand
    from lots where product_id = p_product and (p_location is null or location_id = p_location);

  perform set_config('app.bo_defer', '1', true);

  if v_delta < 0 then
    v_need := -v_delta;
    if v_need > v_on_hand then
      raise exception 'Only % on hand now. Refresh and count again.', v_on_hand;
    end if;
    -- oldest stock goes first
    for v_lot in
      select * from lots
      where product_id = p_product and (p_location is null or location_id = p_location) and qty_on_hand_base > 0
      order by received_at, created_at
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_lot.qty_on_hand_base);
      update lots set qty_on_hand_base = qty_on_hand_base - v_take where id = v_lot.id;
      insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
      values (v_lot.id, p_product, v_lot.location_id, 'adjust', -v_take, 'Count', v_lot.lot_code);
      v_need := v_need - v_take;
    end loop;
  elsif p_into_lot is not null then
    select * into v_lot from lots where id = p_into_lot for update;
    if not found or v_lot.product_id <> p_product then raise exception 'That lot isn''t this product'; end if;
    if p_location is not null and v_lot.location_id <> p_location then raise exception 'That lot is in another location'; end if;
    update lots set qty_on_hand_base = qty_on_hand_base + v_delta where id = v_lot.id;
    insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
    values (v_lot.id, p_product, v_lot.location_id, 'adjust', v_delta, 'Count', v_lot.lot_code);
  elsif p_new_lot_location is not null then
    v_loc := coalesce(p_location, p_new_lot_location);
    -- cost from the latest delivery, expiry from the product's shelf life
    select unit_cost_base into v_cost from lots where product_id = p_product order by received_at desc, created_at desc limit 1;
    select shelf_life_days into v_shelf from products where id = p_product;
    insert into lots (product_id, location_id, received_at, expires_at, qty_received_base, qty_on_hand_base, unit_cost_base)
    values (p_product, v_loc, now(), case when v_shelf is not null then current_date + v_shelf end,
            v_delta, v_delta, coalesce(v_cost, 0))
    returning * into v_lot;
    insert into stock_movements (lot_id, product_id, location_id, kind, qty_base, reason, reference)
    values (v_lot.id, p_product, v_loc, 'adjust', v_delta, 'Count (new lot)', v_lot.lot_code);
  else
    raise exception 'Choose a lot for the extra stock, or make a new lot';
  end if;

  perform set_config('app.bo_defer', '', true);
  if v_delta < 0 then
    perform backorder_shortfall(p_product);
  else
    perform release_backorders(p_product);
  end if;
  return v_delta;
end $$;

-- ---------------------------------------------------------------------
-- Move a product from one location to another, all or part, oldest lots first
-- ---------------------------------------------------------------------
create function move_product_stock(p_product uuid, p_from uuid, p_to uuid, p_qty_base numeric) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_have numeric;
  v_need numeric;
  v_take numeric;
  v_lot  lots;
  v_n    integer := 0;
begin
  if not has_role('warehouse','sales') then raise exception 'Not authorized'; end if;
  if p_from is null or p_to is null then raise exception 'Choose where to move it from and to'; end if;
  if p_from = p_to then raise exception 'It''s already in that location'; end if;
  perform 1 from lots where product_id = p_product and location_id = p_from for update;
  select coalesce(sum(qty_on_hand_base), 0) into v_have from lots where product_id = p_product and location_id = p_from;
  if p_qty_base is null or p_qty_base <= 0 or p_qty_base > v_have then
    raise exception 'Quantity must be more than 0 and no more than %', v_have;
  end if;
  v_need := p_qty_base;
  for v_lot in
    select * from lots where product_id = p_product and location_id = p_from and qty_on_hand_base > 0
    order by received_at, created_at
  loop
    exit when v_need <= 0;
    v_take := least(v_need, v_lot.qty_on_hand_base);
    perform transfer_stock(v_lot.id, v_take, p_to);
    v_need := v_need - v_take;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke execute on function count_product(uuid, uuid, numeric, numeric, uuid, uuid), move_product_stock(uuid, uuid, uuid, numeric)
  from public, anon;
grant execute on function count_product(uuid, uuid, numeric, numeric, uuid, uuid), move_product_stock(uuid, uuid, uuid, numeric)
  to authenticated;
