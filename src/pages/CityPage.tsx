import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, ChevronRight, Flame, Gamepad2, Play, Star, Trophy, X, Zap } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { AiMission, Habit, StudySession, Task } from '../lib/types'
import { GlassCard, Page, SectionTitle } from '../components/ui'
import { cn, levelForXp, levelProgress, levelTitle, todayKey, xpForLevel } from '../lib/utils'
import { CITY_TOTAL_BUILDINGS, DISTRICTS, cityUnlocked, districtsUnlocked, nextDistrict, startCityScene } from '../game/cityScene'
import { startLionRun, type RunResult } from '../game/lionRun'
import { PLAYABLE_CHARACTERS, DEFAULT_CHARACTER, characterById, isCharacterUnlocked } from '../lib/characters'
import { UPGRADES, getCoins, addCoins, getUpgrades, getDailyMissions, tallyMissions, buyUpgrade, nextCost, type Mission } from '../lib/lionShop'
import { sfx } from '../game/sfx'
import { hap } from '../lib/haptics'

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
  const captureRef = useRef<(() => string | null) | null>(null)
  const citySetAvatar = useRef<((id: string) => void) | null>(null)
  const [cityPickerOpen, setCityPickerOpen] = useState(false)
  useEffect(() => {
    const el = cityRef.current
    if (!el) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // the city avatar (monument) starts as the persisted runner; live changes go
    // through setAvatar (below) so we never rebuild the whole city
    const sceneOpts = { level, streak, reducedMotion, character: localStorage.getItem('fl-character') || DEFAULT_CHARACTER }
    let stop: (() => void) | undefined
    let cancelled = false
    const fallback2d = () => {
      stop = startCityScene(el, sceneOpts)
      captureRef.current = () => el.toDataURL('image/png')
    }
    import('../game/city3d')
      .then(({ startCity3D }) => {
        if (cancelled) return
        const h = startCity3D(el, sceneOpts)
        if (h) {
          stop = h.stop
          captureRef.current = h.capture
          citySetAvatar.current = h.setAvatar
        } else fallback2d()
      })
      .catch(() => {
        if (!cancelled) fallback2d()
      })
    return () => {
      cancelled = true
      captureRef.current = null
      citySetAvatar.current = null
      stop?.()
    }
  }, [level, streak])

  // Photo Mode — share the current city view, or download it if sharing isn't available
  async function photoMode() {
    const url = captureRef.current?.()
    if (!url) return
    try {
      const blob = await (await fetch(url)).blob()
      const file = new File([blob], 'lion-city.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Lion City' })
        return
      }
    } catch {
      // sharing declined or unsupported — fall through to download
    }
    const a = document.createElement('a')
    a.href = url
    a.download = 'lion-city.png'
    a.click()
  }

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
    if (nowDone) { sfx.resume(); sfx.achievement(); hap.reward() }
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
  const [result, setResult] = useState<(RunResult & { xpEarned: number; newBest: boolean; freeRun: boolean; stage?: number; missionsDone?: Mission[]; missionCoins?: number }) | null>(null)
  const [runStarted, setRunStarted] = useState(false)
  const [runLive, setRunLive] = useState<{ score: number; coins: number } | null>(null)
  // ---- coin bank + upgrade shop + daily missions (meta-progression) ----
  const [coins, setCoins] = useState(() => getCoins())
  const [upgrades, setUpgrades] = useState(() => getUpgrades())
  const [dailyMissions, setDailyMissions] = useState(() => getDailyMissions())
  const [shopOpen, setShopOpen] = useState(false)
  const runStats = useRef({ combo: 0 }) // max combo this run (for mission tally)
  function buy(key: (typeof UPGRADES)[number]['key']) {
    if (!buyUpgrade(key)) return
    sfx.powerup()
    hap.reward()
    setUpgrades(getUpgrades())
    setCoins(getCoins())
  }
  const [stageFlash, setStageFlash] = useState<{ n: number; name: string } | null>(null)
  const gameRef = useRef<HTMLCanvasElement>(null)
  // whether the current run consumes a reward token (XP) or is a free replay
  const eligibleRef = useRef(false)
  // ---- chosen runner (lion/lioness/wolf/fox/…), unlocked by level ----
  const [character, setCharacter] = useState<string>(() => localStorage.getItem('fl-character') || DEFAULT_CHARACTER)
  // three.js lives only in the lazy game chunk — warm the model without a static import
  function preloadChar(id: string) {
    const def = characterById(id)
    if (def.url) import('../game/characterModel').then((m) => m.preloadCharacterModel(def.url)).catch(() => {})
  }
  function selectCharacter(id: string) {
    if (!isCharacterUnlocked(characterById(id), level)) return
    sfx.resume()
    sfx.uiClick()
    hap.tap()
    setCharacter(id)
    localStorage.setItem('fl-character', id)
    preloadChar(id)
    if (gameOpen && !runStarted) setRunKey((k) => k + 1) // rebuild the runner live
  }
  // change the city monument live when the chosen character changes (no rebuild)
  useEffect(() => {
    citySetAvatar.current?.(character)
  }, [character])
  useEffect(() => {
    if (!stageFlash) return
    const t = setTimeout(() => setStageFlash(null), 1700)
    return () => clearTimeout(t)
  }, [stageFlash])
  // keep live values readable from the engine callbacks without re-creating the engine
  const live = useRef({ runsUsed, runXpToday, best })
  useEffect(() => {
    live.current = { runsUsed, runXpToday, best }
  })

  useEffect(() => {
    if (!gameOpen || !gameRef.current) return
    const el = gameRef.current
    const callbacks = {
      onStart: () => {
        setRunStarted(true)
        runStats.current.combo = 0
        // reward runs consume a token and can earn XP; once tokens are gone
        // every further run is a free replay (score and glory only)
        const eligible = live.current.runsUsed < runsAllowed
        eligibleRef.current = eligible
        if (eligible) {
          const used = live.current.runsUsed + 1
          setRunsUsed(used)
          localStorage.setItem(`fl-city-runs-${todayKey()}`, String(used))
        }
      },
      onOver: (r: RunResult & { stage?: number }) => {
        const freeRun = !eligibleRef.current
        const capLeft = Math.max(0, MAX_RUN_XP_PER_DAY - live.current.runXpToday)
        const xpEarned = freeRun ? 0 : Math.min(r.coins, MAX_XP_PER_RUN, capLeft)
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
        // bank the run's orbs, then tally any daily missions the run completed
        addCoins(r.coins)
        const { completed, coins: missionCoins } = tallyMissions({
          coins: r.coins, dist: Math.round(r.distanceM), stage: r.stage || 1, combo: runStats.current.combo,
        })
        setCoins(getCoins())
        setDailyMissions(getDailyMissions())
        // celebration cue, loudest event first: record → mission clears → XP banked
        if (newBest) { sfx.achievement(); hap.levelUp() }
        else if (completed.length) { sfx.chest(); hap.treasure() }
        else if (xpEarned > 0) { sfx.xp(); hap.reward() }
        setResult({ ...r, xpEarned, newBest, freeRun, missionsDone: completed, missionCoins })
      },
      onScore: (score: number, coins: number) => setRunLive({ score, coins }),
      onStage: (n: number, name: string) => setStageFlash({ n, name }),
      onHud: (h: { combo: number }) => { if (h.combo > runStats.current.combo) runStats.current.combo = h.combo },
    }
    // the runner is 3D (three.js, lazy chunk); the 2D engine covers no-WebGL devices
    let destroy: (() => void) | undefined
    let cancelled = false
    import('../game/lionRun3d')
      .then(({ startLionRun3D }) => {
        if (cancelled) return
        const effChar = isCharacterUnlocked(characterById(character), level) ? character : DEFAULT_CHARACTER
        const h = startLionRun3D(el, callbacks, { character: effChar, upgrades: getUpgrades() })
        destroy = h ? h.destroy : startLionRun(el, callbacks).destroy
      })
      .catch(() => {
        if (!cancelled) destroy = startLionRun(el, callbacks).destroy
      })
    return () => {
      cancelled = true
      destroy?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOpen, runKey])

  // replays are unlimited — tokens only decide whether a run can earn XP
  function openGame() {
    sfx.resume() // unlock Web Audio inside the tap gesture that opens the game
    sfx.uiClick()
    hap.select()
    setResult(null)
    setRunStarted(false)
    setRunLive(null)
    setStageFlash(null)
    preloadChar(character)
    setRunKey((k) => k + 1)
    setGameOpen(true)
  }
  function runAgain() {
    sfx.uiClick()
    hap.select()
    setResult(null)
    setRunStarted(false)
    setRunLive(null)
    setStageFlash(null)
    setRunKey((k) => k + 1)
  }

  const nextUnlockLabel = useMemo(() => {
    if (unlockedBlds >= CITY_TOTAL_BUILDINGS) return 'skyline complete 👑'
    return `next building at Lv ${level + 1}`
  }, [unlockedBlds, level])
  const districts = districtsUnlocked(level)
  const upcoming = nextDistrict(level)

  return (
    <Page title="Lion City" subtitle="Your discipline, rendered as a 3D city — drag it to look around. 🌆">
      {/* ---- living skyline hero ---- */}
      <div className="relative mb-5 h-[min(58vh,460px)] overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/25 dark:ring-white/10">
        <canvas ref={cityRef} className="absolute inset-0 h-full w-full" />

        {/* rank plate */}
        {/* rank stacks vertically so long titles (STRATEGIST…) never collide
            with the XP plate on narrow phones */}
        <div className="absolute left-3 top-3 max-w-[52%] rounded-2xl bg-black/45 px-3.5 py-2.5 backdrop-blur-md">
          <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/60">Rank</div>
          <div className="city-display text-2xl leading-none text-white">LV {level}</div>
          <div className="city-display truncate text-sm leading-tight text-amber-400">{levelTitle(level).toUpperCase()}</div>
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

        {/* photo mode */}
        <button
          onClick={photoMode}
          aria-label="Photo mode — share your city"
          className="absolute bottom-[104px] right-3 rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur-md transition hover:bg-black/65 active:scale-90"
        >
          <Camera size={17} />
        </button>

        {/* city avatar picker — choose who stands as the monument */}
        <button
          onClick={() => setCityPickerOpen((o) => !o)}
          aria-label="Choose your city avatar"
          className="absolute bottom-[104px] left-3 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-2 text-sm text-white/90 backdrop-blur-md transition hover:bg-black/65 active:scale-90"
        >
          <span className="text-lg leading-none">{characterById(character).emoji}</span>
          <span className="text-[11px] font-bold">Avatar</span>
        </button>
        {cityPickerOpen && (
          <div className="absolute inset-x-3 bottom-[152px] rounded-2xl bg-black/70 p-2 backdrop-blur-md">
            <div className="mb-1 px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Your citizen — stands as the monument</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
              {PLAYABLE_CHARACTERS.map((c) => {
                const unlocked = isCharacterUnlocked(c, level)
                const selected = c.id === character
                return (
                  <button key={c.id} type="button" disabled={!unlocked}
                    onClick={() => { selectCharacter(c.id); setCityPickerOpen(false) }}
                    className={cn('flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 ring-1 transition active:scale-95',
                      selected ? 'bg-amber-400/25 ring-amber-400' : 'bg-white/5 ring-white/10', !unlocked && 'opacity-40')}>
                    <span className="text-xl leading-none">{c.emoji}</span>
                    <span className="whitespace-nowrap text-[9px] font-bold text-white/85">{unlocked ? c.name.split(' ')[0] : `Lv ${c.unlockLevel}`}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* respect bar + skyline / district progress */}
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
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-amber-300/80">
            Districts {districts}/{DISTRICTS.length}{upcoming && <> · {upcoming.name} opens at Lv {upcoming.level}</>}
          </div>
        </div>
      </div>

      {/* ---- Lion Run ---- */}
      <GlassCard className="mb-5 overflow-hidden !border-amber-400/30 bg-gradient-to-br from-amber-400/10 via-transparent to-purple-500/10">
        <div className="flex flex-wrap items-center gap-4">
          {/* icon + copy travel together; the Play button wraps to its own
              row on narrow phones instead of crushing the text column */}
          <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg">
              <Gamepad2 size={26} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="city-display text-xl text-slate-900 dark:text-white">LION RUN</div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                3D night sprint through a neon canyon — swipe between lanes, jump the barriers, grab XP orbs.
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
                <span className="flex items-center gap-1 text-slate-500 dark:text-slate-300">{characterById(character).emoji} {characterById(character).name}</span>
              </div>
            </div>
          </div>
          <button onClick={openGame}
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 px-5 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-amber-500/30 transition active:scale-95">
            <Play size={16} className="fill-white" /> {tokens > 0 ? 'Play' : 'Free run'}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
          Play as much as you like — free runs are for score and glory. XP runs: 1 free daily + 1 per
          completed focus session (max {MAX_RUNS_PER_DAY}), capped at {MAX_RUN_XP_PER_DAY} XP/day.
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
            <div className="city-display pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rotate-[-12deg] rounded-lg border-2 border-emerald-400/80 px-2 py-0.5 text-sm text-emerald-300/90 sm:block">
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
        The city is built from your real XP — every level adds a building, and whole districts open at milestones.
        Time of day and even the weather follow your world. 🌙
      </p>

      {/* ---- Lion Run modal ---- */}
      <AnimatePresence>
        {gameOpen && (
          <motion.div className="fixed inset-0 z-[70] flex flex-col bg-[#06050d]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
              <div className="city-display text-lg text-white">LION <span className="text-amber-400">RUN</span></div>
              <div className="flex items-center gap-3">
                {tokens > 0 ? (
                  <span className="flex items-center gap-1">
                    {Array.from({ length: runsAllowed }, (_, i) => (
                      <span key={i} className={cn('h-2.5 w-2.5 rounded-full', i < tokens ? 'bg-emerald-400' : 'bg-white/20')} />
                    ))}
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-400/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
                    Free run
                  </span>
                )}
                <span className="font-mono text-xs font-black text-amber-300">BEST {best.toLocaleString()}</span>
                <button onClick={() => setGameOpen(false)} aria-label="Close game"
                  className="rounded-full p-2 text-white/70 hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="relative mx-3 mb-[calc(0.75rem+env(safe-area-inset-bottom))] flex-1 touch-none overflow-hidden rounded-3xl ring-1 ring-white/15">
              <canvas key={runKey} ref={gameRef} className="h-full w-full" />

              {/* live score (3D runner reports through onScore) */}
              {runLive && !result && (
                <div className="pointer-events-none absolute right-3 top-3 text-right font-mono">
                  <div className="text-xl font-black text-emerald-300 drop-shadow-[0_1px_0_rgba(0,0,0,0.9)]">
                    {String(runLive.score).padStart(6, '0')}
                  </div>
                  <div className="text-xs font-black text-amber-300">● {runLive.coins}</div>
                </div>
              )}

              {/* stage banner — flashes when the world shifts */}
              <AnimatePresence>
                {stageFlash && !result && (
                  <motion.div
                    key={stageFlash.n}
                    initial={{ opacity: 0, scale: 1.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 260 }}
                    className="pointer-events-none absolute inset-x-0 top-14 flex flex-col items-center"
                  >
                    <div className="city-display text-3xl text-amber-300 [text-shadow:0_0_22px_rgba(255,180,84,0.85),0_2px_0_rgba(0,0,0,0.8)]">
                      STAGE {stageFlash.n}
                    </div>
                    <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.35em] text-white/75">
                      {stageFlash.name}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* coins + daily missions + upgrades (pre-run) */}
              {!runStarted && !result && (
                <div className="pointer-events-none absolute inset-x-0 top-0 px-3 pt-[calc(0.4rem+env(safe-area-inset-top))]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="pointer-events-auto rounded-full bg-black/55 px-3 py-1 text-xs font-black text-amber-300 ring-1 ring-white/10">🪙 {coins.toLocaleString()}</span>
                    <button onClick={() => setShopOpen(true)}
                      className="pointer-events-auto rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white ring-1 ring-white/10 active:scale-95">⚙️ Upgrades</button>
                  </div>
                  <div className="mt-1.5 flex flex-col items-start gap-1">
                    {dailyMissions.map((m) => (
                      <div key={m.id} className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1',
                        m.done ? 'bg-emerald-500/25 text-emerald-200 ring-emerald-400/40' : 'bg-black/45 text-white/85 ring-white/10')}>
                        <span>{m.done ? '✅' : m.emoji}</span>
                        <span className={m.done ? 'line-through opacity-70' : ''}>{m.label}</span>
                        <span className="text-amber-300">🪙{m.reward}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* start hint */}
              {!runStarted && !result && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/25 px-6 text-center">
                  <div className="city-display text-3xl text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">TAP TO RUN</div>
                  <div className="mt-2 text-xs font-semibold text-white/70">
                    swipe ← → to change lane · tap to jump · tap again = double jump
                  </div>
                </div>
              )}

              {/* upgrade shop */}
              <AnimatePresence>
                {shopOpen && (
                  <motion.div className="absolute inset-0 z-10 flex flex-col bg-black/85 p-4 backdrop-blur-sm"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="flex items-center justify-between">
                      <div className="city-display text-xl tracking-widest text-white">UPGRADES</div>
                      <button onClick={() => setShopOpen(false)} className="rounded-full bg-white/10 p-2 text-white active:scale-95"><X className="h-5 w-5" /></button>
                    </div>
                    <div className="mt-1 text-sm font-black text-amber-300">🪙 {coins.toLocaleString()} coins</div>
                    <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
                      {UPGRADES.map((u) => {
                        const lvl = upgrades[u.key]
                        const cost = nextCost(u.key)
                        const maxed = cost == null
                        const afford = cost != null && coins >= cost
                        return (
                          <div key={u.key} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                            <span className="text-2xl leading-none">{u.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-white">{u.name} <span className="text-white/45">Lv {lvl}/{u.max}</span></div>
                              <div className="truncate text-[11px] text-white/60">{u.desc}</div>
                              <div className="mt-1 flex gap-1">
                                {Array.from({ length: u.max }).map((_, i) => (
                                  <span key={i} className={cn('h-1.5 w-6 rounded-full', i < lvl ? 'bg-amber-400' : 'bg-white/15')} />
                                ))}
                              </div>
                            </div>
                            <button disabled={maxed || !afford} onClick={() => buy(u.key)}
                              className={cn('shrink-0 rounded-xl px-3 py-2 text-xs font-black active:scale-95',
                                maxed ? 'bg-emerald-500/20 text-emerald-300' : afford ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white' : 'bg-white/10 text-white/40')}>
                              {maxed ? 'MAX' : `🪙 ${cost}`}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-3 text-center text-[10px] text-white/45">Coins are earned from orbs + missions — never from XP.</div>
                    <button onClick={() => setShopOpen(false)} className="mt-2 rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white active:scale-95">Done</button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* character select — pick your runner before tapping to run */}
              {!runStarted && !result && (
                <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-6">
                  <div className="mb-1.5 text-center text-[10px] font-black uppercase tracking-[0.3em] text-white/60">Choose your runner</div>
                  <div className="flex justify-start gap-2 overflow-x-auto pb-1 sm:justify-center [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                    {PLAYABLE_CHARACTERS.map((c) => {
                      const unlocked = isCharacterUnlocked(c, level)
                      const selected = c.id === character
                      return (
                        <button key={c.id} type="button" disabled={!unlocked}
                          onClick={() => selectCharacter(c.id)}
                          className={cn('relative flex shrink-0 flex-col items-center gap-0.5 rounded-2xl px-3 py-2 ring-1 transition active:scale-95',
                            selected ? 'bg-amber-400/25 ring-amber-400' : 'bg-white/5 ring-white/10 hover:bg-white/10',
                            !unlocked && 'opacity-45')}>
                          <span className="text-2xl leading-none">{c.emoji}</span>
                          <span className="whitespace-nowrap text-[10px] font-bold text-white/85">{c.name}</span>
                          {unlocked
                            ? selected && <span className="text-[8px] font-black uppercase tracking-wider text-amber-300">● running</span>
                            : <span className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wider text-amber-300/90">🔒 Lv {c.unlockLevel}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

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
                    <div className="mt-5 flex gap-5 text-center font-mono">
                      <div>
                        <div className="text-xl font-black text-white">{result.score.toLocaleString()}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Score</div>
                      </div>
                      {result.stage != null && (
                        <div>
                          <div className="text-xl font-black text-purple-300">{result.stage}</div>
                          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Stage</div>
                        </div>
                      )}
                      <div>
                        <div className="text-xl font-black text-amber-300">{result.coins}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Orbs</div>
                      </div>
                      <div>
                        <div className="text-xl font-black text-emerald-300">{result.freeRun ? '—' : `+${result.xpEarned}`}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">XP</div>
                      </div>
                    </div>
                    {result.freeRun ? (
                      <div className="mt-2 px-6 text-center text-xs text-white/50">Free run — complete a focus session to earn XP runs.</div>
                    ) : result.xpEarned === 0 && result.coins > 0 ? (
                      <div className="mt-2 px-6 text-center text-xs text-white/50">Daily run-XP cap reached — orbs are just for glory now.</div>
                    ) : null}
                    {/* mission completions + coin bank */}
                    {result.missionsDone && result.missionsDone.length > 0 && (
                      <div className="mt-3 flex flex-col items-center gap-1">
                        {result.missionsDone.map((m) => (
                          <div key={m.id} className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-200 ring-1 ring-emerald-400/40">
                            ✅ {m.label} · +🪙{m.reward}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-xs font-black text-amber-300">🪙 {coins.toLocaleString()} coins{result.missionCoins ? ` (+${result.missionCoins + result.coins})` : result.coins ? ` (+${result.coins})` : ''}</div>
                    <div className="mt-4 flex gap-3">
                      <button onClick={runAgain}
                        className="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-lg active:scale-95">
                        Run again
                      </button>
                      <button onClick={() => setGameOpen(false)}
                        className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/20">
                        Back to city
                      </button>
                    </div>
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
