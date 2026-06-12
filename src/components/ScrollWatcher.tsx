import { useEffect } from 'react'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

/**
 * Global ticker: while a social-media scroll session is running,
 * checks every 5s whether used + elapsed exceeds the daily limit,
 * then saves the session and unleashes the lion.
 */
export function ScrollWatcher() {
  const { activeScroll, stopScroll, showLion } = useApp()
  const { user } = useAuth()

  useEffect(() => {
    if (!activeScroll || !user) return
    const t = setInterval(async () => {
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const elapsedMin = (Date.now() - activeScroll.startedAt) / 60000
      const overLimit = activeScroll.usedTodayMin + elapsedMin >= activeScroll.limitMin
      const overWindow =
        activeScroll.allowedUntilMin !== undefined && nowMin >= activeScroll.allowedUntilMin

      if (overLimit || overWindow) {
        const usedMin = Math.max(1, Math.round(elapsedMin))
        stopScroll()
        await supabase.from('social_sessions').insert({
          user_id: user.id,
          app_name: activeScroll.appName,
          used_min: usedMin,
        })
        showLion(
          activeScroll.appName,
          overWindow && !overLimit ? 'schedule' : 'limit',
          activeScroll.windowLabel,
        )
      }
    }, 5000)
    return () => clearInterval(t)
  }, [activeScroll, user?.id])

  return null
}
