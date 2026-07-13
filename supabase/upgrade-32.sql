-- FocusLion upgrade 32: disappearing messages in DMs
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)

-- messages sent while a chat's timer is on carry their expiry
alter table public.direct_messages
  add column if not exists expires_at timestamptz;

-- the shared per-conversation timer (a < b keeps one row per pair)
create table if not exists public.dm_pairs (
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  ttl_seconds int not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

alter table public.dm_pairs enable row level security;

drop policy if exists "pairs read own" on public.dm_pairs;
create policy "pairs read own" on public.dm_pairs
  for select using (auth.uid() = a or auth.uid() = b);

drop policy if exists "pairs insert own" on public.dm_pairs;
create policy "pairs insert own" on public.dm_pairs
  for insert with check (auth.uid() = a or auth.uid() = b);

drop policy if exists "pairs update own" on public.dm_pairs;
create policy "pairs update own" on public.dm_pairs
  for update using (auth.uid() = a or auth.uid() = b)
  with check (auth.uid() = a or auth.uid() = b);

-- either side may clear a message once it has expired (the normal delete
-- policy stays sender-only)
drop policy if exists "dm delete expired" on public.direct_messages;
create policy "dm delete expired" on public.direct_messages
  for delete using (
    (auth.uid() = sender_id or auth.uid() = recipient_id)
    and expires_at is not null and expires_at < now()
  );
