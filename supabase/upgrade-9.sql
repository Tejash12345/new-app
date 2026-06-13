-- FocusLion upgrade 9: Tech Feed — posts, reels, Instagram/LinkedIn embeds
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- ============================================================
-- 0) ensure the is_admin() helper exists (used by moderation policies below).
--    Normally created by schema.sql; defined here so this file runs standalone.
-- ============================================================
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ============================================================
-- 1) feed_posts — a shared, community-wide tech feed
--    type: post   = text + optional image (user created)
--          reel   = uploaded short video (user created)
--          instagram = an embedded Instagram reel/post (by URL)
--          linkedin  = an embedded LinkedIn post (by URL)
-- Every item carries a tech `category` so the feed stays technology-only.
-- ============================================================
create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Student',
  type text not null default 'post',          -- post | reel | instagram | linkedin
  category text not null default 'Programming',
  title text default '',
  body text default '',
  media_url text,                              -- uploaded image (post) or video (reel)
  embed_url text,                              -- original Instagram / LinkedIn URL
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.feed_posts enable row level security;

-- everyone signed in can read the tech feed
drop policy if exists "feed read all" on public.feed_posts;
create policy "feed read all" on public.feed_posts
  for select to authenticated using (true);

-- you may only create posts as yourself
drop policy if exists "feed insert own" on public.feed_posts;
create policy "feed insert own" on public.feed_posts
  for insert to authenticated with check (auth.uid() = user_id);

-- you can edit your own posts
drop policy if exists "feed update own" on public.feed_posts;
create policy "feed update own" on public.feed_posts
  for update to authenticated using (auth.uid() = user_id);

-- you can delete your own posts; admins can remove anything (moderation)
drop policy if exists "feed delete own or admin" on public.feed_posts;
create policy "feed delete own or admin" on public.feed_posts
  for delete to authenticated using (auth.uid() = user_id or public.is_admin());

create index if not exists feed_posts_idx on public.feed_posts(created_at desc);
create index if not exists feed_posts_type_idx on public.feed_posts(type, category);

-- ============================================================
-- 2) feed_likes
-- ============================================================
create table if not exists public.feed_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);
alter table public.feed_likes enable row level security;

drop policy if exists "likes read all" on public.feed_likes;
create policy "likes read all" on public.feed_likes
  for select to authenticated using (true);

drop policy if exists "likes insert own" on public.feed_likes;
create policy "likes insert own" on public.feed_likes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "likes delete own" on public.feed_likes;
create policy "likes delete own" on public.feed_likes
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists feed_likes_post_idx on public.feed_likes(post_id);

-- ============================================================
-- 3) feed_comments
-- ============================================================
create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Student',
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.feed_comments enable row level security;

drop policy if exists "comments read all" on public.feed_comments;
create policy "comments read all" on public.feed_comments
  for select to authenticated using (true);

drop policy if exists "comments insert own" on public.feed_comments;
create policy "comments insert own" on public.feed_comments
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "comments delete own or admin" on public.feed_comments;
create policy "comments delete own or admin" on public.feed_comments
  for delete to authenticated using (auth.uid() = user_id or public.is_admin());

create index if not exists feed_comments_post_idx on public.feed_comments(post_id, created_at);

-- ============================================================
-- 4) storage bucket for feed media (images + short reel videos, 50 MB cap)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('feed-media', 'feed-media', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "feed media upload own" on storage.objects;
create policy "feed media upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feed-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "feed media read" on storage.objects;
create policy "feed media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'feed-media');

drop policy if exists "feed media delete own" on storage.objects;
create policy "feed media delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feed-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 5) realtime
-- ============================================================
alter publication supabase_realtime add table public.feed_posts;
alter publication supabase_realtime add table public.feed_likes;
alter publication supabase_realtime add table public.feed_comments;
