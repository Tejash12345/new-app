import { useState } from 'react'
import { RotateCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area,
} from 'recharts'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import { weeklyInsights, type WeeklyInsights } from '../lib/ai'
import type { Habit, JournalEntry, StudySession, Task } from '../lib/types'
import { AiLoader, Button, GlassCard, Page, ProgressRing, SectionTitle } from '../components/ui'
import { addDays, cn, minutesToLabel, todayKey } from '../lib/utils'

// ----------------------------------------------------------------------------
// Weekly AI Insights — Leo analyzes the week's study sessions, tasks, habits
// and journal moods, finds patterns (e.g. "you focus best 7-9pm") and gives
// concrete recommendations. The AI report is cached per ISO week so it costs
// one Lion AI call a week (plus manual regenerates).
// ----------------------------------------------------------------------------

/** Monday of the current week — the cache key so a report lasts the week. */
function weekKey() {
  const d = new Date()
  return todayKey(addDays(d, -((d.getDay() + 6) % 7)))
}
const CACHE_KEY = () => `fl:insights:${weekKey()}`

export function InsightsPage() {
  const { profile } = useAuth()
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: habits } = useTable<Habit>('habits')
  const { rows: journal } = useTable<JournalEntry>('journal_entries')

  const [report, setReport] = useState<WeeklyInsights | null>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY())
      return cached ? (JSON.parse(cached) as WeeklyInsights) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ---- aggregate the last 7 / 14 days ----
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), -(6 - i))
    const key = todayKey(d)
    return {
      key,
      name: d.toLocaleDateString(undefined, { weekday: 'short' }),
      study: sessions.filter((s) => s.started_at.slice(0, 10) === key).reduce((a, s) => a + s.duration_min, 0),
      tasksDone: tasks.filter((t) => t.done && t.created_at.slice(0, 10) === key).length,
      habits: habits.filter((h) => h.checks.includes(key)).length,
      mood: journal.find((j) => j.entry_date === key)?.mood ?? null,
    }
  })
  const days14 = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(new Date(), -(13 - i))
    const key = todayKey(d)
    return {
      name: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      mood: journal.find((j) => j.entry_date === key)?.mood || null,
    }
  })

  // focus-hour histogram over the last 14 days (which hours you actually study)
  const since14 = todayKey(addDays(new Date(), -13))
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ h, min: 0 }))
  for (const s of sessions) {
    if (s.started_at.slice(0, 10) >= since14) hourBuckets[new Date(s.started_at).getHours()].min += s.duration_min
  }
  const hours = hourBuckets
    .filter((b) => b.h >= 5)
    .map((b) => ({ name: b.h === 12 ? '12pm' : b.h > 12 ? `${b.h - 12}pm` : `${b.h}am`, min: b.min }))
  const best = hourBuckets.reduce((m, b) => (b.min > m.min ? b : m), hourBuckets[0])
  const bestHourLabel = best.min > 0 ? (best.h === 12 ? '12 pm' : best.h > 12 ? `${best.h - 12} pm` : `${best.h} am`) : null

  const weekStudy = days7.reduce((a, d) => a + d.study, 0)
  const prevWeekStart = todayKey(addDays(new Date(), -13))
  const weekStart = todayKey(addDays(new Date(), -6))
  const prevWeekStudy = sessions
    .filter((s) => { const k = s.started_at.slice(0, 10); return k >= prevWeekStart && k < weekStart })
    .reduce((a, s) => a + s.duration_min, 0)
  const delta = weekStudy - prevWeekStudy
  const weekTasksDone = days7.reduce((a, d) => a + d.tasksDone, 0)
  const overdue = tasks.filter((t) => !t.done && t.due_at && t.due_at < new Date().toISOString()).length
  const moods = days7.map((d) => d.mood).filter((m): m is number => !!m)
  const moodAvg = moods.length ? Math.round((moods.reduce((a, m) => a + m, 0) / moods.length) * 10) / 10 : null

  function buildContext() {
    return [
      `Study minutes per day (last 7 days): ${days7.map((d) => `${d.name} ${d.study}`).join(', ')}. Week total: ${weekStudy} min (previous week: ${prevWeekStudy} min).`,
      bestHourLabel ? `Most productive start hour (last 14 days): around ${bestHourLabel}.` : 'Not enough sessions yet to find a best focus hour.',
      `Tasks completed this week: ${weekTasksDone}. Overdue tasks right now: ${overdue}.`,
      `Habit check-ins per day: ${days7.map((d) => `${d.name} ${d.habits}`).join(', ')} (of ${habits.length} habits).`,
      moodAvg ? `Journal moods 1-5: ${days7.filter((d) => d.mood).map((d) => `${d.name} ${d.mood}`).join(', ')} (avg ${moodAvg}).` : 'No journal moods recorded this week.',
      `Study streak: ${profile?.study_streak ?? 0} days. Total XP: ${profile?.xp ?? 0}.`,
    ].join('\n')
  }

  async function generate() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const r = await weeklyInsights(buildContext())
      if (!r.headline && !r.patterns.length) throw new Error('Leo could not analyze the week — please try again. 🦁')
      setReport(r)
      try { localStorage.setItem(CACHE_KEY(), JSON.stringify(r)) } catch { /* best-effort */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const tooltipStyle = {
    borderRadius: 16, border: 'none',
    background: 'rgba(20,24,40,0.92)', color: '#fff', fontSize: 12,
  }
  const MOOD_EMOJI = ['😞', '😕', '😐', '🙂', '😄']

  return (
    <Page title="Insights" subtitle="Leo studies your week and tells you what the numbers mean. 🧠">
      {/* quick stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlassCard className="!p-4 text-center">
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{minutesToLabel(weekStudy)}</div>
          <div className="mt-0.5 flex items-center justify-center gap-1 text-xs text-slate-500">
            studied this week
            {delta !== 0 && (
              <span className={cn('flex items-center gap-0.5 font-bold', delta > 0 ? 'text-emerald-500' : 'text-rose-500')}>
                {delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {minutesToLabel(Math.abs(delta))}
              </span>
            )}
          </div>
        </GlassCard>
        <GlassCard className="!p-4 text-center">
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{bestHourLabel ?? '—'}</div>
          <div className="text-xs text-slate-500">your power hour</div>
        </GlassCard>
        <GlassCard className="!p-4 text-center">
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{weekTasksDone}</div>
          <div className="text-xs text-slate-500">tasks done this week</div>
        </GlassCard>
        <GlassCard className="!p-4 text-center">
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{moodAvg ? `${MOOD_EMOJI[Math.round(moodAvg) - 1]} ${moodAvg}` : '—'}</div>
          <div className="text-xs text-slate-500">average mood</div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* AI report */}
        <GlassCard className="lg:col-span-2">
          <SectionTitle right={report && !loading ? (
            <Button variant="ghost" size="sm" onClick={generate}><RotateCw size={14} /> Regenerate</Button>
          ) : undefined}>
            🦁 Leo's weekly report
          </SectionTitle>

          {loading ? (
            <AiLoader title="Crunching your week…" hint="Study hours, tasks, habits and moods — all of it." />
          ) : report ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center gap-2">
                <ProgressRing size={104} stroke={11} progress={report.weekScore / 100}
                  color={report.weekScore >= 70 ? '#10b981' : report.weekScore >= 40 ? '#FFB454' : '#f43f5e'}
                  label={`${report.weekScore}`} sub="week score" />
                {report.kudos && (
                  <div className="max-w-44 rounded-2xl bg-amber-400/15 px-3 py-2 text-center text-xs font-bold text-amber-600 dark:text-amber-300">
                    🎉 {report.kudos}
                  </div>
                )}
              </div>
              <div>
                <p className="text-base font-bold text-slate-900 dark:text-white">{report.headline}</p>
                {report.patterns.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {report.patterns.map((p, i) => (
                      <p key={i} className="rounded-2xl bg-white/40 dark:bg-white/5 px-3.5 py-2 text-sm text-slate-700 dark:text-slate-300">📊 {p}</p>
                    ))}
                  </div>
                )}
                {report.recommendations.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Next week, try this</div>
                    <div className="space-y-1.5">
                      {report.recommendations.map((r, i) => (
                        <p key={i} className="rounded-2xl bg-emerald-500/10 px-3.5 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                          {i + 1}. {r}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="text-5xl">🧠</div>
              <p className="mt-3 max-w-sm text-sm text-slate-500">
                Leo will read your study sessions, tasks, habits and journal moods, find your patterns and give you a plan.
              </p>
              {error && <p className="mt-3 rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-500">{error}</p>}
              <Button className="mt-4" size="lg" onClick={generate}><Sparkles size={16} /> Analyze my week</Button>
            </div>
          )}
          {error && report && <p className="mt-3 rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-500">{error}</p>}
        </GlassCard>

        {/* focus hours */}
        <GlassCard>
          <SectionTitle>When you focus best <span className="text-xs font-medium text-slate-400">(last 14 days)</span></SectionTitle>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={hours}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} interval={2} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={32} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`, 'study']} />
                <Bar dataKey="min" name="Study" fill="#A76CFF" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">
            {bestHourLabel ? <>Your sessions land hardest around <b>{bestHourLabel}</b> — guard that hour. 🦁</> : 'Log a few focus sessions and your power hour appears here.'}
          </p>
        </GlassCard>

        {/* mood trend */}
        <GlassCard>
          <SectionTitle>Mood trend <span className="text-xs font-medium text-slate-400">(last 14 days)</span></SectionTitle>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={days14}>
                <defs>
                  <linearGradient id="moodGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFB454" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#FFB454" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} interval={2} />
                <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tickLine={false} axisLine={false} fontSize={12} width={32} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [MOOD_EMOJI[Number(v) - 1] ?? v, 'mood']} />
                <Area type="monotone" dataKey="mood" stroke="#FFB454" strokeWidth={2.5} fill="url(#moodGrad)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">
            {moodAvg ? 'Moods come from your daily journal — keep logging them.' : 'Record a mood in Notes → Journal to see your trend.'}
          </p>
        </GlassCard>
      </div>
    </Page>
  )
}
