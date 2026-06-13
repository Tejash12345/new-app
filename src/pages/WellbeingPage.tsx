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

/** Slider that follows the finger locally and saves once on release. */
function LimitSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) setLocal(value)
  }, [value, dragging])
  const commit = () => {
    setDragging(false)
    if (local !== value) onCommit(local)
  }
  return (
    <div className="mt-4 flex items-center gap-3">
      <input
        type="range" min={5} max={180} step={5} value={local}
        onChange={(e) => { setDragging(true); setLocal(Number(e.target.value)) }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-1.5 flex-1 accent-brand-500"
      />
      <span className="w-12 text-right text-sm font-bold text-brand-500">{minutesToLabel(local)}</span>
    </div>
  )
}

export function WellbeingPage() {
  const { rows: limits, insert, update } = useTable<SocialLimit>('social_limits')
  const { rows: usage, insert: addUsage } = useTable<SocialSession>('social_sessions')
  const { activeScroll, startScroll, stopScroll, showLion } = useApp()
  const [, forceTick] = useState(0)

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

  const limitFor = (app: string) => limits.find((l) => l.app_name === app)

  async function toggleApp(app: string, enabled: boolean) {
    const existing = limitFor(app)
    if (existing) await update({ id: existing.id, enabled } as Partial<SocialLimit> & { id: string })
    else await insert({ app_name: app, daily_limit_min: 30, enabled } as Partial<SocialLimit>)
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

  const totalToday = usage.filter((u) => u.used_on === today).reduce((a, u) => a + u.used_min, 0)
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
          const usedToday = usedFor(app.name, today)
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
                  <LimitSlider value={dailyLimit} onCommit={(v) => setLimit(app.name, v)} />
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

                  <Button
                    variant={over || !inWindow ? 'danger' : 'soft'} size="sm" className="mt-3 w-full"
                    disabled={!!activeScroll}
                    onClick={() => {
                      if (!inWindow) {
                        showLion(app.name, 'schedule', windowLabel)
                        return
                      }
                      startScroll({
                        appName: app.name,
                        startedAt: Date.now(),
                        limitMin: dailyLimit,
                        usedTodayMin: usedToday,
                        allowedUntilMin: scheduleOn ? untilMin : undefined,
                        windowLabel: scheduleOn ? windowLabel : undefined,
                      })
                    }}
                  >
                    {!inWindow
                      ? `🦁 Locked until ${timeLabel(fromMin)}`
                      : over
                        ? '🦁 Already over — scroll at your own risk'
                        : `I'm opening ${app.name} — start the timer`}
                  </Button>
                </>
              )}
            </GlassCard>
          )
        })}
      </div>

      {limits.filter((l) => l.enabled).length === 0 && (
        <GlassCard className="mt-5">
          <Empty emoji="🦁" text={'Enable a limit above, then tap "start the timer" whenever you open that app.\nWhen your daily time runs out, the lion will step in and roar.'} />
        </GlassCard>
      )}

    </Page>
  )
}
