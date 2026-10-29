-- Optional password hint a customer sets for their own login. Shown on the sign-in page to anyone who types the username,
-- so the app refuses hints that contain the password. Read for the sign-in page by the server (service role) only.
create table password_hints (
  profile_id uuid primary key references profiles(id) on delete cascade,
  hint text not null check (char_length(btrim(hint)) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table password_hints enable row level security;
create policy "own hint read" on password_hints for select to authenticated using (profile_id = auth.uid());
create policy "customer sets own hint" on password_hints for insert to authenticated
  with check (profile_id = auth.uid() and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'customer' and p.active));
create policy "customer changes own hint" on password_hints for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'customer' and p.active));
create policy "customer removes own hint" on password_hints for delete to authenticated using (profile_id = auth.uid());
