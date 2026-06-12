-- FocusLion upgrade 3: friends system
-- Paste into Supabase SQL Editor and Run

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',  -- pending | accepted
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

alter table public.friendships enable row level security;

-- see rows where you are either side
create policy "friendship read own" on public.friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
-- only send requests as yourself
create policy "friendship insert own" on public.friendships
  for insert with check (auth.uid() = requester_id);
-- only the addressee can accept (update status)
create policy "friendship accept" on public.friendships
  for update using (auth.uid() = addressee_id);
-- either side can remove / cancel / decline
create policy "friendship delete own" on public.friendships
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- search other students by name (limited public fields)
create or replace function public.search_users(q text)
returns table (id uuid, full_name text, xp int, study_streak int)
language sql security definer set search_path = public as $$
  select id, full_name, xp, study_streak
  from public.profiles
  where id <> auth.uid()
    and coalesce(full_name, '') <> ''
    and full_name ilike '%' || q || '%'
  order by xp desc
  limit 12;
$$;
grant execute on function public.search_users(text) to authenticated;

-- list my friends + requests with their profile info, in one call
create or replace function public.my_friends()
returns table (
  friendship_id uuid,
  friend_id uuid,
  full_name text,
  xp int,
  study_streak int,
  status text,
  direction text
)
language sql security definer set search_path = public as $$
  select
    f.id as friendship_id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as friend_id,
    p.full_name, p.xp, p.study_streak, f.status,
    case when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end as direction
  from public.friendships f
  join public.profiles p
    on p.id = (case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end)
  where auth.uid() = f.requester_id or auth.uid() = f.addressee_id
  order by f.created_at desc;
$$;
grant execute on function public.my_friends() to authenticated;

alter publication supabase_realtime add table public.friendships;
