import { useEffect, useState } from 'react'
import { hasPhonePowers, phone } from './device'

// Leo setup: which permissions Leo has (Android app), refreshed live.

export type PermKey = 'mic' | 'accessibility' | 'overlay' | 'battery' | 'autostart' | 'notifications' | 'contacts' | 'sms' | 'phone' | 'calendar' | 'location'

export const PERMS: { key: PermKey; label: string; why: string; essential?: boolean }[] = [
  { key: 'mic', label: 'Microphone', why: 'So Leo can hear you', essential: true },
  { key: 'accessibility', label: 'Accessibility → “FocusLion Leo”', why: 'Scroll, tap and type in any app', essential: true },
  { key: 'overlay', label: 'Display over other apps', why: '“Hey Leo” and the bubble over other apps', essential: true },
  { key: 'battery', label: 'Battery: Unrestricted', why: 'Keeps “Hey Leo” alive in the background', essential: true },
  { key: 'autostart', label: 'Auto-start → FocusLion ON', why: 'Your phone stops apps when closed — this keeps Leo listening', essential: true },
  { key: 'contacts', label: 'Contacts', why: '“Call Amma”, “WhatsApp Ravi”' },
  { key: 'phone', label: 'Phone', why: 'Calls ring right away' },
  { key: 'sms', label: 'SMS', why: 'Send texts for you' },
  { key: 'notifications', label: 'Notification access', why: '“Any new messages?”' },
  { key: 'calendar', label: 'Calendar', why: '“What’s on my calendar?”' },
  { key: 'location', label: 'Location (approximate)', why: 'Weather where you are' },
]

export const ESSENTIAL: PermKey[] = PERMS.filter((p) => p.essential).map((p) => p.key)

/** Live permission state from the Android app (null on the web / not loaded yet). */
export function usePermStatus(active = true): Record<PermKey, boolean> | null {
  const [st, setSt] = useState<Record<PermKey, boolean> | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    const check = () => {
      if (!hasPhonePowers()) return
      void phone('perm_status', {}, 3000).then((r) => {
        if (alive && r.ok) setSt(r as unknown as Record<PermKey, boolean>)
      })
    }
    const t0 = setTimeout(check, 400)
    const t = setInterval(check, 2500) // the user comes back from a settings screen -> refresh
    document.addEventListener('visibilitychange', check)
    return () => { alive = false; clearTimeout(t0); clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [active])
  return st
}

