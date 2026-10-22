-- Supabase Storage bucket for item, lot and floor-plan photos.
-- Public read (photos of flowers aren't sensitive and public URLs cache well);
-- only buyers and warehouse can add, replace or remove files.
-- Skipped automatically on plain Postgres (tests), where the storage schema doesn't exist.
do $mig$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('item-images', 'item-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$create policy "item images read" on storage.objects for select to authenticated
    using (bucket_id = 'item-images')$p$;
  execute $p$create policy "item images insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'item-images' and public.has_role('buyer', 'warehouse'))$p$;
  execute $p$create policy "item images update" on storage.objects for update to authenticated
    using (bucket_id = 'item-images' and public.has_role('buyer', 'warehouse'))$p$;
  execute $p$create policy "item images delete" on storage.objects for delete to authenticated
    using (bucket_id = 'item-images' and public.has_role('buyer', 'warehouse'))$p$;
end
$mig$;
