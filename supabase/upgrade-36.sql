-- FocusLion upgrade 36: WhatsApp-style message editing in DMs
-- Paste into Supabase SQL Editor and Run (safe to run multiple times)
--
-- Message bodies are deliberately immutable at the table level (the UPDATE
-- column-grant from upgrade-30/31 only covers media_state + reactions, and the
-- table's UPDATE policy allows EITHER side — so widening the grant to `body`
-- would let the RECIPIENT rewrite the sender's text). Instead, editing goes
-- through a SECURITY DEFINER RPC that only the ORIGINAL SENDER can call, only
-- on their own text messages, and only within 15 minutes of sending — exactly
-- like WhatsApp. (Same "RPC not a policy" approach as mark_dms_read.)

-- when a message was last edited (null = never edited → no "edited" tag)
alter table public.direct_messages
  add column if not exists edited_at timestamptz;

-- WhatsApp allows edits for 15 minutes after sending
create or replace function public.edit_dm(p_id uuid, p_body text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := now();
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'empty message';
  end if;
  update public.direct_messages
     set body = left(p_body, 500), edited_at = v_at
   where id = p_id
     and sender_id = auth.uid()                       -- only the author
     and coalesce(kind, 'text') = 'text'              -- text messages only
     and created_at > now() - interval '15 minutes';  -- 15-min window
  if not found then
    return null;  -- not yours / too old / not a text message
  end if;
  return v_at;
end;
$$;

grant execute on function public.edit_dm(uuid, text) to authenticated;
