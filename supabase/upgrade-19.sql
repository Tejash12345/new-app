-- FocusLion upgrade 19: Lion AI Assistant (Gemini)
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- The Gemini API key is NOT stored here or in the app — it lives only in the
-- lion-ai Edge Function secret. These tables hold chat history, daily missions
-- and per-user AI usage stats. All rows are private to their owner.

-- ---------- AI chat history ----------
create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  task text not null default 'chat',
  created_at timestamptz not null default now()
);
alter table public.ai_messages enable row level security;

drop policy if exists "ai messages read own" on public.ai_messages;
create policy "ai messages read own" on public.ai_messages
  for select using (auth.uid() = user_id);

drop policy if exists "ai messages insert own" on public.ai_messages;
create policy "ai messages insert own" on public.ai_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai messages delete own" on public.ai_messages;
create policy "ai messages delete own" on public.ai_messages
  for delete using (auth.uid() = user_id);

create index if not exists ai_messages_user_idx on public.ai_messages (user_id, created_at);

-- ---------- Daily Lion missions ----------
create table if not exists public.ai_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_date date not null default current_date,
  title text not null,
  detail text not null default '',
  xp integer not null default 20,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, mission_date)
);
alter table public.ai_missions enable row level security;

drop policy if exists "ai missions read own" on public.ai_missions;
create policy "ai missions read own" on public.ai_missions
  for select using (auth.uid() = user_id);

drop policy if exists "ai missions insert own" on public.ai_missions;
create policy "ai missions insert own" on public.ai_missions
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai missions update own" on public.ai_missions;
create policy "ai missions update own" on public.ai_missions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ai missions delete own" on public.ai_missions;
create policy "ai missions delete own" on public.ai_missions
  for delete using (auth.uid() = user_id);

-- ---------- AI usage statistics (per user per day) ----------
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  used_on date not null default current_date,
  calls integer not null default 0,
  last_task text,
  updated_at timestamptz not null default now(),
  unique (user_id, used_on)
);
alter table public.ai_usage enable row level security;

drop policy if exists "ai usage read own" on public.ai_usage;
create policy "ai usage read own" on public.ai_usage
  for select using (auth.uid() = user_id);

drop policy if exists "ai usage upsert own" on public.ai_usage;
create policy "ai usage upsert own" on public.ai_usage
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai usage update own" on public.ai_usage;
create policy "ai usage update own" on public.ai_usage
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Atomic "record one AI call today" helper, called from the client after a
-- successful AI response (keeps the per-day counter correct without races).
create or replace function public.record_ai_usage(p_task text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_usage (user_id, used_on, calls, last_task, updated_at)
  values (auth.uid(), current_date, 1, p_task, now())
  on conflict (user_id, used_on)
  do update set calls = public.ai_usage.calls + 1,
                last_task = excluded.last_task,
                updated_at = now();
end;
$$;

grant execute on function public.record_ai_usage(text) to authenticated;
