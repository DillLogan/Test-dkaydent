-- Customers who shop on their own login. The value gets its own migration so the next one can use it.
alter type app_role add value if not exists 'customer';
