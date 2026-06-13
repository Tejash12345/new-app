-- FocusLion upgrade 15: let a user delete their own account
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)
--
-- Deletes the caller's auth.users row. Every user-owned table references
-- auth.users(id) ON DELETE CASCADE (profile, tasks, habits, notes, sessions,
-- social limits, feed posts/likes/comments, chat, DMs, friendships, stories,
-- story views), so this removes ALL of their data in one shot. Once the
-- profile is gone the account no longer appears in search, friends,
-- leaderboard or anywhere else to other users.
--
-- Runs as the function owner (postgres) so it can delete from the auth schema,
-- but only ever deletes auth.uid() — the caller themselves.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
