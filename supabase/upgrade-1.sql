-- FocusLion upgrade 1: scheduled hours for social media apps
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

alter table public.social_limits
  add column if not exists schedule_enabled boolean not null default false,
  add column if not exists allowed_from_min int not null default 1080,  -- 6:00 PM
  add column if not exists allowed_until_min int not null default 1200; -- 8:00 PM
