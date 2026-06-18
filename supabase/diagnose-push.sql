-- ============================================================
--  Push-notification diagnostic  (run in Supabase SQL Editor)
--  Goal: find out why DM / friend-request pushes don't reach the phone
--  while feed like/comment pushes do.  Run each section, read the output.
-- ============================================================

-- 1) Which notification triggers are actually installed on prod?
--    You SHOULD see all of: trg_friendship_notify, trg_dm_notify,
--    trg_like_notify, trg_comment_notify, trg_repost_notify, ...
--    If trg_dm_notify or trg_friendship_notify are MISSING, that's the bug —
--    re-run supabase/upgrade-24.sql (it's idempotent) and they'll appear.
select event_object_table as table, trigger_name, event_manipulation as on_event
from information_schema.triggers
where trigger_schema = 'public' and trigger_name like 'trg_%notify%'
order by event_object_table, trigger_name;

-- 2) Is the FCM secret configured?  (send_push is a no-op if this is empty)
select case when exists (select 1 from public.push_config where key = 'fcm_trigger_secret')
            then 'OK — fcm_trigger_secret is set'
            else 'MISSING — set push_config.fcm_trigger_secret (= the FCM_TRIGGER_SECRET function secret)'
       end as fcm_secret_status;

-- 3) Which devices are registered to receive pushes?  (one row per device)
--    If your account has 0 rows here, the app never saved a token — open the
--    app while signed in (the token is upserted on launch / after login).
select p.email, t.platform, left(t.fcm_token, 18) || '…' as token_preview, t.updated_at
from public.user_push_tokens t
join public.profiles p on p.id = t.user_id
order by t.updated_at desc;

-- 4) END-TO-END TEST — send yourself a push right now.
--    Replace the email below with YOUR account's email, then run just this block.
--    Your phone (app installed + signed in + notifications allowed) should buzz.
-- do $$
-- declare me uuid;
-- begin
--   select id into me from public.profiles where email = 'you@example.com';
--   perform public.send_push(
--     me, '🔔 Test push', 'If you see this on your phone, the push path works.',
--     'diag-test', jsonb_build_object('type','announcement'));
-- end $$;
