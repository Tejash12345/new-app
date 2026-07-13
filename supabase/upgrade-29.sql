-- FocusLion upgrade 29: WhatsApp-style replies in chat
-- Paste into Supabase SQL Editor and Run
--
-- A reply stores the quoted message's id plus a snapshot of its snippet and
-- sender name, so the quote keeps rendering even if the original message is
-- later deleted or falls outside the loaded history window.

alter table public.direct_messages
  add column if not exists reply_to uuid references public.direct_messages(id) on delete set null,
  add column if not exists reply_snippet text,
  add column if not exists reply_name text;

-- community rooms get the same columns (UI lands next)
alter table public.chat_messages
  add column if not exists reply_to uuid references public.chat_messages(id) on delete set null,
  add column if not exists reply_snippet text,
  add column if not exists reply_name text;
