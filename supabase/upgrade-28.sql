-- upgrade-28: DM read tracking → app-wide unread badge on the Chat nav.
-- Adds read_at to direct_messages plus two RPCs. No UPDATE policy is added on
-- purpose: recipients mark messages read ONLY through mark_dms_read (security
-- definer), so they can never edit message rows themselves.

alter table public.direct_messages
  add column if not exists read_at timestamptz;

-- fast unread lookups per recipient
create index if not exists idx_dm_unread
  on public.direct_messages (recipient_id, sender_id)
  where read_at is null;

-- unread counts per sender for the signed-in user (badge seed on app load)
create or replace function public.dm_unread_counts()
returns table (sender_id uuid, unread bigint)
language sql
security definer
set search_path = public
as $$
  select sender_id, count(*)::bigint
  from direct_messages
  where recipient_id = auth.uid() and read_at is null
  group by sender_id;
$$;

-- mark everything from one sender as read (called when their thread is opened)
create or replace function public.mark_dms_read(peer uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update direct_messages
  set read_at = now()
  where recipient_id = auth.uid() and sender_id = peer and read_at is null;
$$;

revoke execute on function public.dm_unread_counts() from anon;
revoke execute on function public.mark_dms_read(uuid) from anon;
grant execute on function public.dm_unread_counts() to authenticated;
grant execute on function public.mark_dms_read(uuid) to authenticated;
