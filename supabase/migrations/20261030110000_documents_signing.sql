-- =====================================================================
-- Documents: a Word-style editor (private per person) and PDF signing.
--   * wordsmith_docs: each staff member's own documents, with a writing diary.
--   * signature_docs: PDFs prepared with signature / initials / text / checkbox boxes (shared by staff).
--   * signature_requests: one per "send to" a recipient. The sender's account email is recorded and used as reply-to.
--     A recipient who has a DKaydent login signs while signed in as that email; anyone else confirms the email on the link.
-- PDFs live in the private "signature-docs" bucket; only the server (service key) reads and writes it.
-- =====================================================================

create table wordsmith_docs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references profiles(id) on delete cascade,
  title       text not null default 'Untitled document' check (length(title) between 1 and 200),
  content     jsonb not null default '{}'::jsonb,
  diary       jsonb not null default '[]'::jsonb check (jsonb_typeof(diary) = 'array'),
  word_count  integer not null default 0 check (word_count >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index wordsmith_docs_owner_idx on wordsmith_docs (owner_id, updated_at desc);
alter table wordsmith_docs enable row level security;
-- private: only the owner, and only staff (customers have no editor)
create policy "owner reads" on wordsmith_docs for select to authenticated using (owner_id = auth.uid() and is_member());
create policy "owner adds" on wordsmith_docs for insert to authenticated with check (owner_id = auth.uid() and is_member());
create policy "owner edits" on wordsmith_docs for update to authenticated using (owner_id = auth.uid() and is_member()) with check (owner_id = auth.uid());
create policy "owner deletes" on wordsmith_docs for delete to authenticated using (owner_id = auth.uid() and is_member());

create table signature_docs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Untitled document' check (length(name) between 1 and 200),
  file_path   text,
  page_count  integer not null default 0,
  -- boxes: [{ id, page (1-based), x, y, w, h (fractions 0..1 of the page), type: signature|initials|text|checkbox, label, fill, underline }]
  boxes       jsonb not null default '[]'::jsonb check (jsonb_typeof(boxes) = 'array'),
  status      text not null default 'draft' check (status in ('draft', 'ready')),
  owner_id    uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index signature_docs_created_idx on signature_docs (created_at desc);
alter table signature_docs enable row level security;
create policy "staff read" on signature_docs for select to authenticated using (is_member());
create policy "staff write" on signature_docs for all to authenticated using (is_member()) with check (is_member());

create table signature_requests (
  id              uuid primary key default gen_random_uuid(),
  doc_id          uuid references signature_docs(id) on delete set null,
  doc_name        text not null default '',
  token           text not null unique,
  recipient_email text not null check (recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  boxes           jsonb not null default '[]'::jsonb,
  source_path     text,
  values          jsonb not null default '{}'::jsonb,
  completed_path  text,
  status          text not null default 'sent' check (status in ('sent', 'completed')),
  opened          boolean not null default false,
  sender_id       uuid references profiles(id) on delete set null,
  sender_email    text,
  sender_name     text,
  signer_id       uuid references profiles(id) on delete set null,   -- set when signed while signed in
  audit           jsonb not null default '{}'::jsonb,
  sent_at         timestamptz not null default now(),
  completed_at    timestamptz
);
create index signature_requests_sent_idx on signature_requests (status, sent_at desc);
create index signature_requests_recipient_idx on signature_requests (lower(recipient_email));
alter table signature_requests enable row level security;
-- staff see every request; a signed-in person sees the ones sent to their own account email
create policy "staff read" on signature_requests for select to authenticated using (is_member());
create policy "recipient reads own" on signature_requests for select to authenticated
  using (lower(recipient_email) = lower(coalesce((select email from profiles where id = auth.uid()), '')));
-- all writes go through the server (service key) after its own checks

-- Private bucket. Skipped automatically on plain Postgres (tests), where the storage schema doesn't exist.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found; skipping bucket setup';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('signature-docs', 'signature-docs', false, 10485760, array['application/pdf'])
  on conflict (id) do nothing;
end $$;
