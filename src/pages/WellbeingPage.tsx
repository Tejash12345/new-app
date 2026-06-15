import { useEffect, useState } from 'react'
import { Clock, Square } from 'lucide-react'
import { useApp } from '../store/app'
import { useTable } from '../hooks/db'
import type { SocialLimit, SocialSession } from '../lib/types'
import { Button, Empty, GlassCard, Page, SectionTitle } from '../components/ui'
import { SOCIAL_APPS, addDays, cn, minutesToLabel, timeLabel, todayKey } from '../lib/utils'

const minToInput = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const inputToMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/**
 * Daily-limit control: drag the slider for a quick set, or type an exact number
 * of minutes in the box (the box isn't capped at the slider's 180, so you can
 * set e.g. 240). Both follow your input locally and save once you let go / blur.
 */
function LimitControl({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value)
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) { setLocal(value); setText(String(value)) }
  }, [value, editing])

  const commit = (raw: number) => {
    const v = Math.max(1, Math.min(1440, Math.round(raw)))
    setEditing(false)
    setLocal(v)
    setText(String(v))
    if (v !== value) onCommit(v)
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <input
        type="range" min={5} max={180} step={5} value={Math.min(180, local)}
        onChange={(e) => { setEditing(true); const v = Number(e.target.value); setLocal(v); setText(String(v)) }}
        onPointerUp={() => commit(local)}
        onKeyUp={() => commit(local)}
        className="h-1.5 flex-1 accent-brand-500"
        aria-label="Daily limit slider"
      />
      <div className="flex items-center gap-1.5">
        <input
          type="number" min={1} max={1440} inputMode="numeric" value={text}
          onChange={(e) => { setEditing(true); setText(e.target.value); const n = Number(e.target.value); if (!Number.isNaN(n)) setLocal(n) }}
          onFocus={() => setEditing(true)}
          onBlur={() => commit(Number(text) || value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-16 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-2 py-1.5 text-right text-sm font-bold text-brand-500 outline-none focus:border-brand-500/60"
          aria-label="Daily limit in minutes"
        />
        <span className="text-xs font-semibold text-slate-400">min</span>
      </div>
    </div>
  )
}

export function WellbeingPage() {
  const { rows: limits, insert, update } = useTable<SocialLimit>('social_limits')
  const { rows: usage, insert: addUsage } = useTable<SocialSession>('social_sessions')
  const { activeScroll, startScroll, stopScroll, showLion } = useApp()
  const [, forceTick] = useState(0)

  // Real per-app usage (minutes used today) pushed from the native Android
  // wrapper via the FLGuard bridge. When we're running inside that app we trust
  // the phone's actual screen-time over the manual "start the timer" sessions.
  const inNativeApp = typeof window !== 'undefined' && 'FLGuard' in window
  const [nativeUsage, setNativeUsage] = useState<Record<string, number>>(
    () => (window as unknown as { __FL_USAGE__?: Record<string, number> }).__FL_USAGE__ ?? {},
  )
  useEffect(() => {
    const onUsage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && typeof detail === 'object') setNativeUsage(detail as Record<string, number>)
    }
    window.addEventListener('fl-usage', onUsage as EventListener)
    const cur = (window as unknown as { __FL_USAGE__?: Record<string, number> }).__FL_USAGE__
    if (cur) setNativeUsage(cur)
    return () => window.removeEventListener('fl-usage', onUsage as EventListener)
  }, [])

  // live ticking while a scroll session runs
  useEffect(() => {
    if (!activeScroll) return
    const t = setInterval(() => forceTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [activeScroll])

  const today = todayKey()
  const weekStart = todayKey(addDays(new Date(), -6))
  const monthStart = todayKey(addDays(new Date(), -29))

  const usedFor = (app: string, since: string) =>
    usage.filter((u) => u.app_name === app && u.used_on >= since).reduce((a, u) => a + u.used_min, 0)

  // minutes used today for an app — the phone's real usage in the native app,
  // otherwise the sum of manual sessions on the web.
  const usedTodayFor = (app: string) =>
    inNativeApp ? Math.max(nativeUsage[app] ?? 0, usedFor(app, today)) : usedFor(app, today)

  const limitFor = (app: string) => limits.find((l) => l.app_name === app)

  // Start an app's timer right away — no separate "start" button. Respects the
  // allowed-hours window: if the app is locked right now, the lion roars instead.
  function startTimerFor(appName: string) {
    const lim = limitFor(appName)
    const dailyLimit = lim?.daily_limit_min ?? 30
    const scheduleOn = lim?.schedule_enabled ?? false
    const fromMin = lim?.allowed_from_min ?? 1080
    const untilMin = lim?.allowed_until_min ?? 1200
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
    const inWindow = !scheduleOn || (nowMin >= fromMin && nowMin < untilMin)
    const windowLabel = `${timeLabel(fromMin)} – ${timeLabel(untilMin)}`
    if (!inWindow) { showLion(appName, 'schedule', windowLabel); return }
    startScroll({
      appName,
      startedAt: Date.now(),
      limitMin: dailyLimit,
      usedTodayMin: usedTodayFor(appName),
      allowedUntilMin: scheduleOn ? untilMin : undefined,
      windowLabel: scheduleOn ? windowLabel : undefined,
    })
  }

  async function toggleApp(app: string, enabled: boolean) {
    const existing = limitFor(app)
    if (existing) await update({ id: existing.id, enabled } as Partial<SocialLimit> & { id: string })
    else await insert({ app_name: app, daily_limit_min: 30, enabled } as Partial<SocialLimit>)
    // Enabling an app is enough — its timer starts automatically.
    if (enabled) {
      if (activeScroll && activeScroll.appName !== app) await stopSession() // bank the previous app's time first
      startTimerFor(app)
    } else if (activeScroll?.appName === app) {
      await stopSession() // turning the app off stops its running timer
    }
  }

  async function setLimit(app: string, min: number) {
    const existing = limitFor(app)
    if (existing) await update({ id: existing.id, daily_limit_min: min } as Partial<SocialLimit> & { id: string })
    else await insert({ app_name: app, daily_limit_min: min, enabled: true } as Partial<SocialLimit>)
  }

  async function stopSession() {
    if (!activeScroll) return
    const elapsedMin = Math.max(1, Math.round((Date.now() - activeScroll.startedAt) / 60000))
    stopScroll()
    await addUsage({ app_name: activeScroll.appName, used_min: elapsedMin, used_on: today } as Partial<SocialSession>)
  }

  const sessionTotalToday = usage.filter((u) => u.used_on === today).reduce((a, u) => a + u.used_min, 0)
  const nativeTotalToday = Object.values(nativeUsage).reduce((a, b) => a + b, 0)
  const totalToday = inNativeApp ? Math.max(nativeTotalToday, sessionTotalToday) : sessionTotalToday
  const totalWeek = usage.filter((u) => u.used_on >= weekStart).reduce((a, u) => a + u.used_min, 0)
  const totalMonth = usage.filter((u) => u.used_on >= monthStart).reduce((a, u) => a + u.used_min, 0)

  return (
    <Page
      title="Digital Wellbeing"
      subtitle="Set limits. Track usage. When time's up — the lion roars. 🦁"
    >
      {/* live session banner */}
      {activeScroll && (
        <GlassCard className="mb-5 !border-amber-400/40 !bg-amber-400/10">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-3xl">⏳</span>
            <div className="flex-1">
              <div className="font-bold text-slate-900 dark:text-white">
                Scrolling {activeScroll.appName} — {Math.floor((Date.now() - activeScroll.startedAt) / 60000)}m {Math.floor(((Date.now() - activeScroll.startedAt) / 1000) % 60)}s
              </div>
              <div className="text-sm text-slate-500">
                {minutesToLabel(Math.max(0, Math.round(activeScroll.limitMin - activeScroll.usedTodayMin - (Date.now() - activeScroll.startedAt) / 60000)))} remaining before the lion roars
              </div>
            </div>
            <Button variant="danger" onClick={stopSession}><Square size={15} /> Stop session</Button>
          </div>
        </GlassCard>
      )}

      {/* totals */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          ['Today', totalToday], ['This week', totalWeek], ['This month', totalMonth],
        ].map(([label, val]) => (
          <GlassCard key={label as string} className="!p-4 text-center">
            <div className="text-xl font-extrabold text-slate-900 dark:text-white">{minutesToLabel(val as number)}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </GlassCard>
        ))}
      </div>

      <SectionTitle>App limits</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {SOCIAL_APPS.map((app) => {
          const lim = limitFor(app.name)
          const enabled = lim?.enabled ?? false
          const dailyLimit = lim?.daily_limit_min ?? 30
          const usedToday = usedTodayFor(app.name)
          const remaining = Math.max(0, dailyLimit - usedToday)
          const over = enabled && usedToday >= dailyLimit

          const scheduleOn = lim?.schedule_enabled ?? false
          const fromMin = lim?.allowed_from_min ?? 1080
          const untilMin = lim?.allowed_until_min ?? 1200
          const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
          const inWindow = !scheduleOn || (nowMin >= fromMin && nowMin < untilMin)
          const windowLabel = `${timeLabel(fromMin)} – ${timeLabel(untilMin)}`

          return (
            <GlassCard key={app.name} float className={cn(over && '!border-rose-400/40')}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl" style={{ background: `${app.color}1e` }}>
                  {app.emoji}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900 dark:text-white">{app.name}</div>
                  <div className="text-xs text-slate-500">
                    {enabled
                      ? over ? '🦁 Limit reached for today' : `${minutesToLabel(remaining)} left of ${minutesToLabel(dailyLimit)}`
                      : 'No limit set'}
                  </div>
                </div>
                {/* toggle */}
                <button
                  onClick={() => toggleApp(app.name, !enabled)}
                  className={cn('relative h-7 w-12 rounded-full transition-colors', enabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15')}
                >
                  <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', enabled ? 'left-6' : 'left-1')} />
                </button>
              </div>

              {enabled && (
                <>
                  <LimitControl value={dailyLimit} onCommit={(v) => setLimit(app.name, v)} />
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                    <div
                      className={cn('h-full rounded-full transition-all', over ? 'bg-rose-500' : 'bg-brand-500')}
                      style={{ width: `${Math.min(100, (usedToday / dailyLimit) * 100)}%` }}
                    />
                  </div>

                  {/* allowed hours schedule */}
                  <div className="mt-3 rounded-2xl bg-slate-500/5 dark:bg-white/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <Clock size={15} className="text-brand-500" /> Allowed hours only
                      </div>
                      <button
                        onClick={() => update({ id: lim!.id, schedule_enabled: !scheduleOn } as Partial<SocialLimit> & { id: string })}
                        className={cn('relative h-6 w-10 rounded-full transition-colors', scheduleOn ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15')}
                      >
                        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', scheduleOn ? 'left-[18px]' : 'left-0.5')} />
                      </button>
                    </div>
                    {scheduleOn && (
                      <>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <input
                            type="time" value={minToInput(fromMin)}
                            onChange={(e) => update({ id: lim!.id, allowed_from_min: inputToMin(e.target.value) } as Partial<SocialLimit> & { id: string })}
                            className="min-w-0 flex-1 basis-28 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-2.5 py-1.5 text-sm text-slate-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                          />
                          <span className="text-xs text-slate-400">to</span>
                          <input
                            type="time" value={minToInput(untilMin)}
                            onChange={(e) => update({ id: lim!.id, allowed_until_min: inputToMin(e.target.value) } as Partial<SocialLimit> & { id: string })}
                            className="min-w-0 flex-1 basis-28 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-2.5 py-1.5 text-sm text-slate-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                          />
                        </div>
                        <p className={cn('mt-2 text-xs font-semibold', inWindow ? 'text-emerald-500' : 'text-rose-500')}>
                          {inWindow ? `✓ Open now — allowed ${windowLabel}` : `🔒 Locked — allowed only ${windowLabel}`}
                        </p>
                      </>
                    )}
                  </div>

                  {/* No "start" button — enabling the app starts the timer.
                      This line just reflects the current state. */}
                  <p className={cn('mt-3 text-center text-xs font-semibold',
                    !inWindow ? 'text-rose-500' : over ? 'text-rose-500' : activeScroll?.appName === app.name ? 'text-amber-500' : 'text-emerald-500')}>
                    {!inWindow
                      ? `🦁 Locked until ${timeLabel(fromMin)}`
                      : over
                        ? '🦁 Daily limit reached for today'
                        : activeScroll?.appName === app.name
                          ? `⏳ Timer running — ${minutesToLabel(remaining)} left today`
                          : '🟢 Tracking on — the lion guards your limit'}
                  </p>
                </>
              )}
            </GlassCard>
          )
        })}
      </div>

      {limits.filter((l) => l.enabled).length === 0 && (
        <GlassCard className="mt-5">
          <Empty emoji="🦁" text={'Turn on an app above and set its daily minutes — the timer starts automatically.\nWhen your daily time runs out, the lion will step in and roar.'} />
        </GlassCard>
      )}

    </Page>
  )
}
