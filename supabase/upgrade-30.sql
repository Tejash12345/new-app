-- FocusLion upgrade 30: WhatsApp-style device-first chat media
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)
--
-- Media now lives on the two devices; the server is only the postman.
-- media_state tracks the handover:
--   'stored'    file is in the chat-media bucket, waiting for the recipient
--   'delivered' recipient saved it into their device vault (IndexedDB)
--   'purged'    sender confirmed delivery and removed the server copy

alter table public.direct_messages
  add column if not exists media_state text not null default 'stored';

-- either side may flip the state, but ONLY that column — column-level
-- grants keep message bodies immutable
revoke update on public.direct_messages from authenticated;
grant update (media_state) on public.direct_messages to authenticated;

drop policy if exists "dm update media state" on public.direct_messages;
create policy "dm update media state" on public.direct_messages
  for update using (auth.uid() = sender_id or auth.uid() = recipient_id)
  with check (auth.uid() = sender_id or auth.uid() = recipient_id);
