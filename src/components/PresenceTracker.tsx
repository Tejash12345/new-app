import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useApp } from '../store/app'

/**
 * Joins one global presence channel while logged in, so every page
 * (Friends, Chat, Dashboard) knows which users are online right now.
 */
export function PresenceTracker() {
  const { user, profile } = useAuth()
  const setOnlineIds = useApp((s) => s.setOnlineIds)

  useEffect(() => {
    if (!user) {
      setOnlineIds([])
      return
    }
    const channel = supabase.channel('global-presence', {
      config: { presence: { key: user.id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(Object.keys(channel.presenceState()))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            name: profile?.full_name || 'Lion',
            at: Date.now(),
          })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, profile?.full_name])

  return null
}
