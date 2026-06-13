-- FocusLion upgrade 11: profile picture uploads
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- storage bucket for avatars (public URLs, 5 MB per file)
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)
on conflict (id) do update set public = true, file_size_limit = 5242880;

-- storage policies: upload/replace/delete only inside your own folder,
-- anyone signed in can read (avatars also show up on the public feed)
drop policy if exists "avatars upload own" on storage.objects;
create policy "avatars upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars read" on storage.objects;
create policy "avatars read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
