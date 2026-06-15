import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, RefreshCw, Sparkles, Target } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import { supabase } from '../lib/supabase'
import type { AiMission, StudySession, Task } from '../lib/types'
import { GlassCard } from './ui'
import { generateMission } from '../lib/ai'
import { cn, todayKey } from '../lib/utils'

/**
 * Daily Lion Mission — Gemini generates one personalized mission per day.
 * Auto-creates today's mission on first dashboard view, shows it as a card, and
 * tracks completion. Falls back gracefully if the AI service isn't reachable.
 */
export function DailyMissionCard() {
  const { user, profile, addXp } = useAuth()
  const { rows: missions, isLoading } = useTable<AiMission>('ai_missions')
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')

  const today = todayKey()
  const mission = missions.find((m) => m.mission_date === today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tried = useRef(false)

  function context(): string {
    const focusToday = sessions
      .filter((s) => s.started_at.slice(0, 10) === today)
      .reduce((a, s) => a + s.duration_min, 0)
    const pending = tasks.filter((t) => !t.done).length
    const subjects = [...new Set(sessions.map((s) => s.subject).filter(Boolean))].slice(0, 4).join(', ')
    return `Student "${(profile?.full_name || 'friend').split(' ')[0]}". ` +
      `Study streak ${profile?.study_streak ?? 0} days, ${pending} tasks pending, ` +
      `${focusToday} min focused today. Subjects: ${subjects || 'none yet'}. ` +
      `Make a mission that pushes them gently forward today.`
  }

  async function generate(force = false) {
    if (!user || busy) return
    setBusy(true)
    setError('')
    try {
      const m = await generateMission(context())
      const { error: insErr } = await supabase
        .from('ai_missions')
        .upsert(
          { user_id: user.id, mission_date: today, title: m.title, detail: m.detail, xp: m.xp, done: false },
          { onConflict: 'user_id,mission_date', ignoreDuplicates: !force },
        )
      if (insErr) setError(insErr.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the AI service.')
    } finally {
      setBusy(false)
    }
  }

  // auto-generate today's mission once, after data has loaded
  useEffect(() => {
    if (isLoading || tried.current || !user) return
    if (!mission) { tried.current = true; generate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, mission, user])

  // self-heal: an older mission may have been saved with raw ```json text
  // (before the parser fix). Salvage the real title/detail from it with a
  // regex and repair the row in place — no AI call, so it works even while
  // Gemini quota is exhausted.
  const healed = useRef(false)
  useEffect(() => {
    if (!mission || healed.current || !user) return
    const corrupt = /```|"title"\s*:|^\s*\{/.test(mission.title) || /```|"title"\s*:/.test(mission.detail)
    if (!corrupt) return
    healed.current = true
    const blob = `${mission.title}\n${mission.detail}`
    const title = (blob.match(/"title"\s*:\s*"([^"]+)"/)?.[1] ?? 'Today’s Lion Mission').slice(0, 80)
    const detail = (blob.match(/"detail"\s*:\s*"([^"]+)"/)?.[1] ?? 'Tackle one focused 25-minute study session today. 🦁').slice(0, 240)
    const xp = Math.max(10, Math.min(50, Number(blob.match(/"xp"\s*:\s*(\d+)/)?.[1]) || mission.xp || 20))
    supabase.from('ai_missions').update({ title, detail, xp }).eq('id', mission.id).then(() => {}, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, user])

  async function toggleDone() {
    if (!mission) return
    const nowDone = !mission.done
    await supabase.from('ai_missions').update({ done: nowDone }).eq('id', mission.id)
    // award (or revoke, on un-check) the mission's XP — symmetric so toggling nets zero
    await addXp(nowDone ? mission.xp : -mission.xp, `Daily mission: ${mission.title}`)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
      <GlassCard className="overflow-hidden !border-amber-400/30 bg-gradient-to-br from-amber-400/15 via-transparent to-orange-500/10">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-3xl shadow-lg">
            🦁
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-amber-500">
              <Sparkles size={12} /> Daily Lion Mission
            </div>
            {mission ? (
              <>
                <div className={cn('truncate text-lg font-extrabold text-slate-900 dark:text-white', mission.done && 'line-through opacity-60')}>
                  {mission.title}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">{mission.detail}</p>
              </>
            ) : busy ? (
              <div className="text-sm text-slate-500">🦁 Leo is crafting today's mission…</div>
            ) : (
              <div className="text-sm text-slate-500">{error || 'No mission yet for today.'}</div>
            )}
          </div>

          {mission ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => generate(true)} disabled={busy} title="Regenerate today's mission"
                className="rounded-2xl bg-slate-500/10 p-2 text-slate-500 transition hover:bg-slate-500/20 disabled:opacity-50">
                <RefreshCw size={15} className={cn(busy && 'animate-spin')} />
              </button>
              <button
                onClick={toggleDone}
                className={cn('flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-bold transition',
                  mission.done ? 'bg-emerald-500 text-white' : 'bg-slate-500/10 text-slate-600 hover:bg-slate-500/20 dark:text-slate-200')}
              >
                {mission.done ? <><Check size={15} /> Done</> : <><Target size={15} /> +{mission.xp} XP</>}
              </button>
            </div>
          ) : (
            <button onClick={() => generate()} disabled={busy}
              className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-amber-400/20 px-3 py-2 text-sm font-bold text-amber-600 hover:bg-amber-400/30 disabled:opacity-50 dark:text-amber-300">
              <RefreshCw size={14} className={cn(busy && 'animate-spin')} /> Generate
            </button>
          )}
        </div>
      </GlassCard>
    </motion.div>
  )
}
