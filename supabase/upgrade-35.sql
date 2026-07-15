-- upgrade 35: fix "some DM messages don't notify" — the notification tag was
-- dm-<sender>, so rapid messages from the same person collapsed into ONE
-- notification (some OEMs suppress the repeat alert). Use the MESSAGE id as the
-- tag so every message is its own notification and always alerts. (In-app
-- notify() uses the same dm-<msgId> tag, so a foreground message still shows
-- once, not twice.)
create or replace function public.tg_dm_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_preview text;
begin
  select coalesce(nullif(full_name, ''), 'Someone') into v_name
    from public.profiles where id = NEW.sender_id;
  v_preview := case coalesce(NEW.kind, 'text')
    when 'image' then '📷 Photo'
    when 'audio' then '🎤 Voice message'
    when 'file'  then '📎 ' || coalesce(NEW.file_name, 'File')
    else left(coalesce(NEW.body, ''), 120)
  end;
  perform public.send_push(
    NEW.recipient_id, '💬 ' || coalesce(v_name, 'New message'),
    v_preview, 'dm-' || NEW.id::text,     -- per-MESSAGE tag (was per-sender)
    jsonb_build_object('type', 'dm', 'sender', NEW.sender_id));
  return NEW;
end;
$$;
