-- FocusLion upgrade 24: Push notifications (Firebase Cloud Messaging)
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- WHAT THIS DOES
--   * user_push_tokens : stores each device's FCM token (the Android app writes here)
--   * announcements    : admin -> everyone broadcasts
--   * push_config      : holds the shared secret the triggers use to call the Edge Function
--   * AFTER-INSERT/UPDATE triggers on friendships, direct_messages, feed_likes,
--     feed_comments, feed_posts (reposts), ai_briefings, announcements that call
--     the `fcm-send` Edge Function via pg_net so a push goes out even when the app
--     is closed.
--
-- BEFORE THIS WORKS you must (see supabase/PUSH_SETUP.md):
--   1. Deploy the `fcm-send` Edge Function with the Firebase service-account secret.
--   2. Run the push_config INSERT at the BOTTOM of this file with your own secret
--      (the SAME value you set as the FCM_TRIGGER_SECRET function secret).

-- ============================================================
-- 0) extensions: pg_net lets Postgres make outbound HTTP calls
-- ============================================================
create extension if not exists pg_net;

-- ============================================================
-- 1) device tokens — one row per device, written by the app on login
-- ============================================================
create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null unique,
  platform text not null default 'android',
  device_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_push_tokens enable row level security;

drop policy if exists "push tokens read own" on public.user_push_tokens;
create policy "push tokens read own" on public.user_push_tokens
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "push tokens insert own" on public.user_push_tokens;
create policy "push tokens insert own" on public.user_push_tokens
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "push tokens update own" on public.user_push_tokens;
create policy "push tokens update own" on public.user_push_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push tokens delete own" on public.user_push_tokens;
create policy "push tokens delete own" on public.user_push_tokens
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists user_push_tokens_user_idx on public.user_push_tokens(user_id);

-- ============================================================
-- 2) admin announcements — broadcast to everyone
-- ============================================================
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to authenticated using (true);

drop policy if exists "announcements insert admin" on public.announcements;
create policy "announcements insert admin" on public.announcements
  for insert to authenticated with check (public.is_admin());

drop policy if exists "announcements delete admin" on public.announcements;
create policy "announcements delete admin" on public.announcements
  for delete to authenticated using (public.is_admin());

-- ============================================================
-- 3) private config table — holds the trigger -> Edge Function shared secret.
--    RLS is ON with NO policies, so anon/authenticated clients can read NOTHING.
--    Only SECURITY DEFINER functions (which bypass RLS) can read it.
-- ============================================================
create table if not exists public.push_config (
  key text primary key,
  value text not null
);
alter table public.push_config enable row level security;

-- ============================================================
-- 4) senders — thin wrappers around the fcm-send Edge Function via pg_net
-- ============================================================
-- target a single user
create or replace function public.send_push(
  p_user_id uuid,
  p_title   text,
  p_body    text,
  p_tag     text  default null,
  p_data    jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  if p_user_id is null then return; end if;
  select value into v_secret from public.push_config where key = 'fcm_trigger_secret';
  if v_secret is null then return; end if;   -- not configured yet -> no-op
  perform net.http_post(
    url     := 'https://hgnbgnzgciooifwyfbgn.supabase.co/functions/v1/fcm-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fcm-secret', v_secret),
    body    := jsonb_build_object(
      'user_id', p_user_id, 'title', p_title, 'body', p_body, 'tag', p_tag, 'data', p_data
    )
  );
end;
$$;

-- broadcast to everyone with a registered device
create or replace function public.send_push_broadcast(
  p_title text,
  p_body  text,
  p_tag   text  default null,
  p_data  jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select value into v_secret from public.push_config where key = 'fcm_trigger_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url     := 'https://hgnbgnzgciooifwyfbgn.supabase.co/functions/v1/fcm-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fcm-secret', v_secret),
    body    := jsonb_build_object(
      'broadcast', true, 'title', p_title, 'body', p_body, 'tag', p_tag, 'data', p_data
    )
  );
end;
$$;

-- ============================================================
-- 5) trigger functions — one per event
-- ============================================================

-- friend request received / accepted
create or replace function public.tg_friendship_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if (TG_OP = 'INSERT' and NEW.status = 'pending') then
    select coalesce(nullif(full_name, ''), 'Someone') into v_name
      from public.profiles where id = NEW.requester_id;
    perform public.send_push(
      NEW.addressee_id, '👋 New friend request',
      coalesce(v_name, 'Someone') || ' sent you a friend request.',
      'friendreq-' || NEW.id::text,
      jsonb_build_object('type', 'friend_request', 'from', NEW.requester_id));
  elsif (TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status is distinct from 'accepted') then
    select coalesce(nullif(full_name, ''), 'Someone') into v_name
      from public.profiles where id = NEW.addressee_id;
    perform public.send_push(
      NEW.requester_id, '✅ Friend request accepted',
      coalesce(v_name, 'Someone') || ' accepted your friend request.',
      'friendacc-' || NEW.id::text,
      jsonb_build_object('type', 'friend_accept', 'from', NEW.addressee_id));
  end if;
  return NEW;
end;
$$;

-- new direct message
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
    v_preview, 'dm-' || NEW.sender_id::text,
    jsonb_build_object('type', 'dm', 'from', NEW.sender_id));
  return NEW;
end;
$$;

-- new like on your post
create or replace function public.tg_like_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_name text;
begin
  select user_id into v_owner from public.feed_posts where id = NEW.post_id;
  if v_owner is null or v_owner = NEW.user_id then return NEW; end if;
  select coalesce(nullif(full_name, ''), 'Someone') into v_name
    from public.profiles where id = NEW.user_id;
  perform public.send_push(
    v_owner, '❤️ New like',
    coalesce(v_name, 'Someone') || ' liked your post.',
    'like-' || NEW.id::text,
    jsonb_build_object('type', 'like', 'post', NEW.post_id));
  return NEW;
end;
$$;

-- new comment on your post
create or replace function public.tg_comment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.feed_posts where id = NEW.post_id;
  if v_owner is null or v_owner = NEW.user_id then return NEW; end if;
  perform public.send_push(
    v_owner, '💬 New comment',
    coalesce(nullif(NEW.author_name, ''), 'Someone') || ' commented: ' || left(coalesce(NEW.body, ''), 100),
    'cmt-' || NEW.id::text,
    jsonb_build_object('type', 'comment', 'post', NEW.post_id));
  return NEW;
end;
$$;

-- someone reposted your post (a feed_posts row with repost_of set)
create or replace function public.tg_repost_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_name text;
begin
  if NEW.repost_of is null then return NEW; end if;
  v_owner := NEW.original_user_id;
  if v_owner is null then
    select user_id into v_owner from public.feed_posts where id = NEW.repost_of;
  end if;
  if v_owner is null or v_owner = NEW.user_id then return NEW; end if;
  select coalesce(nullif(full_name, ''), 'Someone') into v_name
    from public.profiles where id = NEW.user_id;
  perform public.send_push(
    v_owner, '🔁 New repost',
    coalesce(v_name, 'Someone') || ' reposted your post.',
    'repost-' || NEW.id::text,
    jsonb_build_object('type', 'repost', 'post', NEW.repost_of));
  return NEW;
end;
$$;

-- daily AI briefing ready
create or replace function public.tg_briefing_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.send_push(
    NEW.user_id, '🦁 Your daily briefing is ready',
    'Tap to see your plan and motivation for today.',
    'brief-' || NEW.brief_date::text,
    jsonb_build_object('type', 'ai_briefing'));
  return NEW;
end;
$$;

-- admin announcement -> everyone
create or replace function public.tg_announcement_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.send_push_broadcast(
    '📣 ' || NEW.title,
    left(coalesce(NEW.body, ''), 160),
    'announce-' || NEW.id::text,
    jsonb_build_object('type', 'announcement', 'id', NEW.id));
  return NEW;
end;
$$;

-- ============================================================
-- 6) wire the triggers (drop-then-create so re-running is safe)
-- ============================================================
drop trigger if exists trg_friendship_notify on public.friendships;
create trigger trg_friendship_notify
  after insert or update on public.friendships
  for each row execute function public.tg_friendship_notify();

drop trigger if exists trg_dm_notify on public.direct_messages;
create trigger trg_dm_notify
  after insert on public.direct_messages
  for each row execute function public.tg_dm_notify();

drop trigger if exists trg_like_notify on public.feed_likes;
create trigger trg_like_notify
  after insert on public.feed_likes
  for each row execute function public.tg_like_notify();

drop trigger if exists trg_comment_notify on public.feed_comments;
create trigger trg_comment_notify
  after insert on public.feed_comments
  for each row execute function public.tg_comment_notify();

drop trigger if exists trg_repost_notify on public.feed_posts;
create trigger trg_repost_notify
  after insert on public.feed_posts
  for each row execute function public.tg_repost_notify();

drop trigger if exists trg_briefing_notify on public.ai_briefings;
create trigger trg_briefing_notify
  after insert on public.ai_briefings
  for each row execute function public.tg_briefing_notify();

drop trigger if exists trg_announcement_notify on public.announcements;
create trigger trg_announcement_notify
  after insert on public.announcements
  for each row execute function public.tg_announcement_notify();

-- ============================================================
-- 7) realtime (optional, lets the web app live-update the token list)
-- ============================================================
do $$ begin
  alter publication supabase_realtime add table public.announcements;
exception when duplicate_object then null; end $$;

-- ============================================================
-- 8) >>> YOU MUST RUN THIS ONCE <<<  (do NOT commit your real secret to git)
--     Use the SAME value you set as the FCM_TRIGGER_SECRET Edge Function secret.
--     Generate one with, e.g.:  openssl rand -hex 32
-- ============================================================
-- insert into public.push_config (key, value)
-- values ('fcm_trigger_secret', 'PASTE-YOUR-RANDOM-SECRET-HERE')
-- on conflict (key) do update set value = excluded.value;
