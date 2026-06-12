-- FocusLion upgrade 2: real-time community chat
-- Paste into Supabase SQL Editor and Run

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room text not null default 'general',
  body text not null,
  author_name text not null default 'Anonymous lion',
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

-- any signed-in user can read all rooms
create policy "chat read all" on public.chat_messages
  for select using (auth.uid() is not null);

-- users can only send as themselves
create policy "chat insert own" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- users can delete their own messages
create policy "chat delete own" on public.chat_messages
  for delete using (auth.uid() = user_id);

create index if not exists chat_room_idx on public.chat_messages(room, created_at desc);

-- realtime delivery
alter publication supabase_realtime add table public.chat_messages;
