-- FocusLion upgrade 16: private accounts (Instagram-style)
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)
--
-- When a user turns on "Private account":
--   * their feed posts are visible only to themselves and their ACCEPTED friends
--   * everyone else simply doesn't see those posts (enforced here in the
--     database, so it can't be bypassed from the client)
-- Follow requests already require approval — that's the existing friendships
-- flow (pending -> accepted), so nothing extra is needed for that.

-- 1) the flag itself
alter table public.profiles
  add column if not exists is_private boolean not null default false;

-- 2) helper: are two users accepted friends? (SECURITY DEFINER so the feed
--    policy can check friendship without being blocked by friendships' own RLS)
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = a and f.addressee_id = b) or
        (f.requester_id = b and f.addressee_id = a)
      )
  );
$$;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- 3) helper: is this account private? (SECURITY DEFINER so the feed policy can
--    read another user's flag — profiles' RLS only lets you read your own row)
create or replace function public.is_account_private(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_private from public.profiles where id = uid), false);
$$;
grant execute on function public.is_account_private(uuid) to authenticated;

-- 4) feed visibility: your own posts always; public accounts' posts to anyone;
--    private accounts' posts only to accepted friends
drop policy if exists "feed read all" on public.feed_posts;
drop policy if exists "feed read public or friends" on public.feed_posts;
create policy "feed read public or friends" on public.feed_posts
  for select to authenticated using (
    user_id = auth.uid()
    or not public.is_account_private(user_id)
    or public.are_friends(auth.uid(), user_id)
  );

-- keeps the friendship lookup fast for the policy above
create index if not exists friendships_status_pair_idx
  on public.friendships (status, requester_id, addressee_id);

-- 5) likes & comments inherit the post's visibility. The exists() subquery is
--    itself filtered by feed_posts' policy above, so a private post you can't
--    see also hides its likes/comments — no extra privacy logic needed.
drop policy if exists "likes read all" on public.feed_likes;
drop policy if exists "likes read visible" on public.feed_likes;
create policy "likes read visible" on public.feed_likes
  for select to authenticated using (
    exists (select 1 from public.feed_posts p where p.id = post_id)
  );

drop policy if exists "comments read all" on public.feed_comments;
drop policy if exists "comments read visible" on public.feed_comments;
create policy "comments read visible" on public.feed_comments
  for select to authenticated using (
    exists (select 1 from public.feed_posts p where p.id = post_id)
  );
