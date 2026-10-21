-- New stock movement kind for customer returns.
-- Kept in its own migration: a new enum value can't be used in the
-- same transaction that adds it.
alter type movement_kind add value if not exists 'return';
