import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Flame, Timer, CheckCircle2, Star, ArrowRight, Shield } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { Habit, SocialLimit, SocialSession, StudySession, Task, TimetableBlock } from '../lib/types'
import { GlassCard, Page, ProgressRing, SectionTitle, Stat, Empty } from '../components/ui'
import { LionCompanion, LevelUpCelebration } from '../components/LionCompanion'
import { levelForXp, levelProgress, levelTitle, minutesToLabel, quoteOfTheDay, timeLabel, todayKey } from '../lib/utils'

export function Dashboard() {
  const { profile } = useAuth()
  const { rows: tasks, update: updateTask } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: blocks } = useTable<TimetableBlock>('timetable_blocks')
  const { rows: habits, update: updateHabit } = useTable<Habit>('habits')
  const { rows: limits } = useTable<SocialLimit>('social_limits')
  const { rows: usage } = useTable<SocialSession>('social_sessions')

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (profile?.full_name || 'Student').split(' ')[0]
  const [quote, author] = quoteOfTheDay()

  const today = todayKey()
  const dow = (new Date().getDay() + 6) % 7

  const todayTasks = tasks.filter((t) => !t.done && t.kind !== 'goal')
  const dueToday = todayTasks.filter((t) => t.due_at && t.due_at.slice(0, 10) <= today)
  const focusMinToday = sessions
    .filter((s) => s.started_at.slice(0, 10) === today)
    .reduce((a, s) => a + s.duration_min, 0)
  const todayBlocks = blocks
    .filter((b) => b.day_of_week === dow)
    .sort((a, b) => a.start_min - b.start_min)

  const usedToday = usage.filter((u) => u.used_on === today).reduce((a, u) => a + u.used_min, 0)
  const totalLimit = limits.filter((l) => l.enabled).reduce((a, l) => a + l.daily_limit_min, 0)

  const level = levelForXp(profile?.xp ?? 0)

  return (
    <Page
      title={`${greeting}, ${firstName} 👋`}
      subtitle={`"${quote}" — ${author}`}
    >
      <LevelUpCelebration />

      {/* lion companion */}
      <div className="mb-5">
        <LionCompanion />
      </div>

      {/* exam countdown */}
      {(() => {
        const nextExam = tasks
          .filter((t) => t.kind === 'exam' && !t.done && t.due_at && new Date(t.due_at) > new Date())
          .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0]
        if (!nextExam) return null
        const daysLeft = Math.ceil((new Date(nextExam.due_at!).getTime() - Date.now()) / 86_400_000)
        const urgent = daysLeft <= 7
        return (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
            <GlassCard className={urgent ? '!border-rose-400/40' : ''}>
              <div className="flex items-center gap-4">
                <div className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-3xl text-white shadow-lg ${urgent ? 'bg-gradient-to-br from-rose-500 to-orange-500' : 'bg-gradient-to-br from-brand-500 to-purple-500'}`}>
                  <span className="text-2xl font-extrabold leading-none">{daysLeft}</span>
                  <span className="text-[9px] font-bold uppercase opacity-80">day{daysLeft === 1 ? '' : 's'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {urgent ? '🚨 Exam coming up!' : '🎓 Next exam'}
                  </div>
                  <div className="truncate text-lg font-extrabold text-slate-900 dark:text-white">{nextExam.title}</div>
                  <div className="text-sm text-slate-500">
                    {new Date(nextExam.due_at!).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                    {nextExam.subject && ` · ${nextExam.subject}`}
                    {' · prep '}{nextExam.progress}%
                  </div>
                </div>
                <div className="hidden sm:block w-28">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${nextExam.progress}%` }} />
                  </div>
                  <div className="mt-1 text-center text-[10px] font-bold text-slate-400">preparation</div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )
      })()}

      {/* stats row */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: <Flame size={20} />, label: 'Study streak', value: `${profile?.study_streak ?? 0} days`, tint: '#FF6B4A' },
          { icon: <Timer size={20} />, label: 'Focus today', value: minutesToLabel(focusMinToday), tint: '#4f6bfa' },
          { icon: <CheckCircle2 size={20} />, label: 'Tasks pending', value: `${todayTasks.length}`, tint: '#00BFA6' },
          { icon: <Star size={20} />, label: levelTitle(level), value: `Level ${level}`, tint: '#FFB454' },
        ].map((s, i) => (
          <motion.div key={s.label}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            <GlassCard float className="!p-4">
              <Stat {...s} />
            </GlassCard>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* today timetable */}
        <GlassCard className="lg:col-span-2">
          <SectionTitle right={<Link to="/planner" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">Open planner <ArrowRight size={14} /></Link>}>
            Today's timetable
          </SectionTitle>
          {todayBlocks.length === 0 ? (
            <Empty emoji="🗓️" text={'No classes or study blocks today.\nPlan your day in the Planner!'} />
          ) : (
            <div className="space-y-2">
              {todayBlocks.map((b) => {
                const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
                const live = nowMin >= b.start_min && nowMin < b.end_min
                return (
                  <div key={b.id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                    <div className="h-10 w-1.5 rounded-full" style={{ background: b.color }} />
                    <div className="flex-1">
                      <div className="font-semibold text-slate-900 dark:text-white">{b.title}</div>
                      <div className="text-xs text-slate-500">{timeLabel(b.start_min)} – {timeLabel(b.end_min)}{b.subject && ` · ${b.subject}`}</div>
                    </div>
                    {live && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-500">Now</span>}
                  </div>
                )
              })}
            </div>
          )}
        </GlassCard>

        {/* screen-time guard */}
        <GlassCard>
          <SectionTitle right={<Link to="/wellbeing" className="text-brand-500"><Shield size={16} /></Link>}>
            Screen-time guard
          </SectionTitle>
          <div className="flex flex-col items-center py-2">
            <ProgressRing
              size={120} stroke={11}
              progress={totalLimit ? usedToday / totalLimit : 0}
              color={usedToday >= totalLimit && totalLimit > 0 ? '#f43f5e' : '#4f6bfa'}
              label={minutesToLabel(usedToday)}
              sub={totalLimit ? `of ${minutesToLabel(totalLimit)}` : 'no limits set'}
            />
            <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
              {totalLimit === 0
                ? 'Set social media limits and the lion will guard your focus. 🦁'
                : usedToday >= totalLimit
                  ? 'Limit reached — the lion is watching. 🦁'
                  : `${minutesToLabel(Math.max(0, totalLimit - usedToday))} of scroll time left today.`}
            </p>
          </div>
        </GlassCard>

        {/* due today */}
        <GlassCard className="lg:col-span-2">
          <SectionTitle right={<Link to="/tasks" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">All tasks <ArrowRight size={14} /></Link>}>
            Due now
          </SectionTitle>
          {dueToday.length === 0 ? (
            <Empty emoji="🎉" text="Nothing urgent. You're ahead of schedule!" />
          ) : (
            <div className="space-y-2">
              {dueToday.slice(0, 5).map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                  <input
                    type="checkbox" checked={t.done}
                    onChange={() => updateTask({ id: t.id, done: true } as Partial<Task> & { id: string })}
                    className="h-5 w-5 accent-brand-500"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-slate-900 dark:text-white">{t.title}</div>
                    <div className="text-xs capitalize text-slate-500">{t.kind}{t.subject && ` · ${t.subject}`}</div>
                  </div>
                  <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-500">DUE</span>
                </label>
              ))}
            </div>
          )}
        </GlassCard>

        {/* habits + level */}
        <div className="space-y-5">
          <GlassCard>
            <SectionTitle>Today's habits</SectionTitle>
            {habits.length === 0 ? (
              <p className="text-sm text-slate-500">No habits yet — add some in Notes → Habits.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {habits.map((h) => {
                  const done = h.checks.includes(today)
                  return (
                    <button
                      key={h.id}
                      onClick={() => updateHabit({
                        id: h.id,
                        checks: done ? h.checks.filter((c) => c !== today) : [...h.checks, today],
                      } as Partial<Habit> & { id: string })}
                      className="rounded-2xl px-3 py-2 text-sm font-semibold transition-all active:scale-95"
                      style={done
                        ? { background: h.color, color: '#fff' }
                        : { background: `${h.color}1e`, color: h.color }}
                    >
                      {h.emoji} {h.name}
                    </button>
                  )
                })}
              </div>
            )}
          </GlassCard>

          <GlassCard>
            <div className="flex items-center gap-4">
              <ProgressRing size={72} stroke={7} progress={levelProgress(profile?.xp ?? 0)} color="#FFB454" label={`${level}`} sub="level" />
              <div>
                <div className="font-bold text-slate-900 dark:text-white">{levelTitle(level)}</div>
                <div className="text-xs text-slate-500">{profile?.xp ?? 0} XP — keep going!</div>
                <Link to="/arena" className="mt-1 inline-block text-xs font-bold text-brand-500 hover:underline">View achievements →</Link>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </Page>
  )
}
