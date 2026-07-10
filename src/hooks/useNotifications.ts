import { useEffect, useRef } from 'react'
import { useAuth } from './useAuth'
import { useTable } from './db'
import { supabase } from '../lib/supabase'
import { getSocket } from '../lib/socket'
import { useApp } from '../store/app'
import type { AiMission, Capsule, Task, TimetableBlock } from '../lib/types'
import { todayKey } from '../lib/utils'
import { pushNotification, requestNotifPermission } from '../lib/notify'

// reminders fire on web and (via the native bridge) inside the Android app
const notify = pushNotification

export { requestNotifPermission }

type IncomingDM = {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  kind?: 'text' | 'image' | 'audio' | 'file' | 'post'
  file_name?: string | null
}

/**
 * App-wide incoming-DM notifications. Mounted once at the layout level so a new
 * DM raises a notification no matter which page you're on — the previous
 * ChatPage-only subscription missed every message unless you happened to be
 * sitting on the chat screen. Uses the native FLNotify bridge in the Android
 * app (or the browser Notification API on web). Skipped when the app is in the
 * foreground AND you're already viewing that person's conversation. The
 * `dm-<sender>` tag matches the server FCM push so the two collapse into one.
 */
export function useDMNotifications() {
  const { user } = useAuth()
  const notified = useRef<Set<string>>(new Set())
  const names = useRef<Record<string, string>>({})

  useEffect(() => {
    if (!user) return
    // friendly sender names for the notification title; falls back to a generic
    // label until this resolves (or for someone not in your friends list)
    supabase.rpc('my_friends').then(({ data }) => {
      for (const f of (data as { friend_id: string; full_name?: string; email?: string }[]) ?? []) {
        names.current[f.friend_id] = f.full_name?.trim() || f.email?.split('@')[0] || 'New message'
      }
    })

    // seed the Chat nav badge with messages that arrived while the app was
    // closed (read state lives server-side — upgrade-28.sql)
    supabase.rpc('dm_unread_counts').then(({ data }) => {
      const map: Record<string, number> = {}
      for (const r of (data as { sender_id: string; unread: number }[]) ?? []) {
        if (r.unread > 0) map[r.sender_id] = Number(r.unread)
      }
      // don't count the thread the user is looking at right now
      const peer = useApp.getState().activeChatPeer
      if (peer) delete map[peer]
      if (Object.keys(map).length) useApp.getState().setChatUnread(map)
    })

    // single place that turns an incoming DM into a notification. Both transports
    // below feed into it; the per-message-id `notified` set means whichever
    // arrives first wins and the other is ignored — so we never double-notify.
    const handleIncoming = (m: IncomingDM | null | undefined) => {
      if (!m || m.recipient_id !== user.id || m.sender_id === user.id) return
      if (notified.current.has(m.id)) return
      notified.current.add(m.id)
      // don't notify for the conversation you're actively looking at — but do
      // mark it read server-side so the badge stays truthful across devices
      const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
      if (visible && useApp.getState().activeChatPeer === m.sender_id) {
        supabase.rpc('mark_dms_read', { peer: m.sender_id }).then(() => {}, () => {})
        return
      }
      // badge on the Chat nav item — the in-app signal on every other page
      useApp.getState().addChatUnread(m.sender_id)
      const name = names.current[m.sender_id] ?? 'New message'
      const preview =
        m.kind === 'image' ? '📷 Photo'
        : m.kind === 'audio' ? '🎤 Voice message'
        : m.kind === 'file' ? `📎 ${m.file_name ?? 'File'}`
        : m.kind === 'post' ? '📨 Shared a post'
        : (m.body || '')
      // tapping it opens that exact conversation (Instagram-style)
      notify(`💬 ${name}`, preview, `dm-${m.sender_id}`, `/chat?dm=${m.sender_id}`)
    }

    // 1) Supabase realtime — the always-available path (works even when the
    //    dedicated socket server is asleep or VITE_SOCKET_URL isn't configured).
    const channel = supabase
      .channel(`dm-notify-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${user.id}` },
        (payload) => handleIncoming(payload.new as IncomingDM))
      .subscribe()

    // 2) socket.io fast path — when the realtime chat server is configured, the
    //    sender relays each DM straight to us and this fires instantly, on ANY
    //    page (we open/keep the connection here, not just on the Chat screen).
    const sock = getSocket()
    const onSocketDm = (m: IncomingDM) => handleIncoming(m)
    sock?.on('dm', onSocketDm)

    return () => {
      supabase.removeChannel(channel)
      sock?.off('dm', onSocketDm)
    }
  }, [user?.id])
}

/**
 * App-wide friend-request notifications (and "request accepted"), mounted once
 * at the layout level so they fire on any page while the app is open. Uses the
 * native FLNotify bridge on Android / the browser Notification API on web. Same
 * `friendreq-`/`friendacc-` tags as the server FCM push so the two collapse.
 */
export function useFriendRequestNotifications() {
  const { user } = useAuth()
  const notified = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    const nameOf = async (id: string) => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', id).single()
      return (data?.full_name as string | undefined)?.trim() || 'Someone'
    }
    const channel = supabase
      .channel(`friend-notify-${user.id}`)
      // someone sent YOU a request
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${user.id}` },
        async (payload) => {
          const r = payload.new as { id: string; requester_id: string; status: string }
          if (r.status !== 'pending') return
          const k = `req-${r.id}`
          if (notified.current.has(k)) return
          notified.current.add(k)
          notify('👋 New friend request', `${await nameOf(r.requester_id)} wants to connect on FocusLion.`, `friendreq-${r.id}`, '/friends')
        })
      // a request YOU sent was accepted
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'friendships', filter: `requester_id=eq.${user.id}` },
        async (payload) => {
          const r = payload.new as { id: string; addressee_id: string; status: string }
          if (r.status !== 'accepted') return
          const k = `acc-${r.id}`
          if (notified.current.has(k)) return
          notified.current.add(k)
          notify('✅ Friend request accepted', `${await nameOf(r.addressee_id)} accepted your request — say hi! 👋`, `friendacc-${r.id}`, `/chat?dm=${r.addressee_id}`)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])
}

/**
 * In-app notification engine (runs while the app is open):
 * - timetable blocks starting within 5 min
 * - assignments / exams due within 24h
 * - hydration every 90 min, break every 50 min, sleep at configured hour
 */
export function useNotificationEngine() {
  const { profile } = useAuth()
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: blocks } = useTable<TimetableBlock>('timetable_blocks')
  const { rows: capsules } = useTable<Capsule>('capsules')
  const { rows: missions } = useTable<AiMission>('ai_missions')
  const fired = useRef<Set<string>>(new Set())

  useEffect(() => {
    const prefs = profile?.settings?.notifications ?? {}
    const sleepHour = profile?.settings?.sleepReminderHour ?? 22

    const interval = setInterval(() => {
      // run if the browser granted notifications OR we're in the native app
      const canNotify =
        ('FLNotify' in window) ||
        ('Notification' in window && Notification.permission === 'granted')
      if (!canNotify) return
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const dow = (now.getDay() + 6) % 7 // 0 = Monday
      const dayTag = now.toDateString()

      // study reminders — timetable block starting in <=5 min
      if (prefs.study !== false) {
        for (const b of blocks) {
          if (b.day_of_week !== dow) continue
          const diff = b.start_min - nowMin
          const tag = `block-${b.id}-${dayTag}`
          if (diff > 0 && diff <= 5 && !fired.current.has(tag)) {
            fired.current.add(tag)
            notify('📚 Study time!', `"${b.title}" starts in ${diff} min. Get ready!`, tag)
          }
        }
      }

      // deadlines within 24h
      if (prefs.deadlines !== false) {
        for (const t of tasks) {
          if (t.done || !t.due_at) continue
          const ms = new Date(t.due_at).getTime() - now.getTime()
          const tag = `due-${t.id}`
          if (ms > 0 && ms < 24 * 3600_000 && !fired.current.has(tag)) {
            fired.current.add(tag)
            const what = t.kind === 'exam' ? 'Exam' : t.kind === 'assignment' ? 'Assignment' : 'Task'
            notify(`⏰ ${what} due soon`, `"${t.title}" is due within 24 hours.`, tag)
          }
        }
      }

      // hydration every 90 min (10:00–22:00)
      if (prefs.hydration !== false && now.getHours() >= 10 && now.getHours() <= 22) {
        const slot = Math.floor(nowMin / 90)
        const tag = `water-${dayTag}-${slot}`
        if (nowMin % 90 < 1 && !fired.current.has(tag)) {
          fired.current.add(tag)
          notify('💧 Hydration check', 'Drink a glass of water — your brain will thank you.', tag)
        }
      }

      // break every 50 min (08:00–22:00)
      if (prefs.breaks !== false && now.getHours() >= 8 && now.getHours() <= 22) {
        const slot = Math.floor(nowMin / 50)
        const tag = `break-${dayTag}-${slot}`
        if (nowMin % 50 < 1 && !fired.current.has(tag)) {
          fired.current.add(tag)
          notify('🧘 Stretch break', 'Stand up, stretch, look away from the screen for a minute.', tag)
        }
      }

      // Future Me Capsule — opening soon (7 days out) and ready to open
      for (const c of capsules) {
        if (c.opened_at) continue
        const ms = new Date(c.unlock_at).getTime() - now.getTime()
        const days = Math.ceil(ms / 86_400_000)
        if (ms > 0 && days <= 7) {
          const tag = `capsule-soon-${c.id}`
          if (!fired.current.has(tag)) {
            fired.current.add(tag)
            notify('⏳ Your Future Capsule is almost here', `"${c.title}" opens in ${days} day${days === 1 ? '' : 's'}.`, tag)
          }
        } else if (ms <= 0) {
          const tag = `capsule-ready-${c.id}`
          if (!fired.current.has(tag)) {
            fired.current.add(tag)
            notify('🦁 Your journey is ready', `"${c.title}" has unlocked — open it to see how you've grown.`, tag)
          }
        }
      }

      // Daily Lion Mission reminder — nudge in the evening if still not done
      {
        const todays = missions.find((m) => m.mission_date === todayKey())
        if (todays && !todays.done && now.getHours() >= 18) {
          const tag = `mission-${todays.id}`
          if (!fired.current.has(tag)) {
            fired.current.add(tag)
            notify('🦁 Daily mission still open', `"${todays.title}" — finish it for +${todays.xp} XP before the day ends.`, tag)
          }
        }
      }

      // sleep reminder
      if (prefs.sleep !== false) {
        const tag = `sleep-${dayTag}`
        if (now.getHours() === sleepHour && now.getMinutes() < 1 && !fired.current.has(tag)) {
          fired.current.add(tag)
          notify('🌙 Wind down', 'Time to wrap up and get a good night\'s sleep. Tomorrow needs you sharp.', tag)
        }
      }
    }, 30_000)

    return () => clearInterval(interval)
  }, [profile, tasks, blocks, capsules, missions])
}
