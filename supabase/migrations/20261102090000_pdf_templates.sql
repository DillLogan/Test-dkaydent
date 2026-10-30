-- PDF printouts: one saved layout per printout, made in Settings → Customize printouts.
-- No row means the built-in layout. Everyone signed in (staff) reads them; only admins change them.
create table pdf_templates (
  doc        text primary key check (doc in ('pull','invoice','route','label','boxlabel')),
  layout     jsonb not null check (jsonb_typeof(layout) = 'object' and octet_length(layout::text) < 900000),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) default auth.uid()
);
alter table pdf_templates enable row level security;
create policy "members read" on pdf_templates for select to authenticated using (is_member());
create policy "admin write" on pdf_templates for all to authenticated using (has_role('admin')) with check (has_role('admin'));
