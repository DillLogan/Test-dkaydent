-- One route sheet per delivery day, shop and route code ('' means the whole day, as before).
alter table route_sheets add column route_code text not null default '' check (route_code ~ '^[A-Z]{0,3}$');
alter table route_sheets drop constraint route_sheets_route_date_layout_id_key;
alter table route_sheets add constraint route_sheets_day_shop_route_key unique (route_date, layout_id, route_code);
