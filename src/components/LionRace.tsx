/**
 * Lion Race — a live head-to-head Lion Run against a friend.
 *
 * Both players run the SAME seeded track (identical climate + hazards at every
 * metre) so it's a fair race. Each device runs its own 3D runner; the top HUD
 * shows both players' faces, names and live distance, and three power-up
 * ATTACK buttons let you sabotage your friend — a rocket drops a wall in their
 * lane, a bolt stuns them, a wall blocks two lanes. Furthest lion wins (which,
 * in an endless runner, is whoever survives longest — last lion standing).
 *
 * Networking is transport-agnostic: the parent passes `send` (broadcast one
 * event) and `register` (receive the opponent's events) — ChatPage wires those
 * to the existing dm-<pairKey> realtime channel, exactly like Watch Together.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
// type-only import so three.js stays in the lazy chunk (a runtime import would
// pull the whole 3D engine into the main bundle); the engine is dynamically
// imported when a race actually starts, mirroring CityPage.
import type { Run3DHandle, AttackKind, HudState } from '../game/lionRun3d'
import { LION_SKINS } from '../lib/lionSkins'
import { CHARACTERS, DEFAULT_CHARACTER, characterById } from '../lib/characters'

const EMOTES = ['😜', '😂', '🔥', '💪', '😎', '👋', '😱', '🦁']

// deterministic confetti pieces (no Math.random during render)
const CONFETTI = Array.from({ length: 24 }, (_, i) => ({
  left: (i * 41) % 100,
  delay: (i % 8) * 0.14,
  dur: 1.7 + (i % 5) * 0.35,
  color: ['#ff5f9e', '#ffd23f', '#41d4ff', '#7c5cff', '#33d9b2', '#ff6f61'][i % 6],
  size: 6 + (i % 4) * 3,
}))

export type RacePayload =
  | { a: 'state'; from: string; dist: number; lane: number; alive: boolean; female?: boolean; skin?: string; character?: string }
  | { a: 'attack'; from: string; kind: AttackKind }
  | { a: 'dead'; from: string; dist: number }
  | { a: 'rematch'; from: string; seed: number }
  | { a: 'emote'; from: string; e: string }

// Omit distributes over each union member (plain Omit<Union,K> would collapse
// to just the shared keys), so the outbound (no `from`) payload keeps its shape
export type RaceOutbound = RacePayload extends infer T ? (T extends RacePayload ? Omit<T, 'from'> : never) : never

type Face = { name: string; avatarUrl?: string; id: string }

// each weapon has a RANGE (max metres between the two lions to fire it) — a
// rocket reaches far, a twister needs you almost neck-and-neck. The button only
// arms when the rival is inside that range AND you have the coins.
const ATTACKS: { kind: AttackKind; icon: string; label: string; cost: number; range: number; color: string }[] = [
  { kind: 'rocket', icon: '🚀', label: 'Rocket', cost: 5, range: 70, color: 'from-rose-500 to-orange-500' },
  { kind: 'bolt', icon: '⚡', label: 'Thunder', cost: 4, range: 30, color: 'from-amber-400 to-yellow-400' },
  { kind: 'fire', icon: '🔥', label: 'Fire', cost: 5, range: 15, color: 'from-orange-500 to-red-600' },
  { kind: 'freeze', icon: '❄️', label: 'Freeze', cost: 6, range: 8, color: 'from-cyan-400 to-sky-500' },
  { kind: 'tornado', icon: '🌪️', label: 'Twister', cost: 8, range: 3, color: 'from-slate-400 to-slate-600' },
]

function Face({ face, dist, alive, mine }: { face: Face; dist: number; alive: boolean; mine?: boolean }) {
  const initial = (face.name || '?').slice(0, 1).toUpperCase()
  return (
    <div className={`flex min-w-0 items-center gap-2 ${mine ? '' : 'flex-row-reverse text-right'}`}>
      <div className="relative shrink-0">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white ring-2 ring-white/70">
          {face.avatarUrl ? <img src={face.avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
        </div>
        <span className="absolute -bottom-1 -right-1 text-[13px] leading-none">{alive ? '🦁' : '💀'}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-bold text-white">{mine ? 'You' : face.name.split(' ')[0]}</div>
        <div className="text-[13px] font-black tabular-nums text-amber-300">{Math.round(dist)}m</div>
      </div>
    </div>
  )
}

export function LionRace({
  me, opp, seed, send, register, onClose,
}: {
  me: Face
  opp: Face
  seed: number
  send: (p: RaceOutbound) => void
  register: (fn: (p: RacePayload) => void) => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [curSeed, setCurSeed] = useState(seed)
  const [phase, setPhase] = useState<'countdown' | 'racing' | 'over'>('countdown')
  const [count, setCount] = useState(3)
  const [myDist, setMyDist] = useState(0)
  const [oppDist, setOppDist] = useState(0)
  const [myAlive, setMyAlive] = useState(true)
  const [oppAlive, setOppAlive] = useState(true)
  const [myCoins, setMyCoins] = useState(0)
  const [spent, setSpent] = useState(0)
  const [winner, setWinner] = useState<'me' | 'opp' | 'tie' | null>(null)
  const [flash, setFlash] = useState<AttackKind | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false) // engine (lazy chunk) has booted
  const [stageName, setStageName] = useState('MIDNIGHT')
  const [hud, setHud] = useState<HudState | null>(null) // power-ups / combo / shield
  const [freeWeapon, setFreeWeapon] = useState<AttackKind | null>(null) // from an item box
  const [emotePop, setEmotePop] = useState<{ e: string; mine: boolean } | null>(null)
  const [emoteOpen, setEmoteOpen] = useState(false)
  // chosen runner (lion/lioness/wolf/fox/…) — persisted, shared with /city
  const [myChar, setMyChar] = useState(() => {
    try { return localStorage.getItem('fl-character') || DEFAULT_CHARACTER } catch { return DEFAULT_CHARACTER }
  })
  const charRef = useRef(myChar)
  charRef.current = myChar
  // gender is now implied by the chosen runner (lion vs lioness)
  const [myFemale, setMyFemale] = useState(() => characterById(myChar).female === true)
  const femaleRef = useRef(myFemale)
  femaleRef.current = myFemale
  // cosmetic lion skin (persisted) — recolor + signature glow trail
  const [mySkin, setMySkin] = useState(() => {
    try { return localStorage.getItem('fl-lion-skin') || 'classic' } catch { return 'classic' }
  })
  const skinRef = useRef(mySkin)
  skinRef.current = mySkin

  const handleRef = useRef<Run3DHandle | null>(null)
  const lastSent = useRef(0)
  const myDeadRef = useRef(false)
  const oppDeadRef = useRef(false)
  const myFinal = useRef(0)
  const oppFinal = useRef(0)
  const oppDistRef = useRef(0)
  const myDistRef = useRef(0)
  const oppSeen = useRef(false)
  const resolvedRef = useRef(false)
  const sendRef = useRef(send)
  sendRef.current = send

  // the FIRST crash ends the race for both — the survivor wins (last lion
  // standing); if both crash together, the greater distance wins.
  function resolve() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    if (!myDeadRef.current) myFinal.current = Math.round(myDistRef.current)
    const mine = myFinal.current
    const theirs = oppDeadRef.current ? oppFinal.current : oppDistRef.current
    let w: 'me' | 'opp' | 'tie'
    if (!oppSeen.current) w = 'me' // solo / opponent never joined
    else if (myDeadRef.current && !oppDeadRef.current) w = 'opp' // I crashed first
    else if (oppDeadRef.current && !myDeadRef.current) w = 'me' // they crashed first
    else w = mine > theirs ? 'me' : mine < theirs ? 'opp' : 'tie'
    setWinner(w)
    setPhase('over')
  }

  // build (or rebuild, on rematch) the runner for the current seed. The 3D
  // engine lives in a lazy chunk (three.js), imported only when a race starts.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    resolvedRef.current = false
    myDeadRef.current = false
    oppDeadRef.current = false
    myFinal.current = 0
    oppFinal.current = 0
    oppDistRef.current = 0
    setMyDist(0); setOppDist(0); setMyAlive(true); setOppAlive(true)
    setMyCoins(0); setSpent(0); setWinner(null); setCount(3); setPhase('countdown'); setReady(false)

    let cancelled = false
    let handle: Run3DHandle | null = null
    import('../game/lionRun3d').then(({ startLionRun3D }) => {
      if (cancelled || !canvasRef.current) return
      const h = startLionRun3D(canvasRef.current, {
        onStart: () => {},
        onScore: (_s, coins) => setMyCoins(coins),
        onStage: (_n, name) => setStageName(name),
        onHud: (h2) => setHud(h2),
        onItemBox: () => {
          // Mario-Kart: an item box grants ONE free random weapon (any range, no cost)
          const k = ATTACKS[Math.floor(Math.random() * ATTACKS.length)].kind
          setFreeWeapon(k)
        },
        onProgress: (dist, lane, alive) => {
          setMyDist(dist)
          myDistRef.current = dist
          const now = performance.now()
          if (now - lastSent.current > 90) {
            lastSent.current = now
            sendRef.current({ a: 'state', dist: Math.round(dist), lane, alive, female: femaleRef.current, skin: skinRef.current, character: charRef.current })
          }
        },
        onOver: (r) => {
          myDeadRef.current = true
          myFinal.current = r.distanceM ?? 0
          setMyAlive(false)
          sendRef.current({ a: 'dead', dist: myFinal.current })
          resolve() // my crash ends the race for both
        },
      }, { seed: curSeed, race: true, oppName: opp.name, female: femaleRef.current, skin: skinRef.current, character: charRef.current })
      if (!h) { setFailed(true); return }
      handle = h
      handleRef.current = h
      setReady(true)
    })
    return () => { cancelled = true; handle?.destroy(); handleRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curSeed])

  // countdown → begin the run together (only once the engine has booted)
  useEffect(() => {
    if (phase !== 'countdown' || !ready) return
    if (count === 0) {
      handleRef.current?.begin()
      const t = setTimeout(() => setPhase('racing'), 350)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCount((c) => c - 1), 750)
    return () => clearTimeout(t)
  }, [phase, count, ready])

  // receive the opponent's events
  useEffect(() => {
    register((p) => {
      if (p.from === me.id) return
      oppSeen.current = true
      if (p.a === 'state') {
        oppDistRef.current = p.dist
        setOppDist(p.dist)
        setOppAlive(p.alive)
        handleRef.current?.setGhost(p.dist, p.lane, p.alive, p.female, p.skin, p.character) // show their chosen runner (character/skin) racing in my scene
      } else if (p.a === 'attack') {
        handleRef.current?.injectAttack(p.kind)
        setFlash(p.kind)
        setTimeout(() => setFlash(null), 900)
      } else if (p.a === 'dead') {
        oppDeadRef.current = true
        oppFinal.current = p.dist
        oppDistRef.current = p.dist
        setOppAlive(false)
        setOppDist(p.dist)
        resolve() // rival crashed → race ends for me too (I win, last standing)
      } else if (p.a === 'rematch') {
        setCurSeed(p.seed)
      } else if (p.a === 'emote') {
        setEmotePop({ e: p.e, mine: false })
        setTimeout(() => setEmotePop(null), 1800)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, me.id])

  const ammo = myCoins - spent
  const gap = Math.abs(Math.round(myDist) - Math.round(oppDist)) // metres between the lions
  function fire(atk: (typeof ATTACKS)[number]) {
    if (ammo < atk.cost || !myAlive || !oppAlive || phase !== 'racing' || gap > atk.range) return
    setSpent((s) => s + atk.cost)
    sendRef.current({ a: 'attack', kind: atk.kind })
    handleRef.current?.fireFx(atk.kind) // launch a projectile at the rival's ghost
    navigator.vibrate?.(20)
  }
  function fireFree() {
    // an item-box weapon fires for free, ignoring range/coins
    if (!freeWeapon || !myAlive || !oppAlive || phase !== 'racing') return
    sendRef.current({ a: 'attack', kind: freeWeapon })
    handleRef.current?.fireFx(freeWeapon)
    setFreeWeapon(null)
    navigator.vibrate?.(20)
  }
  function sendEmote(e: string) {
    setEmoteOpen(false)
    setEmotePop({ e, mine: true })
    setTimeout(() => setEmotePop(null), 1800)
    sendRef.current({ a: 'emote', e })
  }
  function chooseCharacter(id: string) {
    setMyChar(id)
    charRef.current = id
    try { localStorage.setItem('fl-character', id) } catch { /* private mode */ }
    const fem = characterById(id).female === true
    setMyFemale(fem)
    femaleRef.current = fem
    const def = characterById(id)
    if (def.url) import('../game/characterModel').then((m) => m.preloadCharacterModel(def.url)).catch(() => {})
    handleRef.current?.setSelfFemale(fem)
    handleRef.current?.setSelfCharacter(id)
  }
  function chooseSkin(id: string) {
    setMySkin(id)
    skinRef.current = id
    try { localStorage.setItem('fl-lion-skin', id) } catch { /* private mode */ }
    handleRef.current?.setSkin(id)
  }
  function rematch() {
    const s = Math.floor(Math.random() * 1e9)
    sendRef.current({ a: 'rematch', seed: s })
    setCurSeed(s)
  }
  function quit() {
    if (!myDeadRef.current) sendRef.current({ a: 'dead', dist: Math.round(myDist) })
    onClose()
  }

  const leader = Math.max(myDist, oppDist, 60)
  const flashLabel = flash === 'rocket' ? '🚀 Rocket incoming!'
    : flash === 'bolt' ? '⚡ Thunder strike!'
    : flash === 'fire' ? '🔥 Fireball!'
    : flash === 'freeze' ? '❄️ Frozen!'
    : flash === 'tornado' ? '🌪️ Twister!' : ''

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-[#06050d]">
      {/* the runner fills the screen */}
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      {failed && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-slate-950/90 px-8 text-center">
          <div className="text-4xl">🦁</div>
          <p className="text-sm text-slate-300">Racing needs 3D graphics, which aren’t available here.</p>
          <button onClick={onClose} className="rounded-2xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white">Close</button>
        </div>
      )}

      {/* ---- top HUD: both faces + live distance + relative progress bar ---- */}
      <div className="relative z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-3 pb-4"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}>
        <Face face={me} dist={myDist} alive={myAlive} mine />
        <div className="flex flex-col items-center">
          <div className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white/80">{stageName}</div>
          <div className="text-[10px] font-bold text-white/50">RACE</div>
        </div>
        <Face face={opp} dist={oppDist} alive={oppAlive} />
        <button onClick={quit} aria-label="Leave race"
          className="absolute right-2 top-1 rounded-full p-1.5 text-white/60 hover:bg-white/10"
          style={{ top: 'calc(0.25rem + env(safe-area-inset-top))' }}>
          <X size={16} />
        </button>
      </div>
      {/* relative progress: two lion markers race toward the current leader */}
      <div className="relative z-20 -mt-2 space-y-1.5 px-4">
        {[{ d: myDist, mine: true }, { d: oppDist, mine: false }].map((row, i) => (
          <div key={i} className="relative h-2 overflow-visible rounded-full bg-white/10">
            <div className={`absolute inset-y-0 left-0 rounded-full ${row.mine ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-sky-400 to-indigo-500'}`}
              style={{ width: `${Math.min(100, (row.d / leader) * 100)}%` }} />
            <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[13px]"
              style={{ left: `${Math.min(100, (row.d / leader) * 100)}%` }}>🦁</span>
          </div>
        ))}
      </div>

      {/* ---- power-up / combo / shield HUD ---- */}
      {phase === 'racing' && hud && (hud.powerups.length > 0 || hud.combo >= 5 || hud.shield) && (
        <div className="relative z-20 mt-1.5 flex flex-wrap items-center justify-center gap-1.5 px-3">
          {hud.shield && <span className="rounded-full bg-cyan-500/25 px-2 py-0.5 text-[11px] font-black text-cyan-200 ring-1 ring-cyan-300/50">🛡️ Shield</span>}
          {hud.powerups.map((p) => (
            <span key={p.kind} className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-black text-white">
              {p.kind === 'magnet' ? '🧲' : p.kind === 'jet' ? '🚀' : p.kind === 'x2' ? '✨' : '⏩'} {Math.ceil(p.tLeft)}s
            </span>
          ))}
          {hud.combo >= 5 && <span className="rounded-full bg-amber-500/30 px-2 py-0.5 text-[11px] font-black text-amber-200">🔥 x{hud.mult} · {hud.combo} combo</span>}
        </div>
      )}

      {/* ---- emote control + popup ---- */}
      {phase === 'racing' && (
        <div className="absolute right-11 z-30" style={{ top: 'calc(0.3rem + env(safe-area-inset-top))' }}>
          <button onClick={() => setEmoteOpen((o) => !o)} aria-label="Send emote"
            className="rounded-full bg-white/10 p-1.5 text-lg leading-none active:scale-90">😜</button>
          {emoteOpen && (
            <div className="absolute right-0 mt-1 grid grid-cols-4 gap-1 rounded-2xl bg-black/75 p-2">
              {EMOTES.map((e) => (
                <button key={e} onClick={() => sendEmote(e)} className="text-2xl leading-none active:scale-90">{e}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {emotePop && (
        <div className="pointer-events-none absolute inset-x-0 z-30 flex justify-center" style={{ top: '28%' }}>
          <div className="animate-bounce rounded-2xl bg-black/55 px-4 py-2 text-center">
            <div className="text-5xl leading-none">{emotePop.e}</div>
            <div className="mt-1 text-xs font-bold text-white/85">{emotePop.mine ? 'You' : opp.name.split(' ')[0]}</div>
          </div>
        </div>
      )}

      {/* ---- countdown + lion/lioness picker ---- */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6">
          <div className="animate-pulse text-7xl font-black text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
            {count > 0 ? count : 'GO!'}
          </div>
          {/* character picker — pick your runner (lion, lioness, wolf, fox…) */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Runner</div>
            <div className="flex max-w-[92vw] flex-wrap items-center justify-center gap-1.5 px-4">
              {CHARACTERS.map((c) => (
                <button key={c.id} onClick={() => chooseCharacter(c.id)}
                  title={c.name}
                  className={`flex h-12 min-w-12 flex-col items-center justify-center rounded-2xl px-2 transition active:scale-90 ${myChar === c.id ? 'bg-white/25 ring-2 ring-white' : 'bg-white/8'}`}>
                  <span className="text-xl leading-none">{c.emoji}</span>
                  <span className="mt-0.5 text-[8px] font-bold text-white/70">{c.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>
          {/* skin picker */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Skin</div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 px-4">
              {LION_SKINS.map((s) => (
                <button key={s.id} onClick={() => chooseSkin(s.id)}
                  className={`flex h-11 w-11 flex-col items-center justify-center rounded-2xl text-lg transition active:scale-90 ${mySkin === s.id ? 'bg-white/25 ring-2 ring-white' : 'bg-white/8'}`}>
                  {s.emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- incoming-attack flash ---- */}
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="rounded-2xl bg-black/55 px-5 py-3 text-lg font-black text-white">{flashLabel}</div>
        </div>
      )}

      {/* ---- item-box free weapon (Mario-Kart) ---- */}
      {phase === 'racing' && myAlive && freeWeapon && (
        <div className="absolute inset-x-0 z-20 flex justify-center" style={{ bottom: 'calc(9.2rem + env(safe-area-inset-bottom))' }}>
          <button onClick={fireFree} onPointerDown={(e) => e.preventDefault()}
            className="animate-pulse rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-600 px-4 py-2 text-sm font-black text-white shadow-lg active:scale-95">
            🎁 FREE {ATTACKS.find((a) => a.kind === freeWeapon)?.icon} — tap to fire!
          </button>
        </div>
      )}

      {/* ---- attack buttons ---- */}
      {phase === 'racing' && myAlive && (
        <div className="absolute inset-x-0 z-20 flex items-end justify-center gap-1.5 px-2 sm:gap-2"
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {ATTACKS.map((atk) => {
            const inRange = oppAlive && gap <= atk.range
            const ready = ammo >= atk.cost && inRange
            return (
              <button key={atk.kind}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => fire(atk)}
                disabled={!ready}
                className={`relative flex h-[68px] w-[18%] max-w-16 flex-col items-center justify-center rounded-2xl bg-gradient-to-br ${atk.color} text-white shadow-lg transition active:scale-90 ${ready ? '' : 'opacity-35 grayscale'}`}>
                <span className="text-2xl leading-none">{atk.icon}</span>
                <span className="mt-0.5 text-[9px] font-black">{atk.cost}🪙</span>
                <span className={`text-[9px] font-black ${inRange ? 'text-emerald-200' : 'opacity-80'}`}>≤{atk.range}m</span>
              </button>
            )
          })}
        </div>
      )}
      {phase === 'racing' && (
        <div className="absolute inset-x-0 z-20 flex flex-col items-center gap-1 text-center"
          style={{ bottom: 'calc(6.2rem + env(safe-area-inset-bottom))' }}>
          <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-bold text-amber-300">🪙 {ammo} coins — grab orbs to attack</span>
          <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] font-bold text-white/85">
            ↔ {gap}m to {opp.name.split(' ')[0]} — get closer for stronger hits
          </span>
        </div>
      )}

      {/* ---- winner screen ---- */}
      {phase === 'over' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          {winner === 'me' && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {CONFETTI.map((c, i) => (
                <span key={i} className="fl-confetti absolute block rounded-sm"
                  style={{ left: `${c.left}%`, width: c.size, height: c.size * 1.6, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }} />
              ))}
            </div>
          )}
          <div className="glass-strong relative w-full max-w-sm rounded-3xl p-6 text-center">
            <div className="text-5xl">{winner === 'me' ? '🏆' : winner === 'opp' ? '😿' : '🤝'}</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
              {winner === 'me' ? 'You WIN!' : winner === 'opp' ? `${opp.name.split(' ')[0]} wins` : "It's a tie!"}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {winner === 'tie' ? 'Both lions fell together' : `${(winner === 'me' ? opp.name.split(' ')[0] : 'You')} crashed first — race over`}
            </div>
            {/* ---- leaderboard (both racers, ranked by distance) ---- */}
            <div className="mt-4 space-y-2">
              {[
                { key: 'me', name: 'You', dist: myFinal.current, avatarUrl: me.avatarUrl },
                { key: 'opp', name: opp.name.split(' ')[0], dist: oppDeadRef.current ? oppFinal.current : Math.round(oppDist), avatarUrl: opp.avatarUrl },
              ].sort((a, b) => b.dist - a.dist).map((r, i) => (
                <div key={r.key}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${i === 0 ? 'bg-amber-400/20 ring-1 ring-amber-400/50' : 'bg-slate-500/10'}`}>
                  <span className="w-6 text-center text-xl">{i === 0 ? '🥇' : '🥈'}</span>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white">
                    {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" /> : (r.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-left text-sm font-bold text-slate-900 dark:text-white">{r.name}</div>
                  <div className={`text-lg font-black tabular-nums ${i === 0 ? 'text-amber-500' : 'text-slate-400'}`}>{r.dist}m</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={rematch}
                className="flex-1 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 text-sm font-black uppercase text-white shadow active:scale-95">
                Rematch
              </button>
              <button onClick={onClose}
                className="flex-1 rounded-2xl bg-slate-500/15 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 active:scale-95">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
