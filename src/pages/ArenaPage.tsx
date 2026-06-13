import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { Habit, LeaderboardRow, StudySession, Task } from '../lib/types'
import { GlassCard, Page, ProgressRing, SectionTitle } from '../components/ui'
import { StoryRing } from '../components/Stories'
import { cn, levelForXp, levelProgress, levelTitle, todayKey, addDays } from '../lib/utils'

export function ArenaPage() {
  const { profile } = useAuth()
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: habits } = useTable<Habit>('habits')

  const { data: board = [] } = useQuery<LeaderboardRow[]>({
    queryKey: ['leaderboard'],
    queryFn: async () => {
      const { data } = await supabase.from('leaderboard').select('*')
      return (data ?? []) as LeaderboardRow[]
    },
  })

  const xp = profile?.xp ?? 0
  const level = levelForXp(xp)
  const today = todayKey()
  const weekStart = todayKey(addDays(new Date(), -6))

  const doneTasks = tasks.filter((t) => t.done).length
  const totalFocusMin = sessions.reduce((a, s) => a + s.duration_min, 0)
  const streak = profile?.study_streak ?? 0

  const BADGES = [
    { emoji: '🐾', name: 'First Steps', desc: 'Complete your first task', got: doneTasks >= 1 },
    { emoji: '✅', name: 'Task Tamer', desc: 'Complete 10 tasks', got: doneTasks >= 10 },
    { emoji: '💪', name: 'Task Master', desc: 'Complete 50 tasks', got: doneTasks >= 50 },
    { emoji: '⏱️', name: 'Focused Cub', desc: 'Study 1 hour total', got: totalFocusMin >= 60 },
    { emoji: '📚', name: 'Deep Diver', desc: 'Study 10 hours total', got: totalFocusMin >= 600 },
    { emoji: '🔥', name: 'On Fire', desc: '3-day study streak', got: streak >= 3 },
    { emoji: '🌋', name: 'Unstoppable', desc: '7-day study streak', got: streak >= 7 },
    { emoji: '⭐', name: 'Rising Star', desc: 'Reach level 3', got: level >= 3 },
    { emoji: '👑', name: 'Lion Royalty', desc: 'Reach level 10', got: level >= 10 },
  ]

  const tasksToday = tasks.filter((t) => t.done && t.created_at.slice(0, 10) === today).length
  const focusToday = sessions.filter((s) => s.started_at.slice(0, 10) === today).reduce((a, s) => a + s.duration_min, 0)
  const habitsToday = habits.filter((h) => h.checks.includes(today)).length

  const DAILY = [
    { name: 'Complete 3 tasks', cur: tasksToday, target: 3, xp: 15 },
    { name: 'Focus for 50 minutes', cur: focusToday, target: 50, xp: 20 },
    { name: 'Check off 2 habits', cur: habitsToday, target: 2, xp: 10 },
  ]
  const focusWeek = sessions.filter((s) => s.started_at.slice(0, 10) >= weekStart).reduce((a, s) => a + s.duration_min, 0)
  const tasksWeek = tasks.filter((t) => t.done && t.created_at.slice(0, 10) >= weekStart).length
  const WEEKLY = [
    { name: 'Study 5 hours this week', cur: focusWeek, target: 300, xp: 60 },
    { name: 'Complete 15 tasks this week', cur: tasksWeek, target: 15, xp: 50 },
  ]

  return (
    <Page title="Arena" subtitle="Earn XP, unlock badges, climb the leaderboard. 🏆">
      <div className="grid gap-5 lg:grid-cols-3">
        {/* level card */}
        <GlassCard className="flex items-center gap-5">
          <ProgressRing size={96} stroke={10} progress={levelProgress(xp)} color="#FFB454" label={`Lv ${level}`} sub={levelTitle(level)} />
          <div>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{xp} XP</div>
            <div className="text-sm text-slate-500">{levelTitle(level)} — {Math.round(levelProgress(xp) * 100)}% to next level</div>
          </div>
        </GlassCard>

        {/* challenges */}
        <GlassCard className="lg:col-span-2">
          <SectionTitle>Today's challenges</SectionTitle>
          <div className="space-y-3">
            {DAILY.map((c) => {
              const done = c.cur >= c.target
              return (
                <div key={c.name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className={cn('font-semibold', done ? 'text-emerald-500' : 'text-slate-700 dark:text-slate-200')}>
                      {done ? '✓ ' : ''}{c.name}
                    </span>
                    <span className="text-xs font-bold text-amber-500">+{c.xp} XP</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                    <motion.div
                      className={cn('h-full rounded-full', done ? 'bg-emerald-400' : 'bg-brand-500')}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (c.cur / c.target) * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <SectionTitle right={undefined}><span className="mt-4 inline-block">Weekly challenges</span></SectionTitle>
          <div className="space-y-3">
            {WEEKLY.map((c) => {
              const done = c.cur >= c.target
              return (
                <div key={c.name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className={cn('font-semibold', done ? 'text-emerald-500' : 'text-slate-700 dark:text-slate-200')}>
                      {done ? '✓ ' : ''}{c.name}
                    </span>
                    <span className="text-xs font-bold text-amber-500">+{c.xp} XP</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                    <div className={cn('h-full rounded-full', done ? 'bg-emerald-400' : 'bg-purple-500')}
                      style={{ width: `${Math.min(100, (c.cur / c.target) * 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>

        {/* badges */}
        <GlassCard className="lg:col-span-2">
          <SectionTitle>Achievements</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            {BADGES.map((b, i) => (
              <motion.div
                key={b.name}
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                className={cn(
                  'rounded-2xl p-3 text-center transition',
                  b.got ? 'bg-amber-400/15 ring-1 ring-amber-400/40' : 'bg-slate-500/5 opacity-45 grayscale',
                )}
              >
                <div className="text-3xl">{b.emoji}</div>
                <div className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-100">{b.name}</div>
                <div className="text-[10px] text-slate-500">{b.desc}</div>
              </motion.div>
            ))}
          </div>
        </GlassCard>

        {/* leaderboard */}
        <GlassCard>
          <SectionTitle>Leaderboard</SectionTitle>
          {board.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No players yet — invite friends!</p>
          ) : (
            <div className="space-y-1.5">
              {board.map((r, i) => (
                <div key={r.id} className={cn(
                  'flex items-center gap-3 rounded-2xl px-3 py-2.5',
                  r.id === profile?.id ? 'bg-brand-500/15 ring-1 ring-brand-400/40' : 'bg-white/40 dark:bg-white/5',
                )}>
                  <span className="w-7 text-center text-sm font-extrabold text-slate-400">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <StoryRing userId={r.id}>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
                      {r.avatar_url
                        ? <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
                        : (r.full_name || '?').slice(0, 1).toUpperCase()}
                    </div>
                  </StoryRing>
                  <span className="flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {r.full_name || 'Anonymous lion'}
                  </span>
                  <span className="text-xs font-bold text-amber-500">{r.xp} XP</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </Page>
  )
}
