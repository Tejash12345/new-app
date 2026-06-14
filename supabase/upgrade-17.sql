-- FocusLion upgrade 17: Save (bookmark) + Repost on the feed
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- 1) SAVES — private per-user bookmarks (only you can see what you saved)
create table if not exists public.feed_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);
alter table public.feed_saves enable row level security;

drop policy if exists "saves read own" on public.feed_saves;
create policy "saves read own" on public.feed_saves
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "saves insert own" on public.feed_saves;
create policy "saves insert own" on public.feed_saves
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "saves delete own" on public.feed_saves;
create policy "saves delete own" on public.feed_saves
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists feed_saves_user_idx on public.feed_saves(user_id, post_id);

-- 2) REPOST — a repost is a normal feed_posts row that points at the original.
--    It copies the original's content + author so the card shows who made it,
--    and records who reposted it. ON DELETE CASCADE: deleting an original also
--    removes its reposts.
alter table public.feed_posts
  add column if not exists repost_of uuid references public.feed_posts(id) on delete cascade,
  add column if not exists original_user_id uuid,   -- the original author's id (for avatar/profile)
  add column if not exists reposter_name text;       -- who reposted it ("🔁 X reposted")

create index if not exists feed_posts_repost_idx on public.feed_posts(repost_of);

-- realtime so reposts/saves show up live for everyone
do $$ begin
  alter publication supabase_realtime add table public.feed_saves;
exception when duplicate_object then null; end $$;
