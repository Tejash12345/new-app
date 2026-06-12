import { useState } from 'react'
import { Copy, Printer, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { SocialLimit, SocialSession, StudySession, Task } from '../lib/types'
import { Button, GlassCard, Page, SectionTitle } from '../components/ui'
import { addDays, cn, minutesToLabel, todayKey } from '../lib/utils'

export function ReportPage() {
  const { profile } = useAuth()
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: usage } = useTable<SocialSession>('social_sessions')
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: limits } = useTable<SocialLimit>('social_limits')
  const [copied, setCopied] = useState(false)

  const name = profile?.full_name || 'Student'
  const weekStart = addDays(new Date(), -6)
  const range = `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), -(6 - i))
    const key = todayKey(d)
    const study = sessions.filter((s) => s.started_at.slice(0, 10) === key).reduce((a, s) => a + s.duration_min, 0)
    const social = usage.filter((u) => u.used_on === key).reduce((a, u) => a + u.used_min, 0)
    const done = tasks.filter((t) => t.done && t.created_at.slice(0, 10) === key).length
    return { label: d.toLocaleDateString(undefined, { weekday: 'short' }), key, study, social, done }
  })

  const weekStudy = days.reduce((a, d) => a + d.study, 0)
  const weekSocial = days.reduce((a, d) => a + d.social, 0)
  const weekSessions = sessions.filter((s) => s.started_at.slice(0, 10) >= todayKey(weekStart)).length
  const weekDone = tasks.filter((t) => t.done && t.created_at.slice(0, 10) >= todayKey(weekStart)).length
  const weekTotal = tasks.filter((t) => t.created_at.slice(0, 10) >= todayKey(weekStart)).length
  const daysStudied = days.filter((d) => d.study > 0).length
  const limitBreaks = days.reduce((acc, d) => {
    const broke = limits.some((l) => {
      if (!l.enabled) return false
      const used = usage.filter((u) => u.app_name === l.app_name && u.used_on === d.key)
        .reduce((a, u) => a + u.used_min, 0)
      return used > l.daily_limit_min
    })
    return acc + (broke ? 1 : 0)
  }, 0)

  const focusScore = weekStudy + weekSocial === 0 ? 50 : Math.round((weekStudy / (weekStudy + weekSocial)) * 100)
  const score = Math.round(
    Math.min(40, (weekStudy / 300) * 40) +            // up to 40 pts for 5h+ study
    Math.min(25, daysStudied * 5) +                    // consistency
    Math.min(20, weekTotal === 0 ? 10 : (weekDone / weekTotal) * 20) + // tasks
    Math.max(0, 15 - limitBreaks * 4),                 // discipline
  )
  const grade = score >= 85 ? 'A+' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D'
  const gradeColor = score >= 70 ? '#10b981' : score >= 55 ? '#f59e0b' : '#f43f5e'

  const lionComment =
    grade === 'A+' || grade === 'A'
      ? `${name.split(' ')[0]} had an excellent week — consistent study, controlled screen time. Keep it up! 🦁👏`
      : grade === 'B'
        ? `A good week with room to grow — a little more daily consistency will make a big difference. 🦁`
        : `${name.split(' ')[0]} needs support this week — try agreeing on a fixed daily study time and social media window together. 🦁`

  const reportText = [
    `🦁 *FocusLion Weekly Report* — ${name}`,
    `📅 ${range}`,
    ``,
    `🏆 Grade: *${grade}* (${score}/100)`,
    `📚 Study time: ${minutesToLabel(weekStudy)} across ${weekSessions} sessions`,
    `🗓️ Studied on ${daysStudied}/7 days`,
    `✅ Tasks completed: ${weekDone}${weekTotal ? `/${weekTotal}` : ''}`,
    `🔥 Study streak: ${profile?.study_streak ?? 0} days`,
    `📱 Social media: ${minutesToLabel(weekSocial)} (limits broken on ${limitBreaks} day${limitBreaks === 1 ? '' : 's'})`,
    `🎯 Focus balance: ${focusScore}/100`,
    ``,
    `Daily study: ${days.map((d) => `${d.label} ${d.study}m`).join(' · ')}`,
    ``,
    `🦁 Coach's note: ${lionComment}`,
  ].join('\n')

  async function copy() {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Page
      title="Parent Report"
      subtitle="A weekly report card to share with parents — honest, automatic, no editing possible."
      actions={
        <div className="flex gap-2 print:hidden">
          <Button variant="soft" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied!' : 'Copy for WhatsApp'}
          </Button>
          <Button onClick={() => window.print()}><Printer size={16} /> Print / PDF</Button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {/* report card */}
        <GlassCard className="lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Weekly Report Card</div>
              <h2 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{name}</h2>
              <div className="text-sm text-slate-500">{range}</div>
            </div>
            <div className="flex h-20 w-20 flex-col items-center justify-center rounded-3xl text-white shadow-lg" style={{ background: gradeColor }}>
              <span className="text-3xl font-extrabold leading-none">{grade}</span>
              <span className="text-[10px] font-bold opacity-80">{score}/100</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ['📚 Study time', minutesToLabel(weekStudy)],
              ['🗓️ Days studied', `${daysStudied} of 7`],
              ['✅ Tasks done', `${weekDone}${weekTotal ? ` / ${weekTotal}` : ''}`],
              ['🔥 Streak', `${profile?.study_streak ?? 0} days`],
              ['📱 Social media', minutesToLabel(weekSocial)],
              ['🚨 Limit breaks', `${limitBreaks} day${limitBreaks === 1 ? '' : 's'}`],
            ].map(([label, val]) => (
              <div key={label as string} className="rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                <div className="text-lg font-extrabold text-slate-900 dark:text-white">{val}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {/* daily table */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 text-left">Day</th>
                  {days.map((d) => <th key={d.key} className="py-2">{d.label}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-200/40 dark:border-white/5">
                  <td className="py-2 text-left font-semibold text-slate-600 dark:text-slate-300">📚 Study</td>
                  {days.map((d) => (
                    <td key={d.key} className={cn('py-2 font-bold', d.study > 0 ? 'text-emerald-500' : 'text-slate-400')}>
                      {d.study > 0 ? `${d.study}m` : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-slate-200/40 dark:border-white/5">
                  <td className="py-2 text-left font-semibold text-slate-600 dark:text-slate-300">📱 Social</td>
                  {days.map((d) => (
                    <td key={d.key} className={cn('py-2', d.social > 60 ? 'font-bold text-rose-500' : 'text-slate-500')}>
                      {d.social > 0 ? `${d.social}m` : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-slate-200/40 dark:border-white/5">
                  <td className="py-2 text-left font-semibold text-slate-600 dark:text-slate-300">✅ Tasks</td>
                  {days.map((d) => (
                    <td key={d.key} className="py-2 text-slate-500">{d.done || '—'}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-5 rounded-2xl bg-amber-400/10 px-4 py-3 text-sm text-slate-700 dark:text-amber-50">
            <b>🦁 Coach's note for parents:</b> {lionComment}
          </div>
        </GlassCard>

        {/* how it works for parents */}
        <GlassCard className="print:hidden">
          <SectionTitle>For parents 👨‍👩‍👧</SectionTitle>
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>📊 This report is generated <b>automatically from real activity</b> — focus sessions, completed tasks and self-tracked screen time. The student cannot edit the numbers.</p>
            <p>💬 Tap <b>"Copy for WhatsApp"</b> and the student can send it to you every Sunday — formatted and readable.</p>
            <p>🖨️ <b>"Print / PDF"</b> makes a clean printable report card.</p>
            <p>🤝 <b>Tip:</b> don't punish a bad week — sit together, set the daily limits and allowed hours in the Wellbeing page as a family agreement. The lion does the reminding, so you don't have to. 🦁</p>
          </div>
        </GlassCard>
      </div>
    </Page>
  )
}
