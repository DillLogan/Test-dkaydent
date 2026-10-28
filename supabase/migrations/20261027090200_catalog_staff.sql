-- Sales catalog: every active item for one customer, with the price that customer would pay.
create function catalog_staff(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tier uuid; v_disc numeric;
begin
  if not has_role('sales') then raise exception 'Only sales or an admin can open the sales catalog'; end if;
  select price_tier_id, discount_pct into v_tier, v_disc from customers where id = p_customer_id;
  return coalesce((
    select jsonb_agg(r order by r->>'category', r->>'name', (r->>'factor')::numeric)
    from (
      select jsonb_build_object(
        'unit_id', u.id, 'product_id', p.id, 'sku', p.sku, 'name', p.name, 'kind', p.kind,
        'category', coalesce(p.category, 'Other'), 'unit', u.name, 'factor', u.factor,
        'price', coalesce(customer_unit_price(p_customer_id, u.id), 0),
        'list_price', coalesce(customer_list_price(p_customer_id, u.id), 0),
        'tier_price', (select tp.price from tier_prices tp where tp.tier_id = v_tier and tp.product_unit_id = u.id),
        'special_price', (select cp.price from customer_prices cp where cp.customer_id = p_customer_id and cp.product_unit_id = u.id),
        'special', exists (select 1 from customer_prices cp where cp.customer_id = p_customer_id and cp.product_unit_id = u.id),
        'discount_pct', v_disc,
        'available', floor(product_available_base(p.id) / u.factor)) as r
      from products p join product_units u on u.product_id = p.id
      where p.active
    ) s), '[]'::jsonb);
end $$;
revoke all on function catalog_staff(uuid) from public, anon;
grant execute on function catalog_staff(uuid) to authenticated;
