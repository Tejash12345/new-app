import { useEffect, useState } from 'react'
import { Clock, Play, ShieldCheck, Square } from 'lucide-react'
import { useApp } from '../store/app'
import { useTable } from '../hooks/db'
import type { SocialLimit, SocialSession } from '../lib/types'
import { Button, Empty, GlassCard, Page, SectionTitle } from '../components/ui'
import { notifyGuard } from '../lib/guard'
import { SOCIAL_APPS, addDays, cn, minutesToLabel, timeLabel, todayKey } from '../lib/utils'

const minToInput = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const inputToMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const LIMIT_PRESETS = [15, 30, 45, 60, 90, 120]
const presetLabel = (m: number) => (m >= 60 ? (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`) : `${m}m`)

/**
 * Daily-limit control: one-tap presets for the common caps, or type an exact
 * number of minutes in the box (up to 1440). Replaces the old slider, which
 * was fiddly on phones — it hijacked vertical scrolling and made 5-min
 * accuracy nearly impossible with a thumb.
 */
function LimitControl({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const commit = (raw: number) => {
    const v = Math.max(1, Math.min(1440, Math.round(raw)))
    setEditing(false)
    setText(String(v))
    if (v !== value) onCommit(v)
  }

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
      {LIMIT_PRESETS.map((m) => (
        <button
          key={m}
          onClick={() => commit(m)}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-bold transition active:scale-95',
            value === m
              ? 'bg-brand-500 text-white shadow-sm'
              : 'bg-slate-500/10 text-slate-500 hover:bg-brand-500/15 hover:text-brand-600',
          )}
        >
          {presetLabel(m)}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1.5">
        <input
          type="number" min={1} max={1440} inputMode="numeric" value={text}
          onChange={(e) => { setEditing(true); setText(e.target.value) }}
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

  // Start a manual scroll timer (web only — the phone tracks real usage).
  // Respects the allowed-hours window and the daily cap: if the app is locked
  // or already out of time, the lion explains instead of starting a session —
  // a session that BEGINS over its limit would just roar 5 seconds later and
  // log a bogus usage row.
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
    if (usedTodayFor(appName) >= dailyLimit) { showLion(appName, 'limit'); return }
    startScroll({
      appName,
      startedAt: Date.now(),
      limitMin: dailyLimit,
      usedTodayMin: usedTodayFor(appName),
      allowedUntilMin: scheduleOn ? untilMin : undefined,
      windowLabel: scheduleOn ? windowLabel : undefined,
    })
  }

  // NOTE: enabling an app deliberately does NOT start a timer. The old
  // auto-start seeded a brand-new session with the minutes already used today
  // (real phone screen-time in the app), so anyone past the default 30-min cap
  // got the full roar the instant they flipped the toggle — and again on every
  // reopen while the persisted over-limit session lingered. Setting a cap is
  // configuration; the Start button (web) or the App Guard (phone) enforces it.
  async function toggleApp(app: string, enabled: boolean) {
    const existing = limitFor(app)
    if (existing) await update({ id: existing.id, enabled } as Partial<SocialLimit> & { id: string })
    else await insert({ app_name: app, daily_limit_min: 30, enabled } as Partial<SocialLimit>)
    notifyGuard()
    // turning an app off also stops its running timer
    if (!enabled && activeScroll?.appName === app) await stopSession()
  }

  async function setLimit(app: string, min: number) {
    const existing = limitFor(app)
    if (existing) await update({ id: existing.id, daily_limit_min: min } as Partial<SocialLimit> & { id: string })
    else await insert({ app_name: app, daily_limit_min: min, enabled: true } as Partial<SocialLimit>)
    notifyGuard()
  }

  // schedule changes (allowed-hours toggle + window times) — the native
  // blocker re-syncs immediately after every change
  async function patchLimit(id: string, patch: Partial<SocialLimit>) {
    await update({ id, ...patch } as Partial<SocialLimit> & { id: string })
    notifyGuard()
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
            <div className="min-w-0 flex-1">
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

      {inNativeApp && (
        <p className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <ShieldCheck size={14} className="shrink-0 text-emerald-500" />
          App Guard is active — limits below are enforced on this phone automatically.
        </p>
      )}

      <SectionTitle>App limits</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SOCIAL_APPS.map((app) => {
          const lim = limitFor(app.name)
          const enabled = lim?.enabled ?? false
          const dailyLimit = lim?.daily_limit_min ?? 30
          const usedToday = usedTodayFor(app.name)
          const usedWeek = usedFor(app.name, weekStart)
          const remaining = Math.max(0, dailyLimit - usedToday)
          const over = enabled && usedToday >= dailyLimit

          const scheduleOn = lim?.schedule_enabled ?? false
          const fromMin = lim?.allowed_from_min ?? 1080
          const untilMin = lim?.allowed_until_min ?? 1200
          const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
          const inWindow = !scheduleOn || (nowMin >= fromMin && nowMin < untilMin)
          const windowLabel = `${timeLabel(fromMin)} – ${timeLabel(untilMin)}`
          const running = activeScroll?.appName === app.name

          return (
            <GlassCard key={app.name} float className={cn('min-w-0', over && '!border-rose-400/40')}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: `${app.color}1e` }}>
                  {app.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-900 dark:text-white">{app.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {enabled
                      ? over ? '🦁 Limit reached for today' : `${minutesToLabel(remaining)} left of ${minutesToLabel(dailyLimit)}`
                      : 'No limit set'}
                    {usedWeek > 0 && ` · ${minutesToLabel(usedWeek)} this week`}
                  </div>
                </div>
                {/* toggle */}
                <button
                  onClick={() => toggleApp(app.name, !enabled)}
                  aria-label={enabled ? `Remove the ${app.name} limit` : `Set a limit for ${app.name}`}
                  className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', enabled ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15')}
                >
                  <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', enabled ? 'left-6' : 'left-1')} />
                </button>
              </div>

              {enabled && (
                <>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                    <div
                      className={cn('h-full rounded-full transition-all', over ? 'bg-rose-500' : 'bg-brand-500')}
                      style={{ width: `${Math.min(100, (usedToday / dailyLimit) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] font-semibold text-slate-400">
                    <span>{minutesToLabel(usedToday)} used today</span>
                    <span>{minutesToLabel(dailyLimit)} cap</span>
                  </div>

                  <LimitControl value={dailyLimit} onCommit={(v) => setLimit(app.name, v)} />

                  {/* allowed hours schedule */}
                  <div className="mt-3 rounded-2xl bg-slate-500/5 dark:bg-white/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <Clock size={15} className="text-brand-500" /> Allowed hours only
                      </div>
                      <button
                        onClick={() => patchLimit(lim!.id, { schedule_enabled: !scheduleOn })}
                        aria-label={scheduleOn ? 'Disable allowed hours' : 'Enable allowed hours'}
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
                            onChange={(e) => patchLimit(lim!.id, { allowed_from_min: inputToMin(e.target.value) })}
                            className="min-w-0 flex-1 basis-28 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-2.5 py-1.5 text-sm text-slate-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                          />
                          <span className="text-xs text-slate-400">to</span>
                          <input
                            type="time" value={minToInput(untilMin)}
                            onChange={(e) => patchLimit(lim!.id, { allowed_until_min: inputToMin(e.target.value) })}
                            className="min-w-0 flex-1 basis-28 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-2.5 py-1.5 text-sm text-slate-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
                          />
                        </div>
                        <p className={cn('mt-2 text-xs font-semibold', inWindow ? 'text-emerald-500' : 'text-rose-500')}>
                          {inWindow ? `✓ Open now — allowed ${windowLabel}` : `🔒 Locked — allowed only ${windowLabel}`}
                        </p>
                      </>
                    )}
                  </div>

                  {/* enforcement row: the phone blocks automatically via the App
                      Guard; on the web you run the timer yourself while scrolling */}
                  {inNativeApp ? (
                    <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-slate-500">
                      <ShieldCheck size={14} className="shrink-0 text-emerald-500" />
                      {over
                        ? 'Limit reached — the App Guard blocks it until tomorrow'
                        : !inWindow
                          ? `Locked until ${timeLabel(fromMin)} — enforced by the App Guard`
                          : `Enforced automatically · ${minutesToLabel(remaining)} left today`}
                    </p>
                  ) : running ? (
                    <Button variant="danger" className="mt-3 w-full" onClick={stopSession}>
                      <Square size={15} /> Stop & save session
                    </Button>
                  ) : (
                    <Button className="mt-3 w-full" onClick={() => startTimerFor(app.name)}>
                      <Play size={15} />
                      {over ? 'Out of time — ask the lion' : !inWindow ? `Locked until ${timeLabel(fromMin)}` : 'Start scroll timer'}
                    </Button>
                  )}
                </>
              )}
            </GlassCard>
          )
        })}
      </div>

      {limits.filter((l) => l.enabled).length === 0 && (
        <GlassCard className="mt-5">
          <Empty emoji="🦁" text={'Turn on an app above and set its daily minutes.\nOn your phone the App Guard enforces it; on the web, start the timer when you scroll.'} />
        </GlassCard>
      )}

    </Page>
  )
}
