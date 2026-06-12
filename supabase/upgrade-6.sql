-- FocusLion upgrade 6: accurate online status (heartbeat) + discover people
-- Paste into Supabase SQL Editor and Run

alter table public.profiles
  add column if not exists last_seen timestamptz;

-- my_friends now also returns last_seen so the client can show accurate status
create or replace function public.my_friends()
returns table (
  friendship_id uuid,
  friend_id uuid,
  full_name text,
  email text,
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
    coalesce(p.full_name, '') as full_name, p.email, p.xp, p.study_streak, f.status,
    case when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end as direction,
    p.last_seen
  from public.friendships f
  join public.profiles p
    on p.id = (case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end)
  where auth.uid() = f.requester_id or auth.uid() = f.addressee_id
  order by f.created_at desc;
$$;
grant execute on function public.my_friends() to authenticated;

-- people you can add (not yourself, not already connected), most recently active first
create or replace function public.suggested_users()
returns table (id uuid, full_name text, email text, xp int, study_streak int, last_seen timestamptz)
language sql security definer set search_path = public as $$
  select p.id, coalesce(p.full_name, '') as full_name, p.email, p.xp, p.study_streak, p.last_seen
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
