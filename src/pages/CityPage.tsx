import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Flame, Gamepad2, Play, Star, Trophy, X, Zap } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { AiMission, Habit, StudySession, Task } from '../lib/types'
import { GlassCard, Page, SectionTitle } from '../components/ui'
import { cn, levelForXp, levelProgress, levelTitle, todayKey, xpForLevel } from '../lib/utils'
import { CITY_TOTAL_BUILDINGS, cityUnlocked, startCityScene } from '../game/cityScene'
import { startLionRun, type RunResult } from '../game/lionRun'

/** Free run every day, +1 per completed focus session, capped. */
const MAX_RUNS_PER_DAY = 3
/** XP a single run can earn (1 orb = 1 XP), and the daily total from runs. */
const MAX_XP_PER_RUN = 15
const MAX_RUN_XP_PER_DAY = 30

function readNum(key: string) {
  return Number(localStorage.getItem(key)) || 0
}

export function CityPage() {
  const { profile, addXp } = useAuth()
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: habits } = useTable<Habit>('habits')
  const { rows: missions, update: updateMission } = useTable<AiMission>('ai_missions')

  const xp = profile?.xp ?? 0
  const level = levelForXp(xp)
  const streak = profile?.study_streak ?? 0
  const today = todayKey()

  // ---- living skyline: 3D via three.js, 2D canvas as the WebGL fallback ----
  // three.js is heavy, so it loads on demand the first time the city opens;
  // if the chunk or WebGL fails, the 2D skyline takes over seamlessly
  const cityRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = cityRef.current
    if (!el) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sceneOpts = { level, streak, reducedMotion }
    let stop: (() => void) | undefined
    let cancelled = false
    import('../game/city3d')
      .then(({ startCity3D }) => {
        if (cancelled) return
        stop = startCity3D(el, sceneOpts) ?? startCityScene(el, sceneOpts)
      })
      .catch(() => {
        if (!cancelled) stop = startCityScene(el, sceneOpts)
      })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [level, streak])

  const unlockedBlds = cityUnlocked(level)
  const stars = Math.min(5, Math.ceil(level / 2))
  const intoLevel = xp - xpForLevel(level)
  const levelSpan = xpForLevel(level + 1) - xpForLevel(level)
  const segments = Math.round(levelProgress(xp) * 12)

  // ---- today's missions (same math as the Arena challenges) ----
  const mission = missions.find((m) => m.mission_date === today)
  const tasksToday = tasks.filter((t) => t.done && t.created_at.slice(0, 10) === today).length
  const focusToday = sessions.filter((s) => s.started_at.slice(0, 10) === today).reduce((a, s) => a + s.duration_min, 0)
  const habitsToday = habits.filter((h) => h.checks.includes(today)).length
  const sessionsToday = sessions.filter((s) => s.started_at.slice(0, 10) === today).length

  const CHALLENGES = [
    { key: 'T', name: 'Complete 3 tasks', cur: tasksToday, target: 3, xp: 15, to: '/tasks', color: '#00e5c3' },
    { key: 'F', name: 'Focus for 50 minutes', cur: focusToday, target: 50, xp: 20, to: '/focus', color: '#6c8cff' },
    { key: 'H', name: 'Check off 2 habits', cur: habitsToday, target: 2, xp: 10, to: '/', color: '#ff4fa3' },
  ]

  async function toggleMission() {
    if (!mission) return
    const nowDone = !mission.done
    await updateMission({ id: mission.id, done: nowDone } as Partial<AiMission> & { id: string })
    // symmetric with the Dashboard mission card — un-checking takes the XP back
    await addXp(nowDone ? mission.xp : -mission.xp, `Daily mission: ${mission.title}`)
  }

  // ---- Lion Run: plays are earned by focusing ----
  const [runsUsed, setRunsUsed] = useState(() => readNum(`fl-city-runs-${todayKey()}`))
  const [runXpToday, setRunXpToday] = useState(() => readNum(`fl-city-runxp-${todayKey()}`))
  const [best, setBest] = useState(() => readNum('fl-city-best'))
  const runsAllowed = Math.min(MAX_RUNS_PER_DAY, 1 + sessionsToday)
  const tokens = Math.max(0, runsAllowed - runsUsed)

  const [gameOpen, setGameOpen] = useState(false)
  const [runKey, setRunKey] = useState(0)
  const [result, setResult] = useState<(RunResult & { xpEarned: number; newBest: boolean }) | null>(null)
  const gameRef = useRef<HTMLCanvasElement>(null)
  // keep live values readable from the engine callbacks without re-creating the engine
  const live = useRef({ runsUsed, runXpToday, best })
  useEffect(() => {
    live.current = { runsUsed, runXpToday, best }
  })

  useEffect(() => {
    if (!gameOpen || !gameRef.current) return
    const handle = startLionRun(gameRef.current, {
      onStart: () => {
        const used = live.current.runsUsed + 1
        setRunsUsed(used)
        localStorage.setItem(`fl-city-runs-${todayKey()}`, String(used))
      },
      onOver: (r) => {
        const capLeft = Math.max(0, MAX_RUN_XP_PER_DAY - live.current.runXpToday)
        const xpEarned = Math.min(r.coins, MAX_XP_PER_RUN, capLeft)
        if (xpEarned > 0) {
          void addXp(xpEarned, 'Lion Run — City reward')
          const total = live.current.runXpToday + xpEarned
          setRunXpToday(total)
          localStorage.setItem(`fl-city-runxp-${todayKey()}`, String(total))
        }
        const newBest = r.score > live.current.best
        if (newBest) {
          setBest(r.score)
          localStorage.setItem('fl-city-best', String(r.score))
        }
        setResult({ ...r, xpEarned, newBest })
      },
    })
    return handle.destroy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOpen, runKey])

  function openGame() {
    if (tokens <= 0) return
    setResult(null)
    setRunKey((k) => k + 1)
    setGameOpen(true)
  }
  function runAgain() {
    if (tokens <= 0) return
    setResult(null)
    setRunKey((k) => k + 1)
  }

  const nextUnlockLabel = useMemo(() => {
    if (unlockedBlds >= CITY_TOTAL_BUILDINGS) return 'skyline complete 👑'
    return `next building at Lv ${level + 1}`
  }, [unlockedBlds, level])

  return (
    <Page title="Lion City" subtitle="Your discipline, rendered as a 3D city — drag it to look around. 🌆">
      {/* ---- living skyline hero ---- */}
      <div className="relative mb-5 h-[min(58vh,460px)] overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/25 dark:ring-white/10">
        <canvas ref={cityRef} className="absolute inset-0 h-full w-full" />

        {/* rank plate */}
        <div className="absolute left-3 top-3 rounded-2xl bg-black/45 px-3.5 py-2.5 backdrop-blur-md">
          <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/60">Rank</div>
          <div className="city-display text-2xl leading-none text-white">
            LV {level} <span className="text-amber-400">{levelTitle(level).toUpperCase()}</span>
          </div>
          <div className="mt-1 flex gap-0.5">
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} size={13}
                className={i < stars ? 'fill-amber-400 text-amber-400' : 'text-white/25'} />
            ))}
          </div>
        </div>

        {/* money-style counters */}
        <div className="absolute right-3 top-3 rounded-2xl bg-black/45 px-3.5 py-2.5 text-right backdrop-blur-md">
          <div className="font-mono text-lg font-black leading-tight text-emerald-300 drop-shadow-[0_1px_0_rgba(0,0,0,0.8)]">
            XP {xp.toLocaleString()}
          </div>
          <div className="flex items-center justify-end gap-1 font-mono text-xs font-black text-orange-300">
            <Flame size={12} className="fill-orange-400 text-orange-400" /> {streak} DAY{streak === 1 ? '' : 'S'}
          </div>
        </div>

        {/* respect bar + skyline progress */}
        <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/45 px-3.5 py-2.5 backdrop-blur-md">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.2em] text-white/60">
            <span>Respect — {intoLevel}/{levelSpan} XP to Lv {level + 1}</span>
            <span className="hidden sm:inline">Skyline {unlockedBlds}/{CITY_TOTAL_BUILDINGS} · {nextUnlockLabel}</span>
          </div>
          <div className="mt-1.5 flex gap-1">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={cn('h-2 flex-1 rounded-sm', i < segments ? 'bg-amber-400' : 'bg-white/15')} />
            ))}
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white/60 sm:hidden">
            Skyline {unlockedBlds}/{CITY_TOTAL_BUILDINGS} · {nextUnlockLabel}
          </div>
        </div>
      </div>

      {/* ---- Lion Run ---- */}
      <GlassCard className="mb-5 overflow-hidden !border-amber-400/30 bg-gradient-to-br from-amber-400/10 via-transparent to-purple-500/10">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg">
            <Gamepad2 size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="city-display text-xl text-slate-900 dark:text-white">LION RUN</div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Night sprint through your skyline — jump the roadworks, grab XP orbs.
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold">
              <span className="flex items-center gap-1 text-amber-500"><Trophy size={13} /> Best {best.toLocaleString()}</span>
              <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                Runs
                {Array.from({ length: runsAllowed }, (_, i) => (
                  <span key={i} className={cn('h-2.5 w-2.5 rounded-full', i < tokens ? 'bg-emerald-400' : 'bg-slate-400/30')} />
                ))}
              </span>
              <span className="flex items-center gap-1 text-emerald-500"><Zap size={13} /> up to +{MAX_XP_PER_RUN} XP a run</span>
            </div>
          </div>
          {tokens > 0 ? (
            <button onClick={openGame}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 px-5 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-amber-500/30 transition active:scale-95">
              <Play size={16} className="fill-white" /> Play
            </button>
          ) : (
            <Link to="/focus"
              className="flex items-center gap-2 rounded-2xl bg-slate-500/10 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-500/20 dark:text-slate-300">
              Focus to earn a run <ChevronRight size={15} />
            </Link>
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
          1 free run a day · every completed focus session earns another (max {MAX_RUNS_PER_DAY}) · run XP caps at {MAX_RUN_XP_PER_DAY}/day.
        </p>
      </GlassCard>

      {/* ---- city missions ---- */}
      <SectionTitle>City missions</SectionTitle>
      <div className="mb-5 space-y-3">
        {/* story mission — today's AI mission, GTA title-card style */}
        <div className="relative overflow-hidden rounded-3xl bg-[#12101f] p-4 ring-1 ring-amber-400/25">
          <div className="flex items-start gap-3">
            <div className="city-display flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-lg text-amber-950 shadow-[0_0_18px_rgba(255,180,84,0.45)]">
              L
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-amber-400/80">Story mission · Leo</div>
              {mission ? (
                <>
                  <div className={cn('city-display break-words text-lg leading-tight text-amber-300', mission.done && 'opacity-50 line-through')}>
                    {mission.title.toUpperCase()}
                  </div>
                  <p className="mt-0.5 break-words text-sm text-white/60">{mission.detail}</p>
                  <button onClick={toggleMission}
                    className={cn('mt-3 rounded-xl px-3.5 py-2 text-xs font-black uppercase tracking-wide transition active:scale-95',
                      mission.done ? 'bg-emerald-500/90 text-white' : 'bg-amber-400 text-amber-950 hover:bg-amber-300')}>
                    {mission.done ? '✓ Passed' : `Complete · +${mission.xp} XP`}
                  </button>
                </>
              ) : (
                <p className="mt-1 text-sm text-white/60">
                  Leo posts a new story mission every morning.{' '}
                  <Link to="/" className="font-bold text-amber-300 underline-offset-2 hover:underline">Get it on your Dashboard</Link>
                </p>
              )}
            </div>
          </div>
          {mission?.done && (
            <div className="city-display pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-[-12deg] rounded-lg border-2 border-emerald-400/80 px-2 py-0.5 text-sm text-emerald-300/90">
              MISSION PASSED
            </div>
          )}
        </div>

        {/* daily challenges — live progress from real study data */}
        {CHALLENGES.map((ch) => {
          const done = ch.cur >= ch.target
          const pct = Math.min(100, (ch.cur / ch.target) * 100)
          return (
            <Link key={ch.key} to={ch.to}
              className="block overflow-hidden rounded-3xl bg-[#12101f] p-4 ring-1 ring-white/10 transition hover:ring-white/25">
              <div className="flex items-center gap-3">
                <div className="city-display flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
                  style={{ background: done ? '#34d399' : ch.color, color: '#0c0a18', boxShadow: `0 0 16px ${done ? '#34d39955' : `${ch.color}55`}` }}>
                  {done ? '✓' : ch.key}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-sm font-bold', done ? 'text-emerald-300' : 'text-white')}>{ch.name}</span>
                    <span className="shrink-0 font-mono text-xs font-black text-emerald-300">+{ch.xp} XP</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: done ? '#34d399' : ch.color }} />
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-white/45">{Math.min(ch.cur, ch.target)}/{ch.target}{done && ' · passed'}</div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-white/30" />
              </div>
            </Link>
          )
        })}
      </div>

      <p className="text-center text-xs text-slate-400 dark:text-slate-500">
        The skyline is built from your real XP — every level adds a building. Time of day in the city follows your clock. 🌙
      </p>

      {/* ---- Lion Run modal ---- */}
      <AnimatePresence>
        {gameOpen && (
          <motion.div className="fixed inset-0 z-[70] flex flex-col bg-[#06050d]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <div className="city-display text-lg text-white">LION <span className="text-amber-400">RUN</span></div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  {Array.from({ length: runsAllowed }, (_, i) => (
                    <span key={i} className={cn('h-2.5 w-2.5 rounded-full', i < tokens ? 'bg-emerald-400' : 'bg-white/20')} />
                  ))}
                </span>
                <span className="font-mono text-xs font-black text-amber-300">BEST {best.toLocaleString()}</span>
                <button onClick={() => setGameOpen(false)} aria-label="Close game"
                  className="rounded-full p-2 text-white/70 hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="relative mx-3 mb-[calc(0.75rem+env(safe-area-inset-bottom))] flex-1 touch-none overflow-hidden rounded-3xl ring-1 ring-white/15">
              <canvas key={runKey} ref={gameRef} className="h-full w-full" />

              {/* WASTED */}
              <AnimatePresence>
                {result && (
                  <motion.div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-[2px]"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="wasted-in city-display text-5xl tracking-[0.22em] text-red-500 [text-shadow:0_0_28px_rgba(220,30,40,0.65),0_3px_0_rgba(0,0,0,0.8)]">
                      WASTED
                    </div>
                    {result.newBest && (
                      <div className="city-display mt-2 text-base tracking-widest text-amber-400">★ NEW RECORD ★</div>
                    )}
                    <div className="mt-5 flex gap-6 text-center font-mono">
                      <div>
                        <div className="text-xl font-black text-white">{result.score.toLocaleString()}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Score</div>
                      </div>
                      <div>
                        <div className="text-xl font-black text-amber-300">{result.coins}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Orbs</div>
                      </div>
                      <div>
                        <div className="text-xl font-black text-emerald-300">+{result.xpEarned}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">XP</div>
                      </div>
                    </div>
                    {result.xpEarned === 0 && result.coins > 0 && (
                      <div className="mt-2 text-xs text-white/50">Daily run-XP cap reached — orbs are just for glory now.</div>
                    )}
                    <div className="mt-6 flex gap-3">
                      {tokens > 0 && (
                        <button onClick={runAgain}
                          className="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-lg active:scale-95">
                          Run again
                        </button>
                      )}
                      <button onClick={() => setGameOpen(false)}
                        className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/20">
                        Back to city
                      </button>
                    </div>
                    {tokens === 0 && (
                      <div className="mt-3 text-xs text-white/50">Out of runs — complete a focus session to earn another.</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  )
}
