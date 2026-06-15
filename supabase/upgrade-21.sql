-- FocusLion upgrade 21: weekly leaderboard
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- Ranks opt-in users by the XP they earned in the last 7 days, summed from the
-- xp_events log. Like the all-time `leaderboard` view, this is a definer view
-- so authenticated users can read the aggregate without exposing others' rows.

create or replace view public.weekly_leaderboard as
  select
    p.id,
    p.full_name,
    p.avatar_url,
    coalesce(sum(e.amount) filter (where e.created_at >= now() - interval '7 days'), 0)::int as xp,
    p.study_streak
  from public.profiles p
  left join public.xp_events e on e.user_id = p.id
  where coalesce(p.settings->>'leaderboard', 'true') = 'true'
  group by p.id, p.full_name, p.avatar_url, p.study_streak
  order by xp desc
  limit 50;

grant select on public.weekly_leaderboard to authenticated;
