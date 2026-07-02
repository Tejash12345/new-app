-- upgrade-27: AI Quiz Arena — per-user quiz history.
-- Run this in the Supabase SQL Editor. The Quiz page works without it
-- (results just aren't saved to history until the table exists).

create table if not exists public.quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  difficulty text not null default 'Medium',   -- Easy | Medium | Hard
  score int not null default 0,                -- correct answers
  total int not null default 0,                -- questions asked
  xp int not null default 0,                   -- XP earned for this quiz
  created_at timestamptz not null default now()
);
alter table public.quiz_results enable row level security;
create policy "quiz all own" on public.quiz_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists quiz_user_idx on public.quiz_results(user_id, created_at desc);

-- realtime (so the history list refreshes instantly after a quiz)
do $$ begin
  alter publication supabase_realtime add table public.quiz_results;
exception when duplicate_object then null; end $$;
