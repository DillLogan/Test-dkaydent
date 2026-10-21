-- =====================================================================
-- Payments (card / cash / check / other, partial payments, deposits),
-- Valor payment terminals, counter sales, and terminal sales sync.
-- Using a terminal is always optional: any payment can be recorded by hand.
-- =====================================================================

create type payment_method      as enum ('card','cash','check','other');
create type payment_kind        as enum ('payment','deposit');
create type terminal_purpose    as enum ('invoice','deposit','counter');
create type terminal_req_status as enum ('pending','approved','declined','timeout','cancelled','error');

-- Where a sale came from: a normal order, the counter screen, or a sale rung up on a terminal.
alter table sales_orders add column channel text not null default 'order'
  check (channel in ('order','counter','terminal'));

create table payment_terminals (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  model      text not null check (model in ('VP550','VP800','VL100','VL110','VL500','VL550','Other')),
  epi        text not null unique,              -- Valor terminal identifier (EPI)
  serial_no  text,
  connection text not null default 'cloud' check (connection in ('cloud','lan')),
  lan_host   text,                              -- for LAN (TCP/WebSocket) terminals
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence payment_number_seq start 1001;

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  payment_number      text not null unique default ('PAY-' || nextval('payment_number_seq')),
  customer_id         uuid not null references customers(id),
  so_id               uuid references sales_orders(id),
  invoice_id          uuid references invoices(id),
  kind                payment_kind not null,
  method              payment_method not null,
  amount              numeric not null check (amount > 0),
  tip                 numeric not null default 0 check (tip >= 0),
  reference           text,                     -- check number, approval code, note
  card_brand          text,
  card_last4          text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  auth_code           text,
  terminal_id         uuid references payment_terminals(id),
  terminal_request_id uuid,
  external_txn_id     text unique,              -- Valor transaction id (dedupes syncs)
  status              text not null default 'completed' check (status in ('completed','voided')),
  voided_at           timestamptz,
  received_at         timestamptz not null default now(),
  notes               text,
  created_by          uuid references profiles(id) default auth.uid(),
  created_at          timestamptz not null default now()
);
create index payments_so_idx on payments (so_id);
create index payments_invoice_idx on payments (invoice_id);

create table terminal_requests (
  id           uuid primary key default gen_random_uuid(),
  terminal_id  uuid not null references payment_terminals(id),
  provider     text not null check (provider in ('simulator','valor')),
  purpose      terminal_purpose not null,
  so_id        uuid references sales_orders(id),
  invoice_id   uuid references invoices(id),
  amount       numeric not null check (amount > 0),
  tip_entry    boolean not null default false,
  tax_rate     numeric not null default 0,      -- counter sales: applied when invoicing
  req_txn_id   text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  invoice_ref  text,                            -- sent as INVOICENUMBER
  status       terminal_req_status not null default 'pending',
  provider_ref text,                            -- e.g. STAN / transaction id from Valor
  message      text,
  response     jsonb,
  payment_id   uuid references payments(id),
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index terminal_requests_status_idx on terminal_requests (status, created_at desc);
alter table payments add constraint payments_terminal_request_fk
  foreign key (terminal_request_id) references terminal_requests(id);

-- Item names on terminal sales mapped to products, remembered for next sync.
create table terminal_item_map (
  id          uuid primary key default gen_random_uuid(),
  item_key    text not null unique,             -- lower(trim(name or sku from the terminal))
  product_id  uuid not null references products(id) on delete cascade,
  unit_id     uuid not null,
  created_at  timestamptz not null default now(),
  foreign key (unit_id, product_id) references product_units(id, product_id)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- The webhook runs with the service role (no user); allow it where noted.
create function is_service_role() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
$$;

-- What the order is worth: its active invoice total, or the line total before invoicing.
create function so_total(p_so_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select total from invoices where so_id = p_so_id and status <> 'void' limit 1),
    (select round(coalesce(sum(qty * unit_price), 0), 2) from sales_order_lines where so_id = p_so_id))
$$;

create function so_paid(p_so_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from payments where so_id = p_so_id and status = 'completed'
$$;

-- Mark an open invoice paid once payments (incl. deposits) cover it.
create function settle_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_inv invoices;
begin
  select * into v_inv from invoices where id = p_invoice_id;
  if v_inv.status = 'open' and so_paid(v_inv.so_id) >= v_inv.total - 0.005 then
    update invoices set status = 'paid', paid_at = current_date where id = p_invoice_id;
  elsif v_inv.status = 'paid' and so_paid(v_inv.so_id) < v_inv.total - 0.005
        and exists (select 1 from payments where so_id = v_inv.so_id) then
    update invoices set status = 'open', paid_at = null where id = p_invoice_id;
  end if;
end $$;

-- Deposits taken before invoicing count toward the new invoice.
create function invoices_apply_deposits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update payments set invoice_id = new.id where so_id = new.so_id and status = 'completed' and invoice_id is null;
  perform settle_invoice(new.id);
  return null;
end $$;
create trigger invoices_apply_deposits after insert on invoices
  for each row execute function invoices_apply_deposits();

-- Voiding an invoice that has payments would strand them.
create function guard_invoice_void_with_payments() returns trigger
language plpgsql as $$
begin
  if new.status = 'void' and old.status <> 'void'
     and exists (select 1 from payments where invoice_id = old.id and status = 'completed') then
    raise exception 'This invoice has payments recorded. Void the payments first.';
  end if;
  return new;
end $$;
create trigger invoices_guard_payments before update on invoices
  for each row execute function guard_invoice_void_with_payments();

-- An order with money on it can't just be cancelled.
create function guard_so_cancel_with_payments() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and exists (select 1 from payments where so_id = old.id and status = 'completed') then
    raise exception 'This order has payments recorded. Void or refund them first.';
  end if;
  return new;
end $$;
create trigger sales_orders_guard_payments before update on sales_orders
  for each row execute function guard_so_cancel_with_payments();

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------

-- Record a payment against an order or its invoice. Before an order is
-- invoiced the payment is a deposit. p_details may carry card_brand,
-- card_last4, auth_code, terminal_id, terminal_request_id, external_txn_id,
-- received_at and notes.
create function record_payment(p_so_id uuid, p_method payment_method, p_amount numeric,
                               p_reference text default null, p_tip numeric default 0,
                               p_details jsonb default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_so  sales_orders;
  v_inv invoices;
  v_due numeric;
  v_id  uuid;
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.status = 'cancelled' then raise exception 'Cancelled orders can''t take payments'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  select * into v_inv from invoices where so_id = p_so_id and status <> 'void';
  if found and v_inv.status = 'paid' then raise exception 'Invoice % is already paid', v_inv.invoice_number; end if;

  v_due := so_total(p_so_id) - so_paid(p_so_id);
  -- (a card already charged on a terminal is always recorded, even if the sale couldn't be finished)
  if p_amount > v_due + 0.005 and coalesce(current_setting('app.allow_overpay', true), '') <> '1' then
    raise exception 'That''s more than the % still due', to_char(v_due, 'FM$999,999,990.00');
  end if;

  insert into payments (customer_id, so_id, invoice_id, kind, method, amount, tip, reference,
                        card_brand, card_last4, auth_code, terminal_id, terminal_request_id,
                        external_txn_id, received_at, notes)
  values (v_so.customer_id, p_so_id, v_inv.id,
          case when v_inv.id is null then 'deposit'::payment_kind else 'payment'::payment_kind end,
          p_method, round(p_amount, 2), round(coalesce(p_tip, 0), 2), nullif(p_reference, ''),
          nullif(p_details->>'card_brand', ''), nullif(p_details->>'card_last4', ''), nullif(p_details->>'auth_code', ''),
          nullif(p_details->>'terminal_id', '')::uuid, nullif(p_details->>'terminal_request_id', '')::uuid,
          nullif(p_details->>'external_txn_id', ''),
          coalesce(nullif(p_details->>'received_at', '')::timestamptz, now()), nullif(p_details->>'notes', ''))
  returning id into v_id;

  if v_inv.id is not null then perform settle_invoice(v_inv.id); end if;
  return v_id;
end $$;

create function void_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_p payments; v_inv uuid;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  select * into v_p from payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_p.status = 'voided' then raise exception 'Already voided'; end if;
  update payments set status = 'voided', voided_at = now() where id = p_payment_id;
  select id into v_inv from invoices where so_id = v_p.so_id and status <> 'void';
  if v_inv is not null then perform settle_invoice(v_inv); end if;
end $$;

-- ---------------------------------------------------------------------
-- Counter sales
-- ---------------------------------------------------------------------

create function walk_in_customer() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from customers where name = 'Walk-in' limit 1;
  if v_id is null then
    insert into customers (name, payment_terms_days, notes) values ('Walk-in', 0, 'Counter and terminal sales without a named customer')
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Start a counter sale: a confirmed order with these lines, checked against stock.
-- p_lines: [{ product_id, unit_id, qty, unit_price }]
create function create_counter_sale(p_customer_id uuid, p_lines jsonb, p_channel text default 'counter') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so uuid; v_short record;
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Add at least one item'; end if;

  select p.name, need.base, coalesce(st.on_hand, 0) as on_hand into v_short
    from (select (r->>'product_id')::uuid pid,
                 sum((r->>'qty')::numeric * u.factor) base
            from jsonb_array_elements(p_lines) r
            join product_units u on u.id = (r->>'unit_id')::uuid and u.product_id = (r->>'product_id')::uuid
           group by 1) need
    join products p on p.id = need.pid
    left join (select product_id, sum(qty_on_hand_base) on_hand from lots group by 1) st on st.product_id = need.pid
   where need.base > coalesce(st.on_hand, 0)
   limit 1;
  if found then
    raise exception 'Not enough %: % on hand, % needed', v_short.name, round(v_short.on_hand, 2), round(v_short.base, 2);
  end if;

  insert into sales_orders (customer_id, status, channel, notes)
  values (coalesce(p_customer_id, walk_in_customer()), 'draft', p_channel,
          case p_channel when 'terminal' then 'Rung up on a payment terminal' else 'Counter sale' end)
  returning id into v_so;
  insert into sales_order_lines (so_id, product_id, unit_id, qty, unit_price)
  select v_so, (r->>'product_id')::uuid, (r->>'unit_id')::uuid, (r->>'qty')::numeric, round((r->>'unit_price')::numeric, 4)
    from jsonb_array_elements(p_lines) r;
  if (select count(*) from sales_order_lines where so_id = v_so) <> jsonb_array_length(p_lines) then
    raise exception 'A unit doesn''t belong to its product';
  end if;
  update sales_orders set status = 'confirmed' where id = v_so;
  return v_so;
end $$;

-- Finish a counter sale: pull stock (FIFO), invoice (due today), and record
-- whatever payment is given. Payments already taken (e.g. on a terminal) count.
-- p_payment: { method, amount?, reference?, tip? } or null.
create function complete_counter_sale(p_so_id uuid, p_tax_rate numeric default 0, p_payment jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_inv uuid; v_due numeric;
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.channel not in ('counter','terminal') then raise exception 'Not a counter sale'; end if;
  if v_so.status = 'confirmed' then
    perform fulfill_sales_order(p_so_id);
  end if;
  select id into v_inv from invoices where so_id = p_so_id and status <> 'void';
  if v_inv is null then
    v_inv := create_invoice(p_so_id, coalesce(p_tax_rate, 0));
    perform set_config('app.via_rpc', '1', true);
    update invoices set due_at = issued_at where id = v_inv;
  end if;
  if p_payment is not null then
    v_due := so_total(p_so_id) - so_paid(p_so_id);
    if v_due > 0.005 then
      perform record_payment(p_so_id, (p_payment->>'method')::payment_method,
                             coalesce(nullif(p_payment->>'amount', '')::numeric, v_due),
                             p_payment->>'reference', coalesce(nullif(p_payment->>'tip', '')::numeric, 0), p_payment);
    end if;
  end if;
  perform settle_invoice(v_inv);
  return v_inv;
end $$;

-- ---------------------------------------------------------------------
-- Terminal requests (app -> terminal)
-- ---------------------------------------------------------------------

create function create_terminal_request(p_terminal_id uuid, p_purpose terminal_purpose, p_so_id uuid,
                                        p_amount numeric, p_provider text, p_tip_entry boolean default false,
                                        p_tax_rate numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t payment_terminals; v_inv invoices; v_so sales_orders; v_due numeric; v_id uuid;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  select * into v_t from payment_terminals where id = p_terminal_id and active;
  if not found then raise exception 'Choose an active terminal'; end if;
  select * into v_so from sales_orders where id = p_so_id;
  if not found then raise exception 'Order not found'; end if;
  if exists (select 1 from terminal_requests where terminal_id = p_terminal_id and status = 'pending'
              and created_at > now() - interval '4 minutes') then
    raise exception '% is busy with another payment. Finish or cancel it first.', v_t.name;
  end if;
  select * into v_inv from invoices where so_id = p_so_id and status <> 'void';
  if p_purpose = 'counter' then
    v_due := round((select coalesce(sum(qty * unit_price), 0) from sales_order_lines where so_id = p_so_id)
                   * (1 + coalesce(p_tax_rate, 0) / 100), 2) - so_paid(p_so_id);
  else
    v_due := so_total(p_so_id) - so_paid(p_so_id);
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_amount > v_due + 0.005 then raise exception 'That''s more than the % still due', to_char(v_due, 'FM$999,999,990.00'); end if;

  insert into terminal_requests (terminal_id, provider, purpose, so_id, invoice_id, amount, tip_entry, tax_rate, invoice_ref)
  values (p_terminal_id, p_provider, p_purpose, p_so_id, v_inv.id, round(p_amount, 2), coalesce(p_tip_entry, false),
          coalesce(p_tax_rate, 0), coalesce(v_inv.invoice_number, v_so.so_number))
  returning id into v_id;
  return v_id;
end $$;

-- Apply the terminal's answer. Idempotent: only a pending request changes.
-- p_result: { status, message?, card_brand?, card_last4?, auth_code?, txn_id?, tip?, provider_ref?, raw? }
create function finalize_terminal_request(p_id uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r   terminal_requests;
  v_pay uuid;
  v_msg text;
  v_st  terminal_req_status := (p_result->>'status')::terminal_req_status;
  v_unfinished boolean := false;
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  select * into v_r from terminal_requests where id = p_id for update;
  if not found then raise exception 'Terminal request not found'; end if;
  if v_r.status <> 'pending' then
    return jsonb_build_object('status', v_r.status, 'message', v_r.message, 'payment_id', v_r.payment_id, 'already', true);
  end if;
  v_msg := p_result->>'message';

  if v_st = 'approved' then
    -- Counter sale: pull stock and invoice (with tax) first, so the payment settles the invoice.
    if v_r.purpose = 'counter' then
      begin
        perform complete_counter_sale(v_r.so_id, v_r.tax_rate, null);
      exception when others then
        v_unfinished := true;
        v_msg := 'Paid, but the sale couldn''t be finished: ' || sqlerrm || '. The payment is kept as a deposit on the order.';
      end;
    end if;
    -- The card has been charged: always record it.
    perform set_config('app.allow_overpay', '1', true);
    v_pay := record_payment(v_r.so_id, 'card', v_r.amount, p_result->>'auth_code', coalesce(nullif(p_result->>'tip', '')::numeric, 0),
               jsonb_build_object('card_brand', p_result->>'card_brand', 'card_last4', p_result->>'card_last4',
                                  'auth_code', p_result->>'auth_code', 'terminal_id', v_r.terminal_id,
                                  'terminal_request_id', v_r.id, 'external_txn_id', p_result->>'txn_id'));
    perform set_config('app.allow_overpay', '', true);
  end if;

  update terminal_requests
     set status = v_st, message = coalesce(v_msg, initcap(v_st::text)), response = p_result,
         provider_ref = coalesce(p_result->>'provider_ref', p_result->>'txn_id'), payment_id = v_pay, completed_at = now()
   where id = p_id;
  return jsonb_build_object('status', v_st, 'message', v_msg, 'payment_id', v_pay);
end $$;

-- ---------------------------------------------------------------------
-- Terminal sales sync (sales rung up on the terminal itself)
-- p_txn: { txn_id, amount, tip?, card_brand?, card_last4?, auth_code?, method?, received_at?,
--          invoice_ref?, terminal_epi?, customer_id?, tax_rate?,
--          lines?: [{ product_id, unit_id, qty, unit_price }] }
-- With invoice_ref matching an open invoice/order -> payment against it.
-- With lines -> a terminal sale (stock pulled FIFO) paid by this transaction.
-- Without either -> an unitemized payment needs a target, so it's rejected.
-- Returns { result: 'payment'|'sale'|'duplicate', so_id }
-- ---------------------------------------------------------------------
create function import_terminal_txn(p_txn jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_so   uuid;
  v_term uuid;
  v_ref  text := upper(nullif(trim(p_txn->>'invoice_ref'), ''));
  v_det  jsonb;
  v_amt  numeric := (p_txn->>'amount')::numeric;
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  if nullif(p_txn->>'txn_id', '') is null then raise exception 'Transaction id is required'; end if;
  if exists (select 1 from payments where external_txn_id = p_txn->>'txn_id') then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select id into v_term from payment_terminals where epi = p_txn->>'terminal_epi' or serial_no = p_txn->>'terminal_epi' limit 1;
  v_det := jsonb_build_object('card_brand', p_txn->>'card_brand', 'card_last4', p_txn->>'card_last4',
                              'auth_code', p_txn->>'auth_code', 'terminal_id', v_term,
                              'external_txn_id', p_txn->>'txn_id', 'received_at', p_txn->>'received_at',
                              'notes', 'Synced from terminal');

  if v_ref is not null then
    select so_id into v_so from invoices where upper(invoice_number) = v_ref and status <> 'void';
    if v_so is null then select id into v_so from sales_orders where upper(so_number) = v_ref; end if;
  end if;

  if v_so is not null then
    perform record_payment(v_so, coalesce(nullif(p_txn->>'method', ''), 'card')::payment_method, v_amt,
                           p_txn->>'auth_code', coalesce(nullif(p_txn->>'tip', '')::numeric, 0), v_det);
    return jsonb_build_object('result', 'payment', 'so_id', v_so);
  end if;

  if jsonb_array_length(coalesce(p_txn->'lines', '[]')) = 0 then
    raise exception 'Transaction % has no matching invoice and no items', p_txn->>'txn_id';
  end if;
  v_so := create_counter_sale(nullif(p_txn->>'customer_id', '')::uuid, p_txn->'lines', 'terminal');
  perform complete_counter_sale(v_so, coalesce(nullif(p_txn->>'tax_rate', '')::numeric, 0), null);
  -- the terminal already took the money: record what it took
  perform set_config('app.allow_overpay', '1', true);
  perform record_payment(v_so, coalesce(nullif(p_txn->>'method', ''), 'card')::payment_method, v_amt,
                         p_txn->>'auth_code', coalesce(nullif(p_txn->>'tip', '')::numeric, 0), v_det);
  perform set_config('app.allow_overpay', '', true);
  return jsonb_build_object('result', 'sale', 'so_id', v_so);
end $$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create view v_invoice_balance with (security_invoker = true) as
select i.id as invoice_id, i.so_id, i.total,
       coalesce(sum(p.amount) filter (where p.status = 'completed'), 0) as paid,
       i.total - coalesce(sum(p.amount) filter (where p.status = 'completed'), 0) as balance
  from invoices i
  left join payments p on p.so_id = i.so_id
 where i.status <> 'void'
 group by i.id;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table payment_terminals enable row level security;
alter table payments          enable row level security;
alter table terminal_requests enable row level security;
alter table terminal_item_map enable row level security;

create policy "members read" on payment_terminals for select to authenticated using (is_member());
create policy "members read" on payments          for select to authenticated using (is_member());
create policy "members read" on terminal_requests for select to authenticated using (is_member());
create policy "members read" on terminal_item_map for select to authenticated using (is_member());

create policy "admins write" on payment_terminals for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy "sales write" on terminal_item_map for all to authenticated using (has_role('sales')) with check (has_role('sales'));
-- payments and terminal requests change only through the functions above
create policy "sales cancel pending" on terminal_requests for update to authenticated
  using (has_role('sales') and status = 'pending') with check (has_role('sales') and status in ('pending','cancelled','timeout'));
