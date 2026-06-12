import { useEffect, useRef } from 'react'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

function pushNote(title: string, body: string, tag: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, tag })
  }
}

/**
 * Global ticker: while a social-media scroll session is running,
 * checks every 5s whether used + elapsed exceeds the daily limit,
 * warns 5 minutes before, then saves the session and unleashes the lion.
 */
export function ScrollWatcher() {
  const { activeScroll, stopScroll, showLion } = useApp()
  const { user } = useAuth()
  const warnedSession = useRef<number | null>(null)

  useEffect(() => {
    if (!activeScroll || !user) return
    const t = setInterval(async () => {
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const elapsedMin = (Date.now() - activeScroll.startedAt) / 60000
      const remainingMin = activeScroll.limitMin - activeScroll.usedTodayMin - elapsedMin
      const overLimit = activeScroll.usedTodayMin + elapsedMin >= activeScroll.limitMin
      const overWindow =
        activeScroll.allowedUntilMin !== undefined && nowMin >= activeScroll.allowedUntilMin

      // reminder before the lion comes
      if (!overLimit && !overWindow && remainingMin <= 5 && warnedSession.current !== activeScroll.startedAt) {
        warnedSession.current = activeScroll.startedAt
        pushNote('🦁 5 minutes left!',
          `Your ${activeScroll.appName} time is almost up. Wrap it up before the lion roars.`,
          `warn-${activeScroll.startedAt}`)
      }

      if (overLimit || overWindow) {
        pushNote("🦁 ROAAAR! Time's up.",
          `${activeScroll.appName} is done for now. Back to your goals!`,
          `roar-${activeScroll.startedAt}`)
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
