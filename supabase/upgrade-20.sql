-- FocusLion upgrade 20: Lion Life OS + AI Learning Paths
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- ai_briefings: caches the AI "good morning" briefing once per day per user.
-- learning_paths: an AI-generated roadmap the user works through; progress is
-- tracked inside the steps jsonb (each step has a `done` flag).

-- ---------- daily AI briefing cache ----------
create table if not exists public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null default current_date,
  text text not null,
  created_at timestamptz not null default now(),
  unique (user_id, brief_date)
);
alter table public.ai_briefings enable row level security;

drop policy if exists "ai briefings read own" on public.ai_briefings;
create policy "ai briefings read own" on public.ai_briefings
  for select using (auth.uid() = user_id);

drop policy if exists "ai briefings insert own" on public.ai_briefings;
create policy "ai briefings insert own" on public.ai_briefings
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai briefings update own" on public.ai_briefings;
create policy "ai briefings update own" on public.ai_briefings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- AI learning paths ----------
create table if not exists public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  level text not null default 'beginner',
  summary text not null default '',
  steps jsonb not null default '[]'::jsonb,   -- [{ id, title, detail, done }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.learning_paths enable row level security;

drop policy if exists "learning paths read own" on public.learning_paths;
create policy "learning paths read own" on public.learning_paths
  for select using (auth.uid() = user_id);

drop policy if exists "learning paths insert own" on public.learning_paths;
create policy "learning paths insert own" on public.learning_paths
  for insert with check (auth.uid() = user_id);

drop policy if exists "learning paths update own" on public.learning_paths;
create policy "learning paths update own" on public.learning_paths
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "learning paths delete own" on public.learning_paths;
create policy "learning paths delete own" on public.learning_paths
  for delete using (auth.uid() = user_id);

create index if not exists learning_paths_user_idx on public.learning_paths (user_id, created_at);
