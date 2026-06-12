-- FocusLion upgrade 5: search friends by name OR email, return email fallback
-- Paste into Supabase SQL Editor and Run

create or replace function public.search_users(q text)
returns table (id uuid, full_name text, email text, xp int, study_streak int)
language sql security definer set search_path = public as $$
  select id, coalesce(full_name, '') as full_name, email, xp, study_streak
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

create or replace function public.my_friends()
returns table (
  friendship_id uuid,
  friend_id uuid,
  full_name text,
  email text,
  xp int,
  study_streak int,
  status text,
  direction text
)
language sql security definer set search_path = public as $$
  select
    f.id as friendship_id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as friend_id,
    coalesce(p.full_name, '') as full_name, p.email, p.xp, p.study_streak, f.status,
    case when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end as direction
  from public.friendships f
  join public.profiles p
    on p.id = (case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end)
  where auth.uid() = f.requester_id or auth.uid() = f.addressee_id
  order by f.created_at desc;
$$;
grant execute on function public.my_friends() to authenticated;
