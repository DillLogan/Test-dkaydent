-- Order steps: Draft -> Ready to pull -> Pulled -> Completed -> Invoiced.
-- "Completed" is the orders manager's check after the pull ticket comes back.
-- Enum values are added in their own migration so the next one can use them.
alter type so_status add value if not exists 'completed' after 'fulfilled';
alter type app_role  add value if not exists 'orders_manager';
