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
import type { Run3DHandle, AttackKind } from '../game/lionRun3d'
import { MascotImg } from './ui'

export type RacePayload =
  | { a: 'state'; from: string; dist: number; lane: number; alive: boolean }
  | { a: 'attack'; from: string; kind: AttackKind }
  | { a: 'dead'; from: string; dist: number }
  | { a: 'rematch'; from: string; seed: number }

// Omit distributes over each union member (plain Omit<Union,K> would collapse
// to just the shared keys), so the outbound (no `from`) payload keeps its shape
export type RaceOutbound = RacePayload extends infer T ? (T extends RacePayload ? Omit<T, 'from'> : never) : never

type Face = { name: string; avatarUrl?: string; id: string }

const ATTACKS: { kind: AttackKind; icon: string; label: string; cost: number; color: string }[] = [
  { kind: 'rocket', icon: '🚀', label: 'Rocket', cost: 5, color: 'from-rose-500 to-orange-500' },
  { kind: 'bolt', icon: '⚡', label: 'Bolt', cost: 4, color: 'from-amber-400 to-yellow-500' },
  { kind: 'wall', icon: '🧱', label: 'Wall', cost: 7, color: 'from-sky-500 to-indigo-500' },
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

  const handleRef = useRef<Run3DHandle | null>(null)
  const lastSent = useRef(0)
  const myDeadRef = useRef(false)
  const oppDeadRef = useRef(false)
  const myFinal = useRef(0)
  const oppFinal = useRef(0)
  const oppDistRef = useRef(0)
  const oppSeen = useRef(false)
  const resolvedRef = useRef(false)
  const sendRef = useRef(send)
  sendRef.current = send

  function resolve() {
    if (resolvedRef.current) return
    resolvedRef.current = true
    const mine = myFinal.current
    const theirs = oppDeadRef.current ? oppFinal.current : oppDistRef.current
    setWinner(!oppSeen.current || mine > theirs ? 'me' : mine < theirs ? 'opp' : 'tie')
    setPhase('over')
  }
  function maybeResolve() {
    if (!myDeadRef.current) return
    if (oppSeen.current && !oppDeadRef.current) return // they're still running — wait
    resolve()
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
        onProgress: (dist, lane, alive) => {
          setMyDist(dist)
          const now = performance.now()
          if (now - lastSent.current > 90) {
            lastSent.current = now
            sendRef.current({ a: 'state', dist: Math.round(dist), lane, alive })
          }
        },
        onOver: (r) => {
          myDeadRef.current = true
          myFinal.current = r.distanceM ?? 0
          setMyAlive(false)
          sendRef.current({ a: 'dead', dist: myFinal.current })
          maybeResolve()
          // safety: if the opponent goes silent after we die, settle anyway
          setTimeout(() => resolve(), 8000)
        },
      }, { seed: curSeed, race: true })
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
        maybeResolve()
      } else if (p.a === 'rematch') {
        setCurSeed(p.seed)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, me.id])

  const ammo = myCoins - spent
  function fire(kind: AttackKind, cost: number) {
    if (ammo < cost || !myAlive || !oppAlive || phase !== 'racing') return
    setSpent((s) => s + cost)
    sendRef.current({ a: 'attack', kind })
    navigator.vibrate?.(20)
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
  const flashLabel = flash === 'rocket' ? '🚀 Rocket incoming!' : flash === 'bolt' ? '⚡ Stunned!' : flash === 'wall' ? '🧱 Wall drop!' : ''

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

      {/* ---- countdown ---- */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="animate-pulse text-7xl font-black text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
            {count > 0 ? count : 'GO!'}
          </div>
        </div>
      )}

      {/* ---- incoming-attack flash ---- */}
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="rounded-2xl bg-black/55 px-5 py-3 text-lg font-black text-white">{flashLabel}</div>
        </div>
      )}

      {/* ---- attack buttons ---- */}
      {phase === 'racing' && myAlive && (
        <div className="absolute inset-x-0 z-20 flex items-end justify-center gap-3"
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {ATTACKS.map((atk) => {
            const ready = ammo >= atk.cost && oppAlive
            return (
              <button key={atk.kind}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => fire(atk.kind, atk.cost)}
                disabled={!ready}
                className={`flex h-16 w-16 flex-col items-center justify-center rounded-2xl bg-gradient-to-br ${atk.color} text-white shadow-lg transition active:scale-90 ${ready ? '' : 'opacity-35 grayscale'}`}>
                <span className="text-2xl leading-none">{atk.icon}</span>
                <span className="mt-0.5 text-[10px] font-black">{atk.cost}🪙</span>
              </button>
            )
          })}
        </div>
      )}
      {phase === 'racing' && (
        <div className="absolute inset-x-0 z-20 text-center"
          style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
          <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-bold text-amber-300">🪙 {ammo} coins — grab orbs to attack</span>
        </div>
      )}

      {/* ---- winner screen ---- */}
      {phase === 'over' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-sm rounded-3xl p-6 text-center">
            <div className="text-5xl">{winner === 'me' ? '🏆' : winner === 'opp' ? '😿' : '🤝'}</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
              {winner === 'me' ? 'You WIN!' : winner === 'opp' ? `${opp.name.split(' ')[0]} wins` : "It's a tie!"}
            </div>
            <div className="mt-4 flex items-center justify-center gap-6">
              <div>
                <MascotImg className="mx-auto h-8 w-auto" />
                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-300">You</div>
                <div className="text-lg font-black text-amber-500">{myFinal.current}m</div>
              </div>
              <div className="text-2xl font-black text-slate-300">vs</div>
              <div>
                <div className="mx-auto flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white">
                  {opp.avatarUrl ? <img src={opp.avatarUrl} alt="" className="h-full w-full object-cover" /> : (opp.name || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-300">{opp.name.split(' ')[0]}</div>
                <div className="text-lg font-black text-sky-500">{oppDeadRef.current ? oppFinal.current : Math.round(oppDist)}m</div>
              </div>
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
