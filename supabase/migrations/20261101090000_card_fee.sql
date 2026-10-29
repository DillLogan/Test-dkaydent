-- =====================================================================
-- Card processing fee
--   * Admins set the rate in Settings (app_settings.card_fee_pct, starts at 2.5%; 0 turns it off).
--   * Only orders paid by card get it: sales_orders.payment_type = 'card'.
--   * The invoice adds it on its own line: rate × (subtotal + tax), rounded to the cent.
--     The rate used is kept on the invoice, so changing the setting later doesn't change old invoices.
--   * Before invoicing, a card order is worth its lines plus the fee on them (tax comes with the invoice).
--   * Staff can set how an order is paid (set_so_payment) until it is invoiced.
--   * Counter sales paid by card (by hand or on a terminal) are card orders.
-- =====================================================================

alter table app_settings add column card_fee_pct numeric not null default 2.5 check (card_fee_pct between 0 and 10);

alter table invoices add column card_fee numeric not null default 0 check (card_fee >= 0),
                     add column card_fee_rate numeric not null default 0 check (card_fee_rate between 0 and 10);

-- The current rate. Customers can't read app_settings, but they see the fee in their cart.
create function card_fee_pct() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select card_fee_pct from app_settings limit 1), 0)
$$;
revoke all on function card_fee_pct() from public, anon;
grant execute on function card_fee_pct() to authenticated;

-- Fee on an amount at the current rate.
create function card_fee_on(p_amount numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(p_amount, 0) * card_fee_pct() / 100, 2)
$$;
revoke all on function card_fee_on(numeric) from public, anon, authenticated;

create or replace function create_invoice(p_so_id uuid, p_tax_rate numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_terms integer; v_sub numeric; v_tax numeric; v_rate numeric := 0; v_fee numeric := 0; v_id uuid;
begin
  if not has_role('sales','orders_manager') then raise exception 'Not authorized'; end if;
  perform set_config('app.via_rpc', '1', true);
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_so.status <> 'completed' then raise exception 'Only completed orders can be invoiced. The orders manager marks an order completed once its pull ticket is turned in.'; end if;

  select payment_terms_days into v_terms from customers where id = v_so.customer_id;
  select round(coalesce(sum(qty * unit_price), 0), 2) into v_sub from sales_order_lines where so_id = p_so_id;
  v_tax := round(v_sub * coalesce(p_tax_rate, 0) / 100, 2);
  if v_so.payment_type = 'card' then
    v_rate := card_fee_pct();
    v_fee := round((v_sub + v_tax) * v_rate / 100, 2);
  end if;

  insert into invoices (so_id, customer_id, due_at, subtotal, tax_rate, tax, card_fee_rate, card_fee, total)
  values (p_so_id, v_so.customer_id, current_date + coalesce(v_terms, 30), v_sub, coalesce(p_tax_rate, 0), v_tax,
          v_rate, v_fee, v_sub + v_tax + v_fee)
  returning id into v_id;

  update sales_orders set status = 'invoiced' where id = p_so_id;
  return v_id;
end $$;

-- What the order is worth: its invoice total, or its lines (plus the card fee on them for a card order).
create or replace function so_total(p_so_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from profiles where id = auth.uid() and role = 'customer') then null else
    coalesce(
      (select total from invoices where so_id = p_so_id and status <> 'void' limit 1),
      (select s.sub + case when so.payment_type = 'card' then card_fee_on(s.sub) else 0 end
         from sales_orders so,
              lateral (select round(coalesce(sum(qty * unit_price), 0), 2) sub from sales_order_lines where so_id = so.id) s
        where so.id = p_so_id)) end
$$;

-- How the customer pays for an order: cash, card, check, or not set. Fixed once it is invoiced.
create function set_so_payment(p_so_id uuid, p_payment text) returns void
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders;
begin
  if not has_role('sales') then raise exception 'Not authorized'; end if;
  if p_payment is not null and p_payment not in ('cash','card','check') then raise exception 'Payment must be cash, card or check'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.status in ('invoiced','cancelled') or exists (select 1 from invoices where so_id = p_so_id and status <> 'void') then
    raise exception 'This order is already invoiced. Void the invoice to change how it is paid.';
  end if;
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set payment_type = p_payment where id = p_so_id;
end $$;
revoke execute on function set_so_payment(uuid, text) from public;
grant execute on function set_so_payment(uuid, text) to authenticated;

-- Counter sale: paying by card makes it a card order before it is invoiced.
create or replace function complete_counter_sale(p_so_id uuid, p_tax_rate numeric default 0, p_payment jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_so sales_orders; v_inv uuid; v_due numeric; v_method text := p_payment->>'method';
begin
  if not (has_role('sales') or is_service_role()) then raise exception 'Not authorized'; end if;
  select * into v_so from sales_orders where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.channel not in ('counter','terminal') then raise exception 'Not a counter sale'; end if;
  if v_so.status = 'confirmed' then
    perform fulfill_sales_order(p_so_id);
  end if;
  -- A counter sale is handed over on the spot, so it is completed right away
  perform set_config('app.via_rpc', '1', true);
  update sales_orders set status = 'completed', completed_at = now(), completed_by = auth.uid()
   where id = p_so_id and status = 'fulfilled';
  select id into v_inv from invoices where so_id = p_so_id and status <> 'void';
  if v_inv is null then
    if v_method in ('cash','card','check') then
      perform set_config('app.via_rpc', '1', true);
      update sales_orders set payment_type = v_method where id = p_so_id;
    end if;
    v_inv := create_invoice(p_so_id, coalesce(p_tax_rate, 0));
    perform set_config('app.via_rpc', '1', true);
    update invoices set due_at = issued_at where id = v_inv;
  end if;
  if p_payment is not null then
    v_due := so_total(p_so_id) - so_paid(p_so_id);
    if v_due > 0.005 then
      perform record_payment(p_so_id, v_method::payment_method,
                             coalesce(nullif(p_payment->>'amount', '')::numeric, v_due),
                             p_payment->>'reference', coalesce(nullif(p_payment->>'tip', '')::numeric, 0), p_payment);
    end if;
  end if;
  perform settle_invoice(v_inv);
  return v_inv;
end $$;

-- Terminal charges are card payments: a counter sale sent to a terminal becomes a card order,
-- and what it can charge includes the card fee.
create or replace function create_terminal_request(p_terminal_id uuid, p_purpose terminal_purpose, p_so_id uuid,
                                        p_amount numeric, p_provider text, p_tip_entry boolean default false,
                                        p_tax_rate numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t payment_terminals; v_inv invoices; v_so sales_orders; v_sub numeric; v_due numeric; v_id uuid;
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
    if v_inv.id is null then
      perform set_config('app.via_rpc', '1', true);
      update sales_orders set payment_type = 'card' where id = p_so_id;
    end if;
    select round(coalesce(sum(qty * unit_price), 0), 2) into v_sub from sales_order_lines where so_id = p_so_id;
    v_sub := v_sub + round(v_sub * coalesce(p_tax_rate, 0) / 100, 2);
    v_due := v_sub + card_fee_on(v_sub) - so_paid(p_so_id);
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
