-- Self-service password reset for customer logins, and admin-editable printouts.

-- Reset links go to the customer's existing Email field; without one the customer asks sales to approve a reset.

-- A customer who cannot use email asks for a reset; sales or admin approve it; the customer then sets a new password.
-- Rows are written by the server (service role) because the requester is not signed in.
create table password_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  rep_id uuid references profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','used','denied')),
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  used_at timestamptz
);
create index password_requests_open on password_requests (status, requested_at);
alter table password_requests enable row level security;
create policy "sales read" on password_requests for select to authenticated using (has_role('sales'));
-- no direct writes: server (service role) creates and consumes; staff decide through decide_password_request

create or replace function decide_password_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('sales') then raise exception 'Only sales or admin can decide a reset request.'; end if;
  update password_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id and status = 'pending';
  if not found then raise exception 'That request is no longer pending.'; end if;
end $$;

-- How many reset requests wait for the signed-in staff member (their customers, or all for admin).
create or replace function pending_reset_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from password_requests r
   where r.status = 'pending' and has_role('sales')
     and (r.rep_id = auth.uid() or r.rep_id is null or has_role('admin'))
$$;

-- Printouts: one shared row the admin edits; every staff member reads it.
create table print_config (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into print_config (id) values (1);
alter table print_config enable row level security;
create policy "members read" on print_config for select to authenticated using (is_member());
create policy "admin write" on print_config for update to authenticated using (has_role('admin')) with check (has_role('admin'));
