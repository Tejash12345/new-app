import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area,
} from 'recharts'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import type { SocialSession, StudySession, Task } from '../lib/types'
import { GlassCard, Page, ProgressRing, SectionTitle } from '../components/ui'
import { addDays, minutesToLabel, todayKey } from '../lib/utils'

export function AnalyticsPage() {
  const { profile } = useAuth()
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: usage } = useTable<SocialSession>('social_sessions')
  const { rows: tasks } = useTable<Task>('tasks')

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), -(6 - i))
    const key = todayKey(d)
    return {
      name: d.toLocaleDateString(undefined, { weekday: 'short' }),
      study: sessions.filter((s) => s.started_at.slice(0, 10) === key).reduce((a, s) => a + s.duration_min, 0),
      social: usage.filter((u) => u.used_on === key).reduce((a, u) => a + u.used_min, 0),
    }
  })

  const monthDays = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(new Date(), -(29 - i))
    const key = todayKey(d)
    return {
      name: d.getDate().toString(),
      study: sessions.filter((s) => s.started_at.slice(0, 10) === key).reduce((a, s) => a + s.duration_min, 0),
    }
  })

  const weekStudy = days.reduce((a, d) => a + d.study, 0)
  const weekSocial = days.reduce((a, d) => a + d.social, 0)
  const monthStudy = monthDays.reduce((a, d) => a + d.study, 0)

  // focus score: study vs social balance (100 = all study)
  const focusScore = weekStudy + weekSocial === 0 ? 50 : Math.round((weekStudy / (weekStudy + weekSocial)) * 100)

  // productivity score: tasks completed this week / created (+ streak bonus)
  const weekStart = todayKey(addDays(new Date(), -6))
  const doneWeek = tasks.filter((t) => t.done && t.created_at.slice(0, 10) >= weekStart).length
  const totalWeek = tasks.filter((t) => t.created_at.slice(0, 10) >= weekStart).length
  const productivityScore = Math.min(100, Math.round(
    (totalWeek === 0 ? 50 : (doneWeek / totalWeek) * 70) + Math.min(30, (profile?.study_streak ?? 0) * 5),
  ))

  const tooltipStyle = {
    borderRadius: 16, border: 'none',
    background: 'rgba(20,24,40,0.92)', color: '#fff', fontSize: 12,
  }

  return (
    <Page title="Analytics" subtitle="Your study data, beautifully visualized.">
      {/* scores */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlassCard className="flex items-center justify-center gap-4 !p-4">
          <ProgressRing size={76} stroke={8} progress={focusScore / 100} color={focusScore > 60 ? '#10b981' : '#f59e0b'} label={`${focusScore}`} sub="focus" />
          <div className="text-xs text-slate-500">Study vs<br />scroll balance</div>
        </GlassCard>
        <GlassCard className="flex items-center justify-center gap-4 !p-4">
          <ProgressRing size={76} stroke={8} progress={productivityScore / 100} color="#4f6bfa" label={`${productivityScore}`} sub="prod." />
          <div className="text-xs text-slate-500">Task completion<br />+ streak</div>
        </GlassCard>
        <GlassCard className="!p-4 text-center">
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{minutesToLabel(weekStudy)}</div>
          <div className="text-xs text-slate-500">studied this week</div>
        </GlassCard>
        <GlassCard className="!p-4 text-center">
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{minutesToLabel(monthStudy)}</div>
          <div className="text-xs text-slate-500">studied this month</div>
        </GlassCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard>
          <SectionTitle>Study vs social — this week</SectionTitle>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={days} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={32} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`]} />
                <Bar dataKey="study" name="Study" fill="#4f6bfa" radius={[6, 6, 0, 0]} />
                <Bar dataKey="social" name="Social" fill="#f43f5e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex justify-center gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#4f6bfa]" /> Study</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#f43f5e]" /> Social media</span>
          </div>
        </GlassCard>

        <GlassCard>
          <SectionTitle>Study minutes — last 30 days</SectionTitle>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={monthDays}>
                <defs>
                  <linearGradient id="studyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f6bfa" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#4f6bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} interval={4} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={32} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`, 'study']} />
                <Area type="monotone" dataKey="study" stroke="#4f6bfa" strokeWidth={2.5} fill="url(#studyGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="lg:col-span-2">
          <SectionTitle>Weekly report</SectionTitle>
          <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <p>📚 You studied <b>{minutesToLabel(weekStudy)}</b> across {sessions.filter((s) => s.started_at.slice(0, 10) >= weekStart).length} sessions this week.</p>
            <p>📱 Social media: <b>{minutesToLabel(weekSocial)}</b> — {focusScore >= 60 ? 'great balance! 🦁' : 'the lion suggests less scrolling. 🦁'}</p>
            <p>✅ Tasks completed this week: <b>{doneWeek}</b> of {totalWeek || '—'}.</p>
            <p>🔥 Current study streak: <b>{profile?.study_streak ?? 0} days</b>. {(profile?.study_streak ?? 0) >= 3 ? 'Keep it alive!' : 'Start one today with a focus session.'}</p>
          </div>
        </GlassCard>
      </div>
    </Page>
  )
}
