import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, RotateCcw, Maximize2, X } from 'lucide-react'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import type { StudySession } from '../lib/types'
import { Button, GlassCard, Input, Page, ProgressRing, SectionTitle } from '../components/ui'
import { cn, minutesToLabel, todayKey } from '../lib/utils'

const PRESETS = [
  { label: 'Pomodoro', min: 25, mode: 'pomodoro' as const },
  { label: 'Short focus', min: 15, mode: 'pomodoro' as const },
  { label: 'Deep focus', min: 50, mode: 'focus' as const },
  { label: 'Marathon', min: 90, mode: 'focus' as const },
]

function chime() {
  try {
    const ctx = new AudioContext()
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.4, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4)
    g.connect(ctx.destination)
    for (const [f, d] of [[660, 0], [880, 0.18], [990, 0.36]]) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      o.connect(g)
      o.start(ctx.currentTime + d)
      o.stop(ctx.currentTime + d + 1)
    }
    setTimeout(() => ctx.close(), 2000)
  } catch { /* silent */ }
}

export function FocusPage() {
  const { rows: sessions, insert } = useTable<StudySession>('study_sessions', { orderBy: 'started_at' })
  const { addXp, touchStudyStreak } = useAuth()

  const [preset, setPreset] = useState(PRESETS[0])
  const [secondsLeft, setSecondsLeft] = useState(PRESETS[0].min * 60)
  const [running, setRunning] = useState(false)
  const [subject, setSubject] = useState('')
  const [deepMode, setDeepMode] = useState(false)
  const startedAt = useRef<Date | null>(null)

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [running])

  useEffect(() => {
    if (secondsLeft === 0 && running) {
      setRunning(false)
      finish()
    }
  }, [secondsLeft, running])

  async function finish() {
    chime()
    const xp = preset.mode === 'focus' ? 40 : 20
    await insert({
      started_at: (startedAt.current ?? new Date()).toISOString(),
      duration_min: preset.min,
      subject: subject.trim(),
      mode: preset.mode,
    } as Partial<StudySession>)
    await addXp(xp, `${preset.label} session complete`)
    await touchStudyStreak()
    if (Notification.permission === 'granted') {
      new Notification('🦁 Session complete!', { body: `+${xp} XP earned. Take a 5-minute break.` })
    }
    setDeepMode(false)
    setSecondsLeft(preset.min * 60)
  }

  function start() {
    if (!running) {
      startedAt.current = startedAt.current ?? new Date()
      setRunning(true)
      if (preset.mode === 'focus') setDeepMode(true)
    } else {
      setRunning(false)
    }
  }

  function reset() {
    setRunning(false)
    setDeepMode(false)
    startedAt.current = null
    setSecondsLeft(preset.min * 60)
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')
  const progress = 1 - secondsLeft / (preset.min * 60)

  const today = todayKey()
  const todayMin = sessions.filter((s) => s.started_at.slice(0, 10) === today).reduce((a, s) => a + s.duration_min, 0)
  const recent = sessions.slice(0, 6)

  const timer = (
    <div className="flex flex-col items-center">
      <div className="relative">
        <ProgressRing size={deepMode ? 280 : 220} stroke={deepMode ? 16 : 13} progress={progress}
          color={preset.mode === 'focus' ? '#A76CFF' : '#4f6bfa'} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className={cn('font-extrabold tabular-nums text-slate-900 dark:text-white', deepMode ? 'text-6xl' : 'text-5xl')}>
            {mm}:{ss}
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{preset.label}</div>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button size="lg" onClick={start} className={cn(preset.mode === 'focus' && '!from-purple-500 !to-purple-400 !shadow-purple-500/30')}>
          {running ? <><Pause size={18} /> Pause</> : <><Play size={18} /> {secondsLeft < preset.min * 60 ? 'Resume' : 'Start'}</>}
        </Button>
        <Button variant="ghost" size="lg" onClick={reset}><RotateCcw size={18} /> Reset</Button>
      </div>
    </div>
  )

  if (deepMode) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-gradient-to-b from-[#0b0d14] via-[#141228] to-[#0b0d14]"
      >
        <button onClick={() => setDeepMode(false)} className="absolute right-6 top-6 rounded-full p-2 text-slate-400 hover:bg-white/10">
          <X size={22} />
        </button>
        <div className="mb-8 text-center">
          <div className="text-4xl">🦁</div>
          <h2 className="mt-2 text-xl font-bold text-white">Deep Focus Mode</h2>
          <p className="text-sm text-slate-400">{subject ? `Studying: ${subject}` : 'The lion guards your focus. Stay here.'}</p>
        </div>
        <div className="dark">{timer}</div>
      </motion.div>
    )
  }

  return (
    <Page title="Focus" subtitle={`${minutesToLabel(todayMin)} focused today. Every minute counts.`}>
      <div className="grid gap-5 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2 flex flex-col items-center py-10">
          <div className="mb-6 flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <button key={p.label}
                onClick={() => { setPreset(p); setRunning(false); setSecondsLeft(p.min * 60); startedAt.current = null }}
                className={cn(
                  'rounded-2xl px-4 py-2 text-sm font-bold transition',
                  preset.label === p.label
                    ? p.mode === 'focus' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' : 'bg-brand-500 text-white shadow-lg shadow-brand-500/30'
                    : 'bg-slate-500/10 text-slate-500 dark:text-slate-300',
                )}
              >
                {p.label} · {p.min}m
              </button>
            ))}
          </div>
          <Input
            placeholder="What are you studying? (optional)"
            value={subject} onChange={(e) => setSubject(e.target.value)}
            className="mb-8 max-w-xs text-center"
          />
          {timer}
          {preset.mode === 'focus' && !running && (
            <button onClick={() => setDeepMode(true)} className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-purple-500 hover:underline">
              <Maximize2 size={13} /> Enter full-screen deep mode
            </button>
          )}
        </GlassCard>

        <GlassCard>
          <SectionTitle>Recent sessions</SectionTitle>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No sessions yet.<br />Your study history will appear here.</p>
          ) : (
            <div className="space-y-2">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                  <span className="text-lg">{s.mode === 'focus' ? '🟣' : '🔵'}</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{s.subject || (s.mode === 'focus' ? 'Deep focus' : 'Pomodoro')}</div>
                    <div className="text-xs text-slate-500">{new Date(s.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
                  </div>
                  <span className="text-sm font-bold text-brand-500">{s.duration_min}m</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </Page>
  )
}
