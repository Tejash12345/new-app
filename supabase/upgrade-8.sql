-- FocusLion upgrade 8: photos, voice messages and documents in chat
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- 1) message can now carry an attachment
alter table public.direct_messages
  add column if not exists kind text not null default 'text',     -- text | image | audio | file
  add column if not exists file_url text,
  add column if not exists file_name text;

-- 2) storage bucket for chat media (public URLs, 10 MB per file)
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

-- 3) storage policies: upload only into your own folder, signed-in users can read
drop policy if exists "chat media upload own" on storage.objects;
create policy "chat media upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media');

drop policy if exists "chat media delete own" on storage.objects;
create policy "chat media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
