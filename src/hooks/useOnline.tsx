import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { isOnline as heartbeatOnline } from '../components/PresenceTracker'

/**
 * Live presence over the realtime websocket: every signed-in client joins one
 * shared channel, and join/leave events update everyone instantly — real
 * online/offline with no polling delay.
 */
const OnlineCtx = createContext<Set<string>>(new Set())

export function OnlineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [online, setOnline] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) { setOnline(new Set()); return }
    const ch = supabase.channel('online-users', { config: { presence: { key: user.id } } })
    const refresh = () => setOnline(new Set(Object.keys(ch.presenceState())))
    ch.on('presence', { event: 'sync' }, refresh)
      .on('presence', { event: 'join' }, refresh)
      .on('presence', { event: 'leave' }, refresh)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await ch.track({ at: new Date().toISOString() })
      })
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  return <OnlineCtx.Provider value={online}>{children}</OnlineCtx.Provider>
}

export function useOnline() {
  return useContext(OnlineCtx)
}

/** Online if their live socket is connected, or their heartbeat is fresh (covers brief reconnects). */
export function useOnlineCheck() {
  const online = useOnline()
  return (id: string, lastSeen?: string | null) => online.has(id) || heartbeatOnline(lastSeen)
}
