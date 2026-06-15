-- FocusLion upgrade 18: Future Me Capsule + AI Growth Coach
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- A capsule is a sealed letter (message + goals + media) to your future self.
-- It stays locked until unlock_at. A snapshot of your stats is saved at
-- creation so the Growth Coach can compare past-vs-present when it opens.

-- ---------- capsules ----------
create table if not exists public.capsules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Student',
  author_avatar_url text not null default '',
  title text not null default 'Letter to future me',
  message text not null default '',
  goals jsonb not null default '[]'::jsonb,          -- [{ id, text, done }]
  unlock_at timestamptz not null,
  visibility text not null default 'private'          -- private | friends | feed
    check (visibility in ('private', 'friends', 'feed')),
  opened_at timestamptz,                              -- null while sealed
  snapshot jsonb not null default '{}'::jsonb,         -- stats captured at creation
  growth jsonb,                                        -- growth report, filled on open
  shared_post_id uuid,                                 -- feed_posts.id if shared
  created_at timestamptz not null default now()
);
alter table public.capsules enable row level security;

-- capsules are private to their owner; sharing is done by posting to the feed
drop policy if exists "capsules read own" on public.capsules;
create policy "capsules read own" on public.capsules
  for select using (auth.uid() = user_id);

drop policy if exists "capsules insert own" on public.capsules;
create policy "capsules insert own" on public.capsules
  for insert with check (auth.uid() = user_id);

drop policy if exists "capsules update own" on public.capsules;
create policy "capsules update own" on public.capsules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "capsules delete own" on public.capsules;
create policy "capsules delete own" on public.capsules
  for delete using (auth.uid() = user_id);

create index if not exists capsules_user_idx on public.capsules (user_id);
create index if not exists capsules_unlock_idx on public.capsules (unlock_at);

-- ---------- capsule media (images, video, voice notes) ----------
create table if not exists public.capsule_media (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'voice')),
  url text not null,
  created_at timestamptz not null default now()
);
alter table public.capsule_media enable row level security;

drop policy if exists "capsule media read own" on public.capsule_media;
create policy "capsule media read own" on public.capsule_media
  for select using (auth.uid() = user_id);

drop policy if exists "capsule media insert own" on public.capsule_media;
create policy "capsule media insert own" on public.capsule_media
  for insert with check (auth.uid() = user_id);

drop policy if exists "capsule media delete own" on public.capsule_media;
create policy "capsule media delete own" on public.capsule_media
  for delete using (auth.uid() = user_id);

create index if not exists capsule_media_capsule_idx on public.capsule_media (capsule_id);

-- ---------- storage bucket for capsule media (public URLs, 50 MB per file) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('capsules', 'capsules', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "capsules media upload own" on storage.objects;
create policy "capsules media upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'capsules'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "capsules media read" on storage.objects;
create policy "capsules media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'capsules');

drop policy if exists "capsules media delete own" on storage.objects;
create policy "capsules media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'capsules'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
