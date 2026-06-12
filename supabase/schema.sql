-- ============================================================
-- FocusLion — Supabase schema
-- Paste this whole file into: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text default '',
  avatar_url text default '',
  role text not null default 'student', -- student | admin
  xp integer not null default 0,
  study_streak integer not null default 0,
  last_study_date date,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles
  for insert with check (auth.uid() = id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- generic helper for user-owned tables ----------
-- (pattern repeated per table; Supabase RLS requires per-table policies)

-- ---------- tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text default '',
  kind text not null default 'task',           -- task | assignment | exam | goal
  subject text default '',
  priority int not null default 1,             -- 0 low 1 med 2 high
  due_at timestamptz,
  done boolean not null default false,
  progress int not null default 0,             -- 0-100 (goals/exam prep)
  created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
create policy "tasks all own" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists tasks_user_idx on public.tasks(user_id, kind);

-- ---------- timetable blocks ----------
create table if not exists public.timetable_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_of_week int not null,                    -- 0 Mon .. 6 Sun
  start_min int not null,                      -- minutes from midnight
  end_min int not null,
  title text not null,
  subject text default '',
  color text default '#6C8CFF',
  created_at timestamptz not null default now()
);
alter table public.timetable_blocks enable row level security;
create policy "timetable all own" on public.timetable_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists timetable_user_idx on public.timetable_blocks(user_id);

-- ---------- study sessions (pomodoro / focus) ----------
create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  duration_min int not null,
  subject text default '',
  mode text not null default 'pomodoro',       -- pomodoro | focus
  created_at timestamptz not null default now()
);
alter table public.study_sessions enable row level security;
create policy "sessions all own" on public.study_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists sessions_user_idx on public.study_sessions(user_id, started_at);

-- ---------- habits ----------
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text default '🌟',
  color text default '#6C8CFF',
  checks jsonb not null default '[]'::jsonb,   -- array of 'YYYY-MM-DD'
  created_at timestamptz not null default now()
);
alter table public.habits enable row level security;
create policy "habits all own" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- notes ----------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default '',
  body text default '',                        -- rich text (HTML)
  color int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.notes enable row level security;
create policy "notes all own" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- flashcards ----------
create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck text not null default 'General',
  front text not null,
  back text not null,
  ease int not null default 0,                 -- simple spaced level 0-5
  created_at timestamptz not null default now()
);
alter table public.flashcards enable row level security;
create policy "flashcards all own" on public.flashcards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- journal (incl. mood) ----------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  mood int not null default 0,                 -- 0 none, 1-5
  body text default '',
  created_at timestamptz not null default now(),
  unique (user_id, entry_date)
);
alter table public.journal_entries enable row level security;
create policy "journal all own" on public.journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- social media limits ----------
create table if not exists public.social_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_name text not null,                      -- Instagram | YouTube | ...
  daily_limit_min int not null default 30,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, app_name)
);
alter table public.social_limits enable row level security;
create policy "limits all own" on public.social_limits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- social usage sessions ----------
create table if not exists public.social_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_name text not null,
  used_min int not null,
  used_on date not null default current_date,
  created_at timestamptz not null default now()
);
alter table public.social_sessions enable row level security;
create policy "usage all own" on public.social_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists social_user_idx on public.social_sessions(user_id, used_on);

-- ---------- xp events (gamification log) ----------
create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.xp_events enable row level security;
create policy "xp all own" on public.xp_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- leaderboard view (opt-in via profiles.settings->>'leaderboard') ----------
create or replace view public.leaderboard as
  select id, full_name, xp, study_streak
  from public.profiles
  where coalesce(settings->>'leaderboard', 'true') = 'true'
  order by xp desc
  limit 50;

-- allow signed-in users to read the leaderboard
grant select on public.leaderboard to authenticated;

-- ---------- admin ----------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create policy "admin_read_all_profiles" on public.profiles
  for select using (public.is_admin());

-- ---------- realtime ----------
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.habits;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.social_sessions;
