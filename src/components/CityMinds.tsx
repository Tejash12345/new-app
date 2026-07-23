/**
 * CityMinds — a live dashboard of how the Lion City citizens' minds are
 * developing, right on the player's device.
 *
 * Every citizen grows an on-device neural model (see ../lib/npcNeural): it
 * learns, thinks, forms insights, gains skills, and invents things. This panel
 * reads those local brains and shows the whole city's progress at a glance —
 * an "IQ" leaderboard, each citizen's neural size + specialisation + top skill +
 * latest thought, and the city's combined knowledge and inventions. It refreshes
 * on a timer, so if you leave it open you can literally watch them get smarter.
 *
 * Portaled to <body> (a Page wraps content in a transformed motion.div, which
 * would break position:fixed — same rule as NpcChat).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Brain, X } from 'lucide-react'
import { expertiseOf, intelligence, loadBrain, skillRank } from '../lib/npcMind'
import { sfx } from '../game/sfx'
import { hap } from '../lib/haptics'

type Citizen = { id: string; name: string; emoji: string }

export function CityMinds({ citizens, onPick, onClose }: {
  citizens: Citizen[]
  onPick: (c: Citizen) => void
  onClose: () => void
}) {
  // refresh on a timer so ongoing development (the 3D scene keeps mutating the
  // brains behind this overlay) shows up live — the state bump re-renders, which
  // re-reads the brains below
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 4000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { sfx.resume(); sfx.hologram(); hap.select() }, [])

  const rows = citizens.map((c) => {
    const brain = loadBrain(c.id, { name: c.name, emoji: c.emoji })
    const iq = intelligence(brain)
    const exp = expertiseOf(brain)
    const inventions = brain.knowledge.filter((k) => k.topic.startsWith('invention:')).length
    const insights = brain.knowledge.filter((k) => k.source === 'insight').length
    const top = Object.entries(brain.skills).sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined
    let lastThought: string | undefined
    for (let i = brain.knowledge.length - 1; i >= 0; i--) if (brain.knowledge[i].source === 'insight') { lastThought = brain.knowledge[i].text; break }
    return { c, iq, exp, inventions, insights, top, lastThought, knowledge: brain.knowledge.length }
  }).sort((a, b) => b.iq.iq - a.iq.iq)

  const maxIq = Math.max(1, ...rows.map((r) => r.iq.iq))
  const totalKnowledge = rows.reduce((a, r) => a + r.knowledge, 0)
  const totalInventions = rows.reduce((a, r) => a + r.inventions, 0)
  const avgIq = rows.length ? Math.round(rows.reduce((a, r) => a + r.iq.iq, 0) / rows.length) : 0

  return createPortal(
    <motion.div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/60 backdrop-blur-[2px]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 240 }}
        className="flex max-h-[92dvh] flex-col rounded-t-3xl bg-[#0c0a18] ring-1 ring-white/12 pb-[env(safe-area-inset-bottom)]">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/30 to-amber-400/25 text-2xl ring-1 ring-white/15">
            <Brain size={22} className="text-purple-200" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="city-display text-lg text-white">City Minds</div>
            <div className="mt-0.5 text-[11px] text-white/55">How your citizens are developing — live 🧠</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-white/70 hover:bg-white/10 active:scale-90">
            <X size={18} />
          </button>
        </div>

        {/* civilization summary */}
        <div className="grid grid-cols-4 gap-2 px-4 py-3">
          {[
            { label: 'Citizens', value: rows.length },
            { label: 'Avg IQ', value: avgIq },
            { label: 'Facts known', value: totalKnowledge },
            { label: 'Inventions', value: totalInventions },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/6 px-2 py-2 text-center ring-1 ring-white/10">
              <div className="text-lg font-black text-amber-300">{s.value}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-white/45">{s.label}</div>
            </div>
          ))}
        </div>

        {/* citizen list */}
        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4" style={{ minHeight: '46vh' }}>
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-white/45">Open Lion City to bring the citizens to life, then come back to watch their minds grow.</div>
          )}
          {rows.map((r, i) => (
            <button key={r.c.id} onClick={() => { sfx.uiClick(); hap.tap(); onPick(r.c) }}
              className="flex w-full items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5 text-left ring-1 ring-white/10 transition active:scale-[0.98] hover:bg-white/8">
              <div className="flex w-6 shrink-0 justify-center text-xs font-black text-white/40">{i === 0 ? '👑' : `#${i + 1}`}</div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8 text-xl ring-1 ring-white/10">{r.c.emoji}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-white/90">{r.c.name}</span>
                  <span className="shrink-0 rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold text-purple-200 ring-1 ring-purple-400/30">{r.iq.label}</span>
                </div>
                {/* IQ bar */}
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-400 to-amber-400 transition-all duration-700" style={{ width: `${(r.iq.iq / maxIq) * 100}%` }} />
                  </div>
                  <span className="shrink-0 text-[10px] font-bold text-amber-300">IQ {r.iq.iq}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-white/50">
                  <span>🧠 {r.iq.neurons}n · {r.iq.synapses}c</span>
                  {r.exp && <span className="text-amber-200/80">🎯 {r.exp.field}</span>}
                  {r.top && <span className="text-emerald-300/80">🎓 {r.top[0]} · {skillRank(r.top[1])}</span>}
                  {r.inventions > 0 && <span className="text-pink-300/80">🏛️ {r.inventions}</span>}
                  {r.insights > 0 && <span className="text-sky-300/80">💡 {r.insights}</span>}
                </div>
                {r.lastThought && <div className="mt-1 truncate text-[10px] italic text-white/40">“{r.lastThought}”</div>}
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 pb-2 text-center text-[10px] text-white/35">Tap a citizen to chat and see their full neural map · updates live</div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
