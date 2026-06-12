-- FocusLion upgrade 4: private direct messages between accepted friends
-- Paste into Supabase SQL Editor and Run

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.direct_messages enable row level security;

-- read only your own conversations
create policy "dm read own" on public.direct_messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- send only as yourself AND only to an accepted friend
create policy "dm send to friends" on public.direct_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = sender_id and f.addressee_id = recipient_id) or
          (f.requester_id = recipient_id and f.addressee_id = sender_id)
        )
    )
  );

-- delete your own messages
create policy "dm delete own" on public.direct_messages
  for delete using (auth.uid() = sender_id);

create index if not exists dm_pair_idx
  on public.direct_messages(sender_id, recipient_id, created_at);

alter publication supabase_realtime add table public.direct_messages;
