-- =====================================================================
-- Free-form floor plan areas and real measurements.
--   * locations.map_shape: the area's outline as [[x, y], …] points in
--     percent of the plan's width / height (0–100). map_x/y/w/h stay as its
--     bounding box, kept in step by the app.
--   * shop_layouts.width_ft / height_ft: the floor's real size, so areas
--     can be shown and typed in feet.
-- =====================================================================

alter table locations add column map_shape jsonb
  check (map_shape is null or (jsonb_typeof(map_shape) = 'array' and jsonb_array_length(map_shape) between 3 and 60));

-- Existing rectangles become four-point shapes
update locations
   set map_shape = jsonb_build_array(
         jsonb_build_array(map_x, map_y),
         jsonb_build_array(map_x + map_w, map_y),
         jsonb_build_array(map_x + map_w, map_y + map_h),
         jsonb_build_array(map_x, map_y + map_h))
 where map_x is not null and map_w is not null;

alter table shop_layouts
  add column width_ft  numeric check (width_ft is null or (width_ft > 0 and width_ft <= 5000)),
  add column height_ft numeric check (height_ft is null or (height_ft > 0 and height_ft <= 5000));

-- A section moved to another shop leaves its old plan (shape included)
create or replace function location_layout_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.layout_id is distinct from old.layout_id then
    delete from product_homes where location_id = old.id;
    new.map_x := null; new.map_y := null; new.map_w := null; new.map_h := null; new.map_shape := null;
  end if;
  return new;
end $$;
