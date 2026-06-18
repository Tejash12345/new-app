# FocusLion Push Notifications — Setup & Deploy

This wires real push (Firebase Cloud Messaging) for every social event, working
**even when the app is closed**.

```
DB insert (like / comment / DM / friend req / repost / briefing / announcement)
  -> Postgres AFTER trigger
     -> public.send_push() / send_push_broadcast()  (pg_net HTTP call)
        -> Edge Function  fcm-send
           -> FCM HTTP v1
              -> user's phone(s)
```

Pieces in the repo:
- `supabase/upgrade-24.sql` — token table, announcements table, triggers
- `supabase/functions/fcm-send/index.ts` — the sender
- Flutter `lib/main.dart` — saves each device's token to `user_push_tokens`

Project ref: **hgnbgnzgciooifwyfbgn** · Firebase project: **focuslion-b6b7a**

---

## Step 1 — Firebase service-account key

1. Firebase Console → ⚙ **Project settings** → **Service accounts**
2. **Generate new private key** → downloads a JSON file (keep it secret — it grants send rights)

## Step 2 — A random trigger secret

Generate one (any long random string). Examples:
```bash
openssl rand -hex 32
```
Save it — you'll paste the **same value** in Step 3 (function secret) and Step 5 (SQL).

## Step 3 — Deploy the Edge Function

Install + log in to the Supabase CLI if you haven't:
```bash
npm install -g supabase
supabase login
supabase link --project-ref hgnbgnzgciooifwyfbgn
```

Set the secrets (run from the repo root, point at your downloaded key file):
```bash
supabase secrets set FCM_PROJECT_ID=focuslion-b6b7a
supabase secrets set FCM_TRIGGER_SECRET=<the-secret-from-step-2>
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat /path/to/service-account.json)"
```
> Windows PowerShell variant for the last one:
> ```powershell
> supabase secrets set FCM_SERVICE_ACCOUNT="$(Get-Content -Raw .\service-account.json)"
> ```

Deploy (note `--no-verify-jwt` — the function authenticates via the secret header, not a user JWT):
```bash
supabase functions deploy fcm-send --no-verify-jwt
```

## Step 4 — Run the SQL

Open **Supabase → SQL Editor**, paste all of `supabase/upgrade-24.sql`, and **Run**.
(Creates the tables, `pg_net`, the senders, and all triggers.)

## Step 5 — Store the trigger secret in the DB

In the SQL Editor, run this **once** with the SAME secret from Step 2
(keep it out of git):
```sql
insert into public.push_config (key, value)
values ('fcm_trigger_secret', '<the-secret-from-step-2>')
on conflict (key) do update set value = excluded.value;
```

## Step 6 — Ship the app

The token-registration code is already in `lib/main.dart`. Rebuild + install so
each device starts saving its token:
```bash
cd C:\dev\apps\focuslion_app
C:\dev\flutter\bin\flutter.bat build apk --release
```
On first launch (signed in), the app upserts its token into `user_push_tokens`.

---

## Test it

1. Open the app on a phone, signed in. Confirm a row appears:
   `select user_id, platform, created_at from user_push_tokens;`
2. From **another** account, like/comment on that user's post, or send them a DM.
   The phone should get a push (foreground = in-app style; background = system tray).
3. **Announcement to everyone** (admin account):
   ```sql
   insert into public.announcements (title, body, created_by)
   values ('We just shipped reels 🎬', 'Open the Feed to try it.', auth.uid());
   ```

## Events covered

| Event | Table → trigger | Recipient |
|---|---|---|
| Friend request / accepted | `friendships` | addressee / requester |
| Direct message | `direct_messages` | recipient |
| Like | `feed_likes` | post owner |
| Comment | `feed_comments` | post owner |
| Repost | `feed_posts` (repost_of) | original owner |
| Daily AI briefing ready | `ai_briefings` | that user |
| Announcement | `announcements` | everyone |

> "New follower" maps to the friend-request notification — the app uses a
> friendship model, not a separate follow graph.

## Troubleshooting

- **No push, app closed:** check the token row exists; check the Edge Function
  logs (`supabase functions logs fcm-send`) for `401` (secret mismatch),
  `oauth failed` (bad service-account key), or `sent: 0` (no tokens).
- **Trigger not firing:** in SQL Editor run a manual
  `select public.send_push('<user-uuid>','Test','Hello');` — if that pushes, the
  triggers are fine and the issue is upstream.
- **pg_net errors:** make sure `create extension pg_net;` succeeded (it's in the
  migration). `select * from net._http_response order by created desc limit 5;`
  shows recent outbound call results.
- **Dead tokens** (user reinstalled) are auto-pruned when FCM returns 404/400.
