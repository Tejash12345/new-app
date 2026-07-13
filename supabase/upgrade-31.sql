-- FocusLion upgrade 31: message reactions + read receipts in DMs
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- one emoji per person per message: {"<user_id>": "❤️"}
alter table public.direct_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

-- authenticated may update ONLY these columns (bodies stay immutable);
-- extends the media_state-only grant from upgrade-30
grant update (media_state, reactions) on public.direct_messages to authenticated;

-- read receipts: one row per reader per conversation partner
create table if not exists public.dm_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  peer_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);

alter table public.dm_reads enable row level security;

drop policy if exists "reads insert own" on public.dm_reads;
create policy "reads insert own" on public.dm_reads
  for insert with check (auth.uid() = user_id);

drop policy if exists "reads update own" on public.dm_reads;
create policy "reads update own" on public.dm_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reads visible to both" on public.dm_reads;
create policy "reads visible to both" on public.dm_reads
  for select using (auth.uid() = user_id or auth.uid() = peer_id);
