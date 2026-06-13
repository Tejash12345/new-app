-- FocusLion upgrade 14: Instagram-style stories with view tracking
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- ---------- stories (auto-expire after 24h, enforced client-side by expires_at) ----------
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Student',
  author_avatar_url text not null default '',
  media_url text not null,
  caption text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
alter table public.stories enable row level security;

drop policy if exists "stories read all" on public.stories;
create policy "stories read all" on public.stories
  for select using (auth.uid() is not null);

drop policy if exists "stories insert own" on public.stories;
create policy "stories insert own" on public.stories
  for insert with check (auth.uid() = user_id);

drop policy if exists "stories delete own" on public.stories;
create policy "stories delete own" on public.stories
  for delete using (auth.uid() = user_id);

create index if not exists stories_active_idx on public.stories (expires_at desc);
create index if not exists stories_user_idx on public.stories (user_id);

-- ---------- story views (who saw each story) ----------
create table if not exists public.story_views (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewer_name text not null default 'Student',
  viewer_avatar_url text not null default '',
  created_at timestamptz not null default now(),
  unique (story_id, viewer_id)
);
alter table public.story_views enable row level security;

-- a viewer records their own view
drop policy if exists "story views insert own" on public.story_views;
create policy "story views insert own" on public.story_views
  for insert with check (auth.uid() = viewer_id);

-- the story's author can see who viewed it; viewers can see their own rows
drop policy if exists "story views read" on public.story_views;
create policy "story views read" on public.story_views
  for select using (
    viewer_id = auth.uid()
    or exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid())
  );

-- ---------- storage bucket for story media (public URLs, 10 MB per file) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('stories', 'stories', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "stories media upload own" on storage.objects;
create policy "stories media upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "stories media read" on storage.objects;
create policy "stories media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'stories');

drop policy if exists "stories media delete own" on storage.objects;
create policy "stories media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
