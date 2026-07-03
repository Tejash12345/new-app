import { useEffect, useRef } from 'react'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { useInvalidateTable } from '../hooks/db'
import { supabase } from '../lib/supabase'

function pushNote(title: string, body: string, tag: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, tag, icon: '/lion-ai.png' })
  }
}

// The moment this JS context booted. A session whose startedAt predates it was
// restored from localStorage (page reload / app reopen) — it did not start live.
const PAGE_LOAD_AT = Date.now()

/**
 * Global ticker: while a social-media scroll session is running,
 * checks every 5s whether used + elapsed exceeds the daily limit,
 * warns 5 minutes before, then saves the session and unleashes the lion.
 *
 * Restored sessions get one immediate QUIET check: if the limit was already
 * crossed while the app was closed, the time is banked and the session ends
 * with only a notification — no full-screen roar. Roaring on reopen felt like
 * a random alarm (the crossing moment had long passed), and because the
 * session stayed persisted it re-roared on every return until dismissed.
 */
export function ScrollWatcher() {
  const { activeScroll, stopScroll, showLion } = useApp()
  const { user } = useAuth()
  const invalidate = useInvalidateTable()
  const warnedSession = useRef<number | null>(null)

  useEffect(() => {
    if (!activeScroll || !user) return
    const s = activeScroll
    let ended = false // the interval can fire once more before React re-renders

    async function check(quietIfOver: boolean) {
      if (ended) return
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const elapsedMin = (Date.now() - s.startedAt) / 60000
      const remainingMin = s.limitMin - s.usedTodayMin - elapsedMin
      const overLimit = s.usedTodayMin + elapsedMin >= s.limitMin
      const overWindow = s.allowedUntilMin !== undefined && nowMin >= s.allowedUntilMin

      // reminder before the lion comes
      if (!overLimit && !overWindow && remainingMin <= 5 && warnedSession.current !== s.startedAt) {
        warnedSession.current = s.startedAt
        pushNote('🦁 5 minutes left!',
          `Your ${s.appName} time is almost up. Wrap it up before the lion roars.`,
          `warn-${s.startedAt}`)
      }

      if (overLimit || overWindow) {
        ended = true
        const usedMin = Math.max(1, Math.round(elapsedMin))
        stopScroll()
        await supabase.from('social_sessions').insert({
          user_id: user!.id,
          app_name: s.appName,
          used_min: usedMin,
        })
        // direct insert → refresh the cached usage list (Wellbeing "used today")
        invalidate('social_sessions')
        if (quietIfOver) {
          pushNote('🦁 Session ended',
            `Your ${s.appName} time ran out while you were away — ${usedMin} min saved.`,
            `end-${s.startedAt}`)
          return
        }
        pushNote("🦁 ROAAAR! Time's up.",
          `${s.appName} is done for now. Back to your goals!`,
          `roar-${s.startedAt}`)
        showLion(
          s.appName,
          overWindow && !overLimit ? 'schedule' : 'limit',
          s.windowLabel,
        )
      }
    }

    // restored session → one immediate quiet check (bank silently if expired)
    if (s.startedAt < PAGE_LOAD_AT) void check(true)
    const t = setInterval(() => { void check(false) }, 5000)
    return () => clearInterval(t)
  }, [activeScroll, user?.id])

  return null
}
