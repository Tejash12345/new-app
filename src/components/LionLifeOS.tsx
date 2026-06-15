import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles, GraduationCap, Hourglass, Bot, Flame, RefreshCw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import { supabase } from '../lib/supabase'
import type { Capsule, FeedPost, Habit, StudySession, Task } from '../lib/types'
import { GlassCard, ProgressRing } from './ui'
import { captureSnapshot, countdownLabel, guardianStage, isSealed, isUnlockable, lionGrowthScore } from '../lib/capsule'
import { dailyBriefing } from '../lib/ai'
import { cn, levelForXp, levelProgress, levelTitle, minutesToLabel, todayKey } from '../lib/utils'

/**
 * Lion Life OS — the flagship daily hub. One glance gives the user their AI
 * morning briefing, growth score, level/XP, streak and next capsule, with quick
 * links into the AI-powered surfaces. Built to be the reason to open the app
 * every day. Reuses the existing growth-score engine and lion-ai function.
 */
export function LionLifeOS() {
  const { user, profile } = useAuth()
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: habits } = useTable<Habit>('habits')
  const { rows: posts } = useTable<FeedPost>('feed_posts')
  const { rows: capsules } = useTable<Capsule>('capsules')

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (profile?.full_name || 'friend').split(' ')[0]

  // The heading already shows the correct live greeting; strip any (possibly
  // stale, cached-in-the-morning) greeting the AI briefing may start with.
  const stripGreeting = (t: string) =>
    t.replace(/^\s*good\s+(morning|afternoon|evening)\b[\s,!.—-]*[A-Za-z]*[\s,!.—-]*/i, '').trim() || t

  const snapshot = useMemo(
    () => captureSnapshot({ profile, tasks, sessions, habits, feedPosts: posts }),
    [profile, tasks, sessions, habits, posts],
  )
  const allGoals = capsules.flatMap((c) => (Array.isArray(c.goals) ? c.goals : []))
  const goalsRatio = allGoals.length ? allGoals.filter((g) => g.done).length / allGoals.length : undefined
  const score = lionGrowthScore(snapshot, goalsRatio)
  const stage = guardianStage(score)

  const xp = profile?.xp ?? 0
  const level = levelForXp(xp)
  const progress = levelProgress(xp)
  const nextCapsule = capsules.filter(isSealed).sort((a, b) => a.unlock_at.localeCompare(b.unlock_at))[0]
  const readyCapsule = capsules.find(isUnlockable)

  // ---- AI daily briefing (cached once per day) ----
  const [brief, setBrief] = useState('')
  const [briefBusy, setBriefBusy] = useState(false)
  const tried = useRef(false)

  function context(): string {
    return `Name ${firstName}. Growth score ${score}/100 (${stage.name}). Level ${level} (${levelTitle(level)}), ${xp} XP. ` +
      `Streak ${snapshot.streak} days. ${snapshot.tasksDone}/${snapshot.tasksTotal} tasks done, ` +
      `${minutesToLabel(snapshot.studyMin)} total focus. ${capsules.filter(isSealed).length} sealed capsules.`
  }

  async function generate(force = false) {
    if (!user || briefBusy) return
    setBriefBusy(true)
    try {
      const text = await dailyBriefing(context())
      if (text) {
        setBrief(text)
        await supabase.from('ai_briefings').upsert(
          { user_id: user.id, brief_date: todayKey(), text },
          { onConflict: 'user_id,brief_date', ignoreDuplicates: !force },
        )
        if (force) {
          await supabase.from('ai_briefings').update({ text }).eq('user_id', user.id).eq('brief_date', todayKey())
        }
      }
    } catch {
      if (!brief) setBrief(`${greeting}, ${firstName} 🦁 Let's make today count — one focused step at a time.`)
    } finally {
      setBriefBusy(false)
    }
  }

  useEffect(() => {
    if (!user || tried.current) return
    tried.current = true
    supabase.from('ai_briefings').select('text').eq('user_id', user.id).eq('brief_date', todayKey()).maybeSingle()
      .then(({ data }) => {
        if (data?.text) setBrief(data.text)
        else generate()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
      <GlassCard className="overflow-hidden !border-amber-400/30 bg-gradient-to-br from-amber-400/15 via-transparent to-orange-500/10">
        {/* greeting + AI briefing */}
        <div className="flex items-start gap-4">
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-3xl shadow-lg sm:flex">
            🦁
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-lg font-extrabold text-slate-900 dark:text-white sm:text-xl">{greeting}, {firstName} 🦁</h2>
              <button onClick={() => generate(true)} disabled={briefBusy} title="Refresh briefing"
                className="shrink-0 rounded-full p-1.5 text-amber-500 hover:bg-amber-400/15 disabled:opacity-50">
                <RefreshCw size={14} className={cn(briefBusy && 'animate-spin')} />
              </button>
            </div>
            <p className="mt-1 break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {brief ? stripGreeting(brief) : (briefBusy ? '🦁 Leo is preparing your briefing…' : 'Your daily briefing will appear here.')}
            </p>
          </div>
        </div>

        {/* widgets */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* growth score */}
          <div className="flex flex-col items-center rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <ProgressRing progress={score / 100} size={72} stroke={8} color={stage.aura} label={`${score}`} sub="Growth" />
            <div className="mt-1 text-[11px] font-semibold text-slate-500">{stage.name}</div>
          </div>
          {/* level / xp */}
          <div className="flex flex-col justify-center rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <div className="text-xs font-bold uppercase tracking-wide text-amber-500">Level {level}</div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white">{levelTitle(level)}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-slate-500">{xp} XP</div>
          </div>
          {/* streak */}
          <div className="flex flex-col justify-center rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <Flame size={18} className="text-orange-500" />
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{snapshot.streak} days</div>
            <div className="text-[11px] text-slate-500">Study streak</div>
          </div>
          {/* capsule countdown / ready-to-open */}
          <Link to="/capsule" className={cn('flex flex-col justify-center rounded-2xl p-3 transition',
            readyCapsule ? 'bg-gradient-to-br from-amber-400/30 to-orange-500/20 ring-1 ring-amber-400/50'
              : 'bg-white/40 hover:bg-white/60 dark:bg-white/5 dark:hover:bg-white/10')}>
            <Hourglass size={18} className={readyCapsule ? 'text-amber-500' : 'text-brand-500'} />
            {readyCapsule ? (
              <>
                <div className="mt-1 text-sm font-extrabold text-amber-600 dark:text-amber-300">🎉 Capsule ready</div>
                <div className="truncate text-[11px] font-semibold text-amber-600/80 dark:text-amber-300/80">Tap to open →</div>
              </>
            ) : nextCapsule ? (
              <>
                <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{countdownLabel(nextCapsule.unlock_at)}</div>
                <div className="truncate text-[11px] text-slate-500">until "{nextCapsule.title}"</div>
              </>
            ) : (
              <>
                <div className="mt-1 text-sm font-extrabold text-slate-900 dark:text-white">No capsule</div>
                <div className="text-[11px] text-slate-500">Seal one →</div>
              </>
            )}
          </Link>
        </div>

        {/* quick links into the AI surfaces */}
        <div className="mt-3 flex flex-wrap gap-2">
          <QuickLink to="/learn" icon={<GraduationCap size={14} />} label="Learning paths" />
          <QuickLink to="/coach" icon={<Bot size={14} />} label="Coach Leo" />
          <QuickLink to="/capsule" icon={<Hourglass size={14} />} label="Future Me" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-600 dark:text-amber-300">
            <Sparkles size={13} /> Tap 🦁 anytime for AI
          </span>
        </div>
      </GlassCard>
    </motion.div>
  )
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-500/20 dark:text-slate-200">
      {icon} {label}
    </Link>
  )
}
