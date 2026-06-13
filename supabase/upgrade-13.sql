-- FocusLion upgrade 13: live avatar lookup for feed & community chat
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)
--
-- Feed posts/comments and chat messages only stored a denormalised
-- author_avatar_url captured at write time, so older content (and content
-- written before someone set a photo) showed no picture. This view lets the
-- client look up everyone's CURRENT avatar by user id — always up to date,
-- and covering all existing content.
--
-- Like the leaderboard view, this runs with the owner's rights, so it can
-- expose names/avatars across users without opening up the profiles table's
-- row-level security. avatar_url is already effectively public (public feed,
-- public avatars bucket), so this is consistent with the app's existing model.

create or replace view public.public_profiles as
  select id, coalesce(full_name, '') as full_name, coalesce(avatar_url, '') as avatar_url
  from public.profiles;

grant select on public.public_profiles to authenticated;
