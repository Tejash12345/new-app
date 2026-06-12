import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

/**
 * Heartbeat: while logged in, stamps profiles.last_seen every 30s.
 * "Online" is then computed as last_seen within the last ~75s — which
 * self-heals (a closed app stops beating and goes offline), unlike raw
 * websocket presence that keeps stale/background connections "online".
 */
export function PresenceTracker() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    let alive = true
    const beat = () => {
      if (alive) {
        supabase.from('profiles')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => {})
      }
    }
    beat()
    const t = setInterval(beat, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user?.id])

  return null
}

/** A user is online if they were active within this many milliseconds. */
export const ONLINE_WINDOW_MS = 75_000

export function isOnline(lastSeen: string | null | undefined) {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS
}
