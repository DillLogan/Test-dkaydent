-- =====================================================================
-- Knowledge base articles written in the app.
--   * builtin_id null: a new article. Any staff member adds one; the author or admin edits or removes it.
--   * builtin_id set: admin's change to a built-in article (new wording, or hidden). Removing the row restores the original.
-- =====================================================================
create table kb_articles (
  id          uuid primary key default gen_random_uuid(),
  builtin_id  text unique check (builtin_id is null or builtin_id ~ '^[a-z0-9-]{1,60}$'),
  category    text not null check (length(trim(category)) between 1 and 40),
  title       text not null check (length(trim(title)) between 1 and 150),
  body        text[] not null default '{}' check (cardinality(body) <= 60),
  hidden      boolean not null default false,
  author_id   uuid references profiles(id) on delete set null default auth.uid(),
  updated_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table kb_articles enable row level security;
create policy "staff read" on kb_articles for select to authenticated using (is_member());
create policy "staff add" on kb_articles for insert to authenticated
  with check (is_member() and author_id = auth.uid() and (builtin_id is null or has_role('admin')) and (not hidden or has_role('admin')));
create policy "author or admin edits" on kb_articles for update to authenticated
  using (is_member() and (has_role('admin') or (author_id = auth.uid() and builtin_id is null)))
  with check (has_role('admin') or (author_id = auth.uid() and builtin_id is null and not hidden));
create policy "author or admin removes" on kb_articles for delete to authenticated
  using (is_member() and (has_role('admin') or (author_id = auth.uid() and builtin_id is null)));

-- body lines trimmed, empty ones dropped, each up to 2,000 characters
create function clean_kb_article() returns trigger
language plpgsql as $$
declare v text[] := '{}'; s text;
begin
  foreach s in array coalesce(new.body, '{}') loop
    s := btrim(s);
    if s = '' then continue; end if;
    if length(s) > 2000 then raise exception 'Each paragraph can be up to 2,000 characters'; end if;
    v := v || s;
  end loop;
  new.body := v;
  new.title := btrim(new.title);
  new.category := btrim(new.category);
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.author_id := old.author_id; new.builtin_id := old.builtin_id; new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger kb_articles_clean before insert or update on kb_articles
  for each row execute function clean_kb_article();
