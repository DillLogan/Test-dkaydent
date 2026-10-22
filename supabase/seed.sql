-- Starter data for local development (supabase db reset runs this).
-- Safe to edit or skip in production.

insert into locations (name, kind, temp_c) values
  ('Cooler 1', 'cooler', 2),
  ('Cooler 2', 'cooler', 4),
  ('Hard Goods Shelf A', 'shelf', null),
  ('Receiving Dock', 'dock', null);

insert into price_tiers (name, markup_pct) values
  ('Retail Florist', 40),
  ('Event Designer', 35),
  ('Volume Wholesale', 25);

insert into products (sku, name, kind, category, variety, color, grade, stem_length_cm, base_unit, shelf_life_days, reorder_point_base) values
  ('RO-FRE-60', 'Rose Freedom 60cm', 'flower', 'Roses', 'Freedom', 'Red', 'Premium', 60, 'stem', 10, 500),
  ('RO-PLA-50', 'Rose Playa Blanca 50cm', 'flower', 'Roses', 'Playa Blanca', 'White', 'Select', 50, 'stem', 10, 300),
  ('HY-WHT', 'Hydrangea White Jumbo', 'flower', 'Hydrangea', null, 'White', 'Jumbo', null, 'stem', 7, 60),
  ('EU-SDL', 'Eucalyptus Silver Dollar', 'flower', 'Greens', 'Silver Dollar', 'Green', null, null, 'stem', 14, 200);

insert into products (sku, name, kind, category, base_unit, reorder_point_base) values
  ('HG-VASE-CYL8', 'Glass Cylinder Vase 8in', 'hard_good', 'Vases', 'each', 48),
  ('HG-FOAM-BRICK', 'Floral Foam Brick', 'hard_good', 'Mechanics', 'each', 96),
  ('HG-RIB-SAT15', 'Satin Ribbon 1.5in Ivory', 'hard_good', 'Ribbon', 'roll', 24);

-- Purchase / sale units (base units were created automatically)
insert into product_units (product_id, name, factor)
select id, 'bunch', 25 from products where sku in ('RO-FRE-60','RO-PLA-50')
union all select id, 'box', 250 from products where sku in ('RO-FRE-60','RO-PLA-50')
union all select id, 'box', 30 from products where sku = 'HY-WHT'
union all select id, 'bunch', 10 from products where sku = 'EU-SDL'
union all select id, 'case', 12 from products where sku = 'HG-VASE-CYL8'
union all select id, 'case', 48 from products where sku = 'HG-FOAM-BRICK'
union all select id, 'case', 12 from products where sku = 'HG-RIB-SAT15';

insert into vendors (name, kind, country, payment_terms) values
  ('Andes Rose Farms', 'grower', 'Ecuador', 'Net 15'),
  ('Sunvalley Hydrangea Co.', 'grower', 'Colombia', 'Net 15'),
  ('Coastal Floral Supply', 'supplier', 'USA', 'Net 30');

insert into customers (name, contact_name, price_tier_id, payment_terms_days)
select 'Bloom & Vine Florist', 'Front desk', id, 30 from price_tiers where name = 'Retail Florist'
union all
select 'Evergreen Events', 'Planning team', id, 15 from price_tiers where name = 'Event Designer';

-- Shop floor plan: display areas plus where each location sits (percent of plan)
insert into locations (name, kind, temp_c) values ('Front Display Cooler', 'cooler', 3), ('Greens Rack', 'shelf', null);
update locations set map_x = 4,  map_y = 6,  map_w = 30, map_h = 34, map_color = '#2e5234' where name = 'Cooler 1';
update locations set map_x = 38, map_y = 6,  map_w = 26, map_h = 34, map_color = '#3d6b8f' where name = 'Cooler 2';
update locations set map_x = 70, map_y = 6,  map_w = 26, map_h = 22, map_color = '#8a6d3b' where name = 'Receiving Dock';
update locations set map_x = 4,  map_y = 60, map_w = 22, map_h = 34, map_color = '#7a5c99' where name = 'Hard Goods Shelf A';
update locations set map_x = 28, map_y = 60, map_w = 22, map_h = 34, map_color = '#9a4d6b' where name = 'Hard Goods Shelf B';
update locations set map_x = 56, map_y = 52, map_w = 40, map_h = 18, map_color = '#b0543a' where name = 'Front Display Cooler';
update locations set map_x = 56, map_y = 76, map_w = 40, map_h = 18, map_color = '#5f7f3a' where name = 'Greens Rack';

insert into product_homes (product_id, layout_id, location_id)
select p.id, l.layout_id, l.id from products p, locations l
 where (p.category = 'Roses' and l.name = 'Cooler 1')
    or (p.category = 'Hydrangea' and l.name = 'Cooler 2')
    or (p.category = 'Greens' and l.name = 'Greens Rack')
    or (p.sku = 'HG-VASE-CYL8' and l.name = 'Hard Goods Shelf A')
    or (p.sku in ('HG-FOAM-BRICK', 'HG-RIB-SAT15') and l.name = 'Hard Goods Shelf B');
