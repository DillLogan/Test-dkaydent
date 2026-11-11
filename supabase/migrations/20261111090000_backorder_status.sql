-- own migration: a new enum value can't be used in the same transaction it's added in
alter type so_status add value if not exists 'backorder' after 'draft';
