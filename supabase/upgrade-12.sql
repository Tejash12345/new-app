-- FocusLion upgrade 12: show profile pictures everywhere
-- (feed, comments, community chat, friends, search, suggestions, leaderboard)
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- ---------- denormalised author avatar on content tables ----------
-- mirrors the existing author_name pattern: captured at write time so other
-- users' pictures are visible without granting profile read access
alter table public.feed_posts
  add column if not exists author_avatar_url text not null default '';
alter table public.feed_comments
  add column if not exists author_avatar_url text not null default '';
alter table public.chat_messages
  add column if not exists author_avatar_url text not null default '';

-- ---------- leaderboard view: expose avatar_url ----------
-- CREATE OR REPLACE only allows appending columns, so avatar_url goes last
create or replace view public.leaderboard as
  select id, full_name, xp, study_streak, avatar_url
  from public.profiles
  where coalesce(settings->>'leaderboard', 'true') = 'true'
  order by xp desc
  limit 50;
grant select on public.leaderboard to authenticated;

-- ---------- friend / people RPCs: return avatar_url ----------
-- return type (columns) changes, so drop before recreate
drop function if exists public.search_users(text);
create function public.search_users(q text)
returns table (id uuid, full_name text, email text, avatar_url text, xp int, study_streak int)
language sql security definer set search_path = public as $$
  select id, coalesce(full_name, '') as full_name, email,
         coalesce(avatar_url, '') as avatar_url, xp, study_streak
  from public.profiles
  where id <> auth.uid()
    and (
      full_name ilike '%' || q || '%'
      or email ilike '%' || q || '%'
    )
  order by xp desc
  limit 15;
$$;
grant execute on function public.search_users(text) to authenticated;

drop function if exists public.my_friends();
create function public.my_friends()
returns table (
  friendship_id uuid,
  friend_id uuid,
  full_name text,
  email text,
  avatar_url text,
  xp int,
  study_streak int,
  status text,
  direction text,
  last_seen timestamptz
)
language sql security definer set search_path = public as $$
  select
    f.id as friendship_id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as friend_id,
    coalesce(p.full_name, '') as full_name, p.email,
    coalesce(p.avatar_url, '') as avatar_url,
    p.xp, p.study_streak, f.status,
    case when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end as direction,
    p.last_seen
  from public.friendships f
  join public.profiles p
    on p.id = (case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end)
  where auth.uid() = f.requester_id or auth.uid() = f.addressee_id
  order by f.created_at desc;
$$;
grant execute on function public.my_friends() to authenticated;

drop function if exists public.suggested_users();
create function public.suggested_users()
returns table (id uuid, full_name text, email text, avatar_url text, xp int, study_streak int, last_seen timestamptz)
language sql security definer set search_path = public as $$
  select p.id, coalesce(p.full_name, '') as full_name, p.email,
         coalesce(p.avatar_url, '') as avatar_url, p.xp, p.study_streak, p.last_seen
  from public.profiles p
  where p.id <> auth.uid()
    and not exists (
      select 1 from public.friendships f
      where (f.requester_id = auth.uid() and f.addressee_id = p.id)
         or (f.addressee_id = auth.uid() and f.requester_id = p.id)
    )
  order by p.last_seen desc nulls last, p.xp desc
  limit 30;
$$;
grant execute on function public.suggested_users() to authenticated;
