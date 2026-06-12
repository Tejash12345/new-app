import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { SocialLimit, SocialSession, StudySession, Task } from '../lib/types'
import { GlassCard } from './ui'
import { levelForXp, levelProgress, levelTitle, todayKey } from '../lib/utils'

type Stage = { name: string; minLevel: number; size: string; crown: boolean }
const STAGES: Stage[] = [
  { name: 'Lion Cub', minLevel: 1, size: 'text-6xl', crown: false },
  { name: 'Young Lion', minLevel: 3, size: 'text-7xl', crown: false },
  { name: 'Mighty Lion', minLevel: 5, size: 'text-8xl', crown: false },
  { name: 'Lion King', minLevel: 8, size: 'text-8xl', crown: true },
]

export function LionCompanion() {
  const { profile } = useAuth()
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: limits } = useTable<SocialLimit>('social_limits')
  const { rows: usage } = useTable<SocialSession>('social_sessions')

  const level = levelForXp(profile?.xp ?? 0)
  const stage = [...STAGES].reverse().find((s) => level >= s.minLevel) ?? STAGES[0]
  const nextStage = STAGES.find((s) => s.minLevel > level)

  const today = todayKey()
  const studiedToday = sessions.some((s) => s.started_at.slice(0, 10) === today)
  const tasksDoneToday = tasks.filter((t) => t.done && t.created_at.slice(0, 10) === today).length
  const overscrolled = limits.some((l) => {
    if (!l.enabled) return false
    const used = usage.filter((u) => u.app_name === l.app_name && u.used_on === today)
      .reduce((a, u) => a + u.used_min, 0)
    return used >= l.daily_limit_min
  })

  const mood: 'happy' | 'grumpy' | 'waiting' =
    overscrolled ? 'grumpy' : studiedToday || tasksDoneToday > 0 ? 'happy' : 'waiting'

  const messages = useMemo(() => {
    const name = (profile?.full_name || 'friend').split(' ')[0]
    if (mood === 'grumpy') {
      return [
        `Grrr… too much scrolling today, ${name}. 😤`,
        'My mane droops when you overscroll…',
        'Win back my pride — one focus session!',
      ]
    }
    if (mood === 'happy') {
      return [
        `You studied today — I'm proud of you, ${name}! 😻`,
        'Every session makes my mane grow!',
        `${tasksDoneToday > 0 ? `${tasksDoneToday} task(s) done today. Roar!` : 'Keep the streak alive! 🔥'}`,
      ]
    }
    return [
      `I'm hungry for XP, ${name}… feed me a focus session! 🍖`,
      'A 15-minute pomodoro would make my day.',
      'Lions grow when students study. Just saying. 👀',
    ]
  }, [mood, profile?.full_name, tasksDoneToday])

  const [msgIndex, setMsgIndex] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 6000)
    return () => clearInterval(t)
  }, [messages.length])

  return (
    <GlassCard className="relative overflow-hidden">
      <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-amber-400/15 blur-2xl" />
      <div className="flex items-center gap-5">
        {/* the lion */}
        <div className="relative shrink-0">
          {stage.crown && (
            <motion.div
              initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              className="absolute -top-5 left-1/2 -translate-x-1/2 text-2xl"
            >
              👑
            </motion.div>
          )}
          <motion.div
            animate={
              mood === 'happy'
                ? { y: [0, -6, 0], rotate: [0, -3, 3, 0] }
                : mood === 'grumpy'
                  ? { x: [0, -2, 2, 0] }
                  : { y: [0, -3, 0] }
            }
            transition={{ repeat: Infinity, duration: mood === 'grumpy' ? 0.8 : 2.6, ease: 'easeInOut' }}
            className={`${stage.size} select-none drop-shadow-[0_8px_24px_rgba(255,170,60,0.35)]`}
          >
            {mood === 'grumpy' ? '🦁' : '🦁'}
          </motion.div>
          <div className="mt-1 text-center text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-300">
            {stage.name}
          </div>
        </div>

        {/* speech + growth */}
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={msgIndex + mood}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="relative rounded-2xl rounded-bl-md bg-amber-400/15 px-4 py-3 text-sm font-medium text-slate-800 dark:text-amber-50"
            >
              {messages[msgIndex]}
            </motion.div>
          </AnimatePresence>

          <div className="mt-3">
            <div className="flex justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span>Level {level} · {levelTitle(level)}</span>
              {nextStage && <span>evolves at Lv {nextStage.minLevel} → {nextStage.name}</span>}
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400"
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(levelProgress(profile?.xp ?? 0) * 100)}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

/** Full-screen confetti + banner when the user levels up. */
export function LevelUpCelebration() {
  const { profile } = useAuth()
  const [show, setShow] = useState<number | null>(null)

  const level = levelForXp(profile?.xp ?? 0)

  useEffect(() => {
    if (!profile) return
    const prev = Number(localStorage.getItem('fl-level') ?? '0')
    if (prev !== 0 && level > prev) setShow(level)
    localStorage.setItem('fl-level', String(level))
  }, [level, profile?.id])

  const confetti = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 12) * 0.12,
        color: ['#FFB454', '#4f6bfa', '#FF6584', '#00BFA6', '#A76CFF', '#42C7F5'][i % 6],
        size: 7 + (i % 5) * 3,
        spin: i % 2 === 0 ? 360 : -360,
      })),
    [],
  )

  return (
    <AnimatePresence>
      {show !== null && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setShow(null)}
        >
          {confetti.map((c, i) => (
            <motion.div
              key={i}
              initial={{ y: '-10vh', x: 0, rotate: 0, opacity: 1 }}
              animate={{ y: '110vh', rotate: c.spin, opacity: [1, 1, 0.6] }}
              transition={{ duration: 2.8 + (i % 4) * 0.4, delay: c.delay, ease: 'linear' }}
              className="absolute top-0 rounded-sm"
              style={{ left: `${c.left}%`, width: c.size, height: c.size * 0.45, background: c.color }}
            />
          ))}
          <motion.div
            initial={{ scale: 0.6, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 14 }}
            className="glass-strong mx-4 max-w-sm rounded-3xl p-8 text-center"
          >
            <motion.div
              animate={{ rotate: [0, -8, 8, 0], scale: [1, 1.15, 1] }}
              transition={{ repeat: 2, duration: 0.6 }}
              className="text-7xl"
            >
              🦁
            </motion.div>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">LEVEL UP!</h2>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              You reached <b>Level {show}</b> — {levelTitle(show)}
            </p>
            <p className="mt-2 text-sm text-slate-500">Your lion grows stronger with every study session. 💪</p>
            <button
              onClick={() => setShow(null)}
              className="mt-5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 px-6 py-2.5 font-bold text-[#241a05] shadow-lg shadow-orange-500/40"
            >
              Keep going! 🚀
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
