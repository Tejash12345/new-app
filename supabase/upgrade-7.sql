-- FocusLion upgrade 7: reliable friend requests
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)
--
-- Fixes:
--  * accounts that never got a profile row (they were invisible everywhere)
--  * two people who both pressed "Add" got stuck as two pending rows forever
--  * prevents duplicate requests in the future + adds one safe RPC to send them

-- 1) Backfill profiles for any account that's missing one
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 2) If both sides requested each other, that's mutual intent — accept
update public.friendships f
set status = 'accepted'
where f.status = 'pending'
  and exists (
    select 1 from public.friendships r
    where r.requester_id = f.addressee_id
      and r.addressee_id = f.requester_id
  );

-- 3) Remove duplicate reverse rows (keep accepted if any, else the oldest)
with ranked as (
  select id,
    row_number() over (
      partition by least(requester_id, addressee_id), greatest(requester_id, addressee_id)
      order by (status = 'accepted') desc, created_at asc
    ) as rn
  from public.friendships
)
delete from public.friendships f
using ranked d
where f.id = d.id and d.rn > 1;

-- 4) Never allow a reverse-duplicate pair again
create unique index if not exists friendships_pair_uniq
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- 5) One safe way to send a request:
--    * if they already asked you -> instantly become friends
--    * if you already asked them -> no duplicate, just report it
--    * otherwise -> create the pending request
create or replace function public.send_friend_request(target uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  existing public.friendships%rowtype;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if target = me then
    return 'self';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'user not found';
  end if;

  select * into existing
  from public.friendships
  where (requester_id = me and addressee_id = target)
     or (requester_id = target and addressee_id = me)
  limit 1;

  if found then
    if existing.status = 'pending' and existing.requester_id = target then
      update public.friendships set status = 'accepted' where id = existing.id;
      return 'accepted';
    end if;
    return existing.status; -- 'pending' (already sent) or 'accepted' (already friends)
  end if;

  insert into public.friendships (requester_id, addressee_id) values (me, target);
  return 'sent';
end $$;

grant execute on function public.send_friend_request(uuid) to authenticated;

-- 6) speed up Discover / online ordering
create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen desc nulls last);
