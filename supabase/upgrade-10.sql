-- FocusLion upgrade 10: feed view counts
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- 1) a view counter on every feed item
alter table public.feed_posts
  add column if not exists views integer not null default 0;

-- 2) atomic increment any signed-in user can call (no row-update RLS needed,
--    so viewers can bump a counter on posts they don't own)
create or replace function public.bump_feed_view(pid uuid)
returns void language sql security definer set search_path = public as $$
  update public.feed_posts set views = views + 1 where id = pid;
$$;
grant execute on function public.bump_feed_view(uuid) to authenticated;
