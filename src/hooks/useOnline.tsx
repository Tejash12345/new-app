import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { getSocket, closeSocket } from '../lib/socket'
import { useAuth } from './useAuth'
import { isOnline as heartbeatOnline } from '../components/PresenceTracker'

/**
 * Live presence. Two sources, merged:
 *  - the dedicated socket.io chat server (instant, when configured)
 *  - Supabase realtime presence (always available fallback)
 * Either one marking a user online counts.
 */
const OnlineCtx = createContext<Set<string>>(new Set())

export function OnlineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [sbOnline, setSbOnline] = useState<Set<string>>(new Set())
  const [ioOnline, setIoOnline] = useState<Set<string>>(new Set())

  // Supabase presence channel
  useEffect(() => {
    if (!user) { setSbOnline(new Set()); return }
    const ch = supabase.channel('online-users', { config: { presence: { key: user.id } } })
    const refresh = () => setSbOnline(new Set(Object.keys(ch.presenceState())))
    ch.on('presence', { event: 'sync' }, refresh)
      .on('presence', { event: 'join' }, refresh)
      .on('presence', { event: 'leave' }, refresh)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await ch.track({ at: new Date().toISOString() })
      })
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  // socket.io presence events
  useEffect(() => {
    if (!user) { setIoOnline(new Set()); closeSocket(); return }
    const s = getSocket()
    if (!s) return
    const onList = (ids: string[]) => setIoOnline(new Set(ids))
    const onUp = (id: string) => setIoOnline((prev) => new Set(prev).add(id))
    const onDown = (id: string) => setIoOnline((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    const onDisconnect = () => setIoOnline(new Set())
    s.on('presence:list', onList)
    s.on('presence:online', onUp)
    s.on('presence:offline', onDown)
    s.on('disconnect', onDisconnect)
    return () => {
      s.off('presence:list', onList)
      s.off('presence:online', onUp)
      s.off('presence:offline', onDown)
      s.off('disconnect', onDisconnect)
    }
  }, [user?.id])

  const merged = useMemo(() => new Set([...sbOnline, ...ioOnline]), [sbOnline, ioOnline])

  return <OnlineCtx.Provider value={merged}>{children}</OnlineCtx.Provider>
}

export function useOnline() {
  return useContext(OnlineCtx)
}

/** Online if any live socket says so, or their heartbeat is fresh (covers brief reconnects). */
export function useOnlineCheck() {
  const online = useOnline()
  return (id: string, lastSeen?: string | null) => online.has(id) || heartbeatOnline(lastSeen)
}
