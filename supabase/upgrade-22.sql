-- FocusLion upgrade 22: AI Career Coach + AI Startup Co-Founder
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- Persist the AI-generated reports/plans so users can revisit them. The report
-- payload is stored as jsonb. All rows are private to their owner.

-- ---------- career reports ----------
create table if not exists public.career_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.career_reports enable row level security;

drop policy if exists "career reports read own" on public.career_reports;
create policy "career reports read own" on public.career_reports
  for select using (auth.uid() = user_id);

drop policy if exists "career reports insert own" on public.career_reports;
create policy "career reports insert own" on public.career_reports
  for insert with check (auth.uid() = user_id);

drop policy if exists "career reports delete own" on public.career_reports;
create policy "career reports delete own" on public.career_reports
  for delete using (auth.uid() = user_id);

create index if not exists career_reports_user_idx on public.career_reports (user_id, created_at);

-- ---------- startup plans ----------
create table if not exists public.startup_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idea text not null,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.startup_plans enable row level security;

drop policy if exists "startup plans read own" on public.startup_plans;
create policy "startup plans read own" on public.startup_plans
  for select using (auth.uid() = user_id);

drop policy if exists "startup plans insert own" on public.startup_plans;
create policy "startup plans insert own" on public.startup_plans
  for insert with check (auth.uid() = user_id);

drop policy if exists "startup plans delete own" on public.startup_plans;
create policy "startup plans delete own" on public.startup_plans
  for delete using (auth.uid() = user_id);

create index if not exists startup_plans_user_idx on public.startup_plans (user_id, created_at);
