-- =====================================================================
-- MUST CHECK: a sales rep flags an order to be checked and signed off.
-- Shown in red in the order's top-right corner and on its pull ticket.
-- =====================================================================
alter table sales_orders add column must_check boolean not null default false;

-- Flagging a planned recurring order counts as editing it (so pausing keeps it)
create or replace function mark_so_customized() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') <> '1'
     and new.recurring_id is not null
     and (new.ship_date, new.notes, new.customer_id, new.status, new.must_check)
         is distinct from (old.ship_date, old.notes, old.customer_id, old.status, old.must_check) then
    new.customized := true;
  end if;
  return new;
end $$;
