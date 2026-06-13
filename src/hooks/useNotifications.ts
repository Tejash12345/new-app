import { useEffect, useRef } from 'react'
import { useAuth } from './useAuth'
import { useTable } from './db'
import type { Task, TimetableBlock } from '../lib/types'
import { pushNotification, requestNotifPermission } from '../lib/notify'

// reminders fire on web and (via the native bridge) inside the Android app
const notify = pushNotification

export { requestNotifPermission }

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
  }, [profile, tasks, blocks])
}
