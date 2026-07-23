/**
 * NpcChat — talk to any Lion City citizen.
 *
 * A slide-up glass panel that opens when you tap a citizen in the 3D city. It
 * drives the offline NPC brain (`npcMind`): the citizen remembers what you teach
 * it, recalls past events, grows a friendship, works on goals, and learns skills
 * — all stored locally on the device. If you've turned ON internet learning in
 * Settings, and only after you confirm each lookup, it can fetch a public fact
 * from Wikipedia (clearly labelled) and file it in the NPC's local knowledge.
 *
 * The "Mind" tab is a live window into that brain: mood, friendship, goals,
 * interests, skills, memories and knowledge — with controls to forget the
 * web-learned facts or reset the citizen entirely.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Brain, Globe, Send, Sparkles, Target, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import {
  clearBrain, clearWebKnowledge, converse, deviceAiProfile, expertiseOf, friendTier, intelligence, learnWebFact,
  loadBrain, moodLabel, skillRank, type NpcBrain,
} from '../lib/npcMind'
import { edgesAmong, topConcepts } from '../lib/npcNeural'
import { googleSearchUrl } from '../lib/npcOnline'
import { researchTopic } from '../lib/npcCloud' // importing also registers the genius-brain responder
import type { CmdAction } from '../game/city3d' // type-only — does NOT pull the three.js chunk
import { setPref, usePref } from '../lib/prefs'
import { speech } from '../lib/speak'
import { confirmDialog } from '../store/app'
import { sfx } from '../game/sfx'
import { hap } from '../lib/haptics'
import { cn } from '../lib/utils'

type Msg = { role: 'player' | 'npc'; text: string; source?: string }
const CHIPS = ['What do you remember?', 'How are you?', 'What are your goals?', 'Tell me about focus']

// Player commands the citizen carries out live in the 3D city (see city3d command()).
const CMD_CHIPS: Array<{ emoji: string; label: string; action: CmdAction }> = [
  { emoji: '🎯', label: 'Come here', action: 'come' },
  { emoji: '🚶', label: 'Walk', action: 'walk' },
  { emoji: '🧭', label: 'Explore', action: 'explore' },
  { emoji: '🤺', label: 'Fight', action: 'fight' },
  { emoji: '💃', label: 'Dance', action: 'dance' },
  { emoji: '👋', label: 'Wave', action: 'wave' },
  { emoji: '🏗️', label: 'Build', action: 'build' },
  { emoji: '😌', label: 'Rest', action: 'rest' },
]
// natural-language → command (checked in order; specific before generic)
const CMD_WORDS: Array<{ re: RegExp; action: CmdAction }> = [
  { re: /\b(come here|come to me|come over|come|follow)\b/i, action: 'come' },
  { re: /\b(fight|spar|battle|box|attack)\b/i, action: 'fight' },
  { re: /\b(dance|dancing)\b/i, action: 'dance' },
  { re: /\b(wave|say hi|greet)\b/i, action: 'wave' },
  { re: /\b(build|construct)\b/i, action: 'build' },
  { re: /\b(explore|look around|roam|wander)\b/i, action: 'explore' },
  { re: /\b(walk|move|go for a walk)\b/i, action: 'walk' },
  { re: /\b(rest|sit down|relax|stop|stand still)\b/i, action: 'rest' },
]
const CMD_SAY: Record<string, string> = {
  come: 'On my way to you! 🏃', walk: 'Going for a walk 🚶', explore: 'Off to explore the city 🧭',
  fight: "Let's spar! 🤺", dance: 'Time to dance 💃', wave: '👋', build: 'I’ll go build something 🔨', rest: 'Taking a breather 😌',
}

export function NpcChat({ npcId, name, emoji, level, streak, onClose, onCommand }: {
  npcId: string; name: string; emoji: string; level: number; streak: number; onClose: () => void
  onCommand?: (action: CmdAction, targetId?: string) => void
}) {
  const [brain] = useState<NpcBrain>(() => loadBrain(npcId, { name, emoji }))
  const internetOn = usePref('npcInternet')
  const cloudOn = usePref('npcCloudBrain')
  const voiceOn = usePref('npcVoice')
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => speech.subscribe((s) => setSpeaking(s === 'playing')), [])
  useEffect(() => () => speech.stop(), []) // stop reading aloud when the chat closes
  const prof = useMemo(() => deviceAiProfile(), [])
  const badge = cloudOn
    ? { icon: '🧠', label: 'Genius brain' }
    : prof.nativeBridge
      ? { icon: '🤖', label: 'On-device model' }
      : prof.tier === 'accelerated'
        ? { icon: '⚡', label: 'Accelerated brain' }
        : { icon: '🧠', label: 'Offline brain' }

  const [tab, setTab] = useState<'chat' | 'mind'>('chat')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [ver, force] = useState(0) // bumped after a chat/edit → recompute Mind-tab data
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    const prior = brain.convo.slice(-24).map((t) => ({ role: t.role, text: t.text, source: t.source }))
    if (prior.length) return prior
    const lived = brain.memories.some((m) => m.kind === 'life')
    return [{ role: 'npc', text: `Hi! I'm ${brain.name}. ${lived ? 'Ask me what I got up to while you were away 🙂' : 'Nice to meet you — ask me anything, or teach me something!'}` }]
  })

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs])
  useEffect(() => { sfx.resume(); sfx.hologram(); hap.select() }, [])

  // fire a live 3D command (from a chip or detected in chat), with in-chat feedback.
  // Keep the click handler trivial (unlock audio + haptic in-gesture) and DEFER the
  // heavier work (sound synth, the 3D command + bubble draw, the re-render) to a
  // separate task so the tap stays responsive — the city's rAF runs behind this
  // overlay, so a synchronous handler otherwise blocks paint (INP).
  function doCommand(action: CmdAction) {
    if (!onCommand) return
    sfx.resume(); hap.tap()
    const say = CMD_SAY[action] ?? 'On it!'
    setTimeout(() => {
      sfx.uiClick()
      onCommand(action)
      setMsgs((m) => [...m, { role: 'npc', text: say }])
      if (voiceOn) speech.play(say)
    }, 0)
  }

  async function send(text: string) {
    const t = text.trim()
    if (!t || busy) return
    sfx.resume(); sfx.uiClick(); hap.tap()
    setInput('')
    setMsgs((m) => [...m, { role: 'player', text: t }])
    // if the player told the citizen to DO something, carry it out in the 3D city
    // (deferred so the 3D call doesn't block the tap — see doCommand)
    if (onCommand) { const hit = CMD_WORDS.find((c) => c.re.test(t)); if (hit) setTimeout(() => onCommand(hit.action), 0) }
    setBusy(true)
    try {
      const ctx = { level, streak, timeOfDay: new Date().getHours() }
      const reply = await converse(brain, t, ctx)
      setMsgs((m) => [...m, { role: 'npc', text: reply.text, source: reply.source }])
      if (voiceOn) speech.play(reply.text)
      // Asked something it doesn't know yet + internet learning is ON → look it up
      // from the FREE web (Wikipedia + DuckDuckGo + page scrape) right now and
      // answer with the real fact. No confirm popup (the Settings toggle is the
      // consent) and no paid AI — this is the free "living" path.
      if (reply.lookup && internetOn) {
        setMsgs((m) => [...m, { role: 'npc', text: '🌐 Let me check…', source: 'web' }])
        const fact = await researchTopic(reply.lookup)
        if (fact) {
          learnWebFact(brain, reply.lookup, fact.summary, fact.url)
          setMsgs((m) => [...m.slice(0, -1), { role: 'npc', text: `🌐 ${fact.summary}`, source: 'web' }])
          if (voiceOn) speech.play(fact.summary)
        } else {
          setMsgs((m) => [...m.slice(0, -1), { role: 'npc', text: "I couldn't find that online just now — I'll keep it in mind and try again later.", source: 'web' }])
        }
      }
      hap.reward()
    } finally {
      setBusy(false)
      force((x) => x + 1)
    }
  }

  // Mind-tab data (incl. the neural-model stats) — memoised so it recomputes only
  // after a chat/edit (ver) or tab switch, NOT on every keystroke in the composer.
  // Recomputing intelligence()/expertiseOf() per keystroke was blocking typing (INP).
  // brain mutates in place, so tab/msgs/ver are the intentional recompute signals
  // (the exhaustive-deps rule can't see the in-place mutation → disabled below).
  const { active, interests, skills, webFacts, iq, insights, expert } = useMemo(() => ({
    active: brain.goals.filter((g) => !g.done),
    interests: Object.entries(brain.interests).sort((a, b) => b[1] - a[1]).slice(0, 5),
    skills: Object.entries(brain.skills),
    webFacts: brain.knowledge.filter((k) => k.source === 'web'),
    iq: intelligence(brain),
    insights: brain.knowledge.filter((k) => k.source === 'insight').slice(-5).reverse(),
    expert: expertiseOf(brain),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [brain, tab, msgs, ver])

  return createPortal(
    <motion.div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/60 backdrop-blur-[2px]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 240 }}
        className="flex max-h-[90dvh] flex-col rounded-t-3xl bg-[#0c0a18] ring-1 ring-white/12 pb-[env(safe-area-inset-bottom)]">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/30 to-purple-500/25 text-2xl ring-1 transition',
            speaking ? 'ring-2 ring-amber-300 animate-pulse' : 'ring-white/15')}>
            {brain.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate city-display text-lg text-white">{brain.name}</span>
              <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-white/10" title={badge.label}>
                {badge.icon} {badge.label}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/55">
              <span className="truncate text-pink-300">{friendTier(brain.player.affinity)} · {brain.profession}</span>
              <span>·</span>
              <span className="shrink-0">{speaking ? '🔊 speaking…' : moodLabel(brain.mood)}</span>
            </div>
          </div>
          <button onClick={() => { const v = !voiceOn; setPref('npcVoice', v); sfx.uiClick(); hap.tap(); if (!v) speech.stop() }}
            aria-label={voiceOn ? 'Turn voice off' : 'Read replies aloud'} title={voiceOn ? 'Voice on' : 'Voice off'}
            className={cn('rounded-full p-2 transition active:scale-90', voiceOn ? 'bg-white/10 text-amber-300' : 'text-white/60 hover:bg-white/10')}>
            {voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button onClick={onClose} aria-label="Close chat" className="rounded-full p-2 text-white/70 hover:bg-white/10 active:scale-90">
            <X size={18} />
          </button>
        </div>

        {/* affinity bar */}
        <div className="px-4 pt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-amber-400 transition-all duration-500" style={{ width: `${brain.player.affinity}%` }} />
          </div>
        </div>

        {/* tabs */}
        <div className="flex gap-1 px-4 pt-3">
          {(['chat', 'mind'] as const).map((tb) => (
            <button key={tb} onClick={() => { setTab(tb); sfx.uiClick(); hap.tap() }}
              className={cn('flex items-center gap-1.5 rounded-t-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition',
                tab === tb ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/70')}>
              {tb === 'chat' ? <Sparkles size={13} /> : <Brain size={13} />}{tb}
            </button>
          ))}
        </div>

        {tab === 'chat' ? (
          <>
            <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3" style={{ minHeight: '40vh' }}>
              {msgs.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'player' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[86%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
                    m.role === 'player'
                      ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                      : m.source === 'web'
                        ? 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/30'
                        : 'bg-white/8 text-white/90 ring-1 ring-white/10')}>
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && <div className="text-sm text-white/45">{brain.name} is thinking…</div>}
            </div>

            {/* command chips — tell them what to do, live in the 3D city */}
            {onCommand && (
              <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-1.5 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/35">Tell them</span>
                {CMD_CHIPS.map((c) => (
                  <button key={c.action} onClick={() => doCommand(c.action)}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-purple-500/12 px-3 py-1.5 text-xs font-semibold text-purple-100 ring-1 ring-purple-400/25 transition active:scale-95">
                    <span>{c.emoji}</span>{c.label}
                  </button>
                ))}
              </div>
            )}

            {/* quick chips */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
              {CHIPS.map((c) => (
                <button key={c} disabled={busy} onClick={() => send(c)}
                  className="shrink-0 rounded-full bg-white/6 px-3.5 py-2 text-xs font-semibold text-white/85 ring-1 ring-white/10 transition active:scale-95 disabled:opacity-40">
                  {c}
                </button>
              ))}
            </div>

            {/* composer */}
            <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
              <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
                onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
                placeholder={`Talk to ${brain.name}…  (try “remember that…”)`}
                className="min-w-0 flex-1 rounded-full bg-white/8 px-4 py-3 text-base text-white placeholder:text-white/35 outline-none ring-1 ring-white/10 focus:ring-amber-400/50" />
              <button onClick={() => send(input)} disabled={busy || !input.trim()} aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg transition active:scale-90 disabled:opacity-40">
                <Send size={18} />
              </button>
            </div>
            <div className="px-4 pb-2 text-center text-[10px] text-white/35">
              {cloudOn ? '🧠 Genius brain ON — answers anything, in character · uses your daily AI allowance'
                : internetOn ? '🌐 Internet learning ON — citizens also learn in the background · your lookups ask first'
                  : '🔒 Fully offline · enable internet learning or the genius brain in Settings'}
            </div>
          </>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm" style={{ minHeight: 220 }}>
            <MindRow icon={<span className="text-xs">🧠</span>} title="Neural model — its own mind">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full bg-purple-500/20 px-2.5 py-1 font-bold text-purple-200 ring-1 ring-purple-400/30">{iq.label} · IQ {iq.iq}</span>
                <span className="text-white/60">{iq.neurons} neurons</span>
                <span className="text-white/60">{iq.synapses} connections</span>
                <span className="text-white/60">Lv {iq.level}</span>
              </div>
              <div className="rounded-2xl bg-black/30 p-2 ring-1 ring-white/10">
                <NeuralMap brain={brain} />
              </div>
              {expert && (
                <div className="mt-2 text-[11px] text-white/70">
                  🎯 Specialises in <span className="font-semibold text-amber-200">{expert.field}</span>
                  {expert.concepts.length > 1 && <span className="text-white/45"> · linked to {expert.concepts.slice(1, 4).join(', ')}</span>}
                </div>
              )}
              <div className="mt-1 text-[10px] text-white/40">
                Concepts it meets become neurons; ideas that occur together wire up. It thinks by firing across them, sleeps to consolidate memory, and makes creative leaps.
                {' '}{internetOn || cloudOn ? 'Growing from the internet too.' : 'Enable internet learning to grow it faster.'}
              </div>
            </MindRow>

            {insights.length > 0 && (
              <MindRow icon={<span className="text-xs">💡</span>} title="Its own ideas (insights it formed)">
                <div className="space-y-1 text-white/75">
                  {insights.map((k, i) => <div key={i} className="text-[12px]">💡 {k.text}</div>)}
                </div>
              </MindRow>
            )}

            <MindRow icon={<Target size={14} />} title="Goals & plans">
              {active.length ? active.map((g) => {
                const pct = g.steps.length ? g.steps.filter((s) => s.done).length / g.steps.length : g.progress
                return (
                  <div key={g.id} className="mb-2.5">
                    <div className="flex justify-between text-white/85"><span className="pr-2">{g.text}</span><span className="shrink-0 text-amber-300">{Math.round(pct * 100)}%</span></div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-400 transition-all" style={{ width: `${pct * 100}%` }} /></div>
                    {g.steps.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {g.steps.map((s, i) => (
                          <div key={i} className={cn('text-[11px]', s.done ? 'text-emerald-300/80 line-through' : 'text-white/55')}>{s.done ? '✅' : '▫️'} {s.text}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }) : <span className="text-white/45">No active goals — try “can you explore every district”.</span>}
            </MindRow>

            <MindRow icon={<span className="text-xs">💡</span>} title="Interests">
              <div className="flex flex-wrap gap-1.5">
                {interests.length ? interests.map(([t]) => (
                  <span key={t} className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-white/80 ring-1 ring-white/10">{t}</span>
                )) : <span className="text-white/45">Still figuring out what it likes.</span>}
              </div>
            </MindRow>

            {brain.wantsToLearn.length > 0 && (
              <MindRow icon={<Globe size={14} />} title="Wants to learn · tap to search Google">
                <div className="flex flex-wrap gap-1.5">
                  {brain.wantsToLearn.slice(-6).map((t) => (
                    <a key={t} href={googleSearchUrl(t)} target="_blank" rel="noreferrer"
                      className="rounded-full bg-sky-500/12 px-2.5 py-1 text-[11px] text-sky-200 ring-1 ring-sky-400/25 transition active:scale-95 hover:bg-sky-500/20">🔎 {t}</a>
                  ))}
                </div>
              </MindRow>
            )}

            {skills.length > 0 && (
              <MindRow icon={<span className="text-xs">🎓</span>} title="Skills learned">
                <div className="flex flex-wrap gap-1.5">
                  {skills.map(([s, lv]) => (
                    <span key={s} className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-200 ring-1 ring-emerald-400/30">{s} · {skillRank(lv)} (Lv {lv})</span>
                  ))}
                </div>
              </MindRow>
            )}

            <MindRow icon={<Sparkles size={14} />} title="Recent memories">
              <div className="space-y-1 text-white/70">
                {[...brain.memories].filter((m) => m.salience >= 0.4).slice(-6).reverse().map((m, i) => (
                  <div key={i} className="text-[12px]">• {m.text}</div>
                ))}
              </div>
            </MindRow>

            <MindRow icon={<Globe size={14} />} title={`Knowledge (${brain.knowledge.length})`}>
              {brain.knowledge.length ? (
                <div className="space-y-1.5">
                  {[...brain.knowledge].slice(-6).reverse().map((k, i) => (
                    <div key={i} className="text-[12px] text-white/75">
                      <span className={k.source === 'web' ? 'text-sky-300' : k.source === 'insight' ? 'text-purple-300' : 'text-amber-300'}>{k.source === 'web' ? '🌐' : k.source === 'insight' ? '💡' : '📘'}</span> {k.text}
                    </div>
                  ))}
                </div>
              ) : <span className="text-white/45">Teach it with “remember that …”.</span>}
            </MindRow>

            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
              {webFacts.length > 0 && (
                <button onClick={() => { clearWebKnowledge(brain); sfx.uiBack(); hap.select(); force((x) => x + 1) }}
                  className="flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-white/10 active:scale-95">
                  <Globe size={13} /> Forget web knowledge ({webFacts.length})
                </button>
              )}
              <button onClick={async () => {
                if (await confirmDialog(`Reset ${brain.name} completely? Their personality, memories and our friendship will be wiped.`, { yesLabel: 'Reset', noLabel: 'Keep' })) {
                  clearBrain(brain.id); sfx.uiBack(); hap.crash(); onClose()
                }
              }}
                className="flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-400/30 active:scale-95">
                <Trash2 size={13} /> Reset this citizen
              </button>
            </div>
            <div className="text-center text-[10px] text-white/30">
              {badge.icon} {badge.label} · {prof.cores} cores · {prof.deviceMemoryGB} GB{prof.webgpu ? ' · WebGPU' : ''} — all data stored on this device
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function MindRow({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{icon} {title}</div>
      {children}
    </div>
  )
}

/** A compact live picture of the citizen's neural model: nodes = its strongest
 *  concepts (neurons), lines = the connections (synapses) it has wired between
 *  them. Node size tracks how reinforced a concept is; line strength tracks the
 *  connection weight. Purely a readout of the brain's own numbers. */
function NeuralMap({ brain }: { brain: NpcBrain }) {
  const nodes = topConcepts(brain.net, 9)
  if (nodes.length < 2) {
    return <div className="py-3 text-center text-[12px] text-white/45">This mind is just waking up — chat and let it learn to grow its neural web. 🌱</div>
  }
  const ids = nodes.map((n) => n.concept)
  const edges = edgesAmong(brain.net, ids)
  const W = 260, H = 168, cx = W / 2, cy = H / 2, R = 62
  const pos: Record<string, { x: number; y: number }> = {}
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2
    pos[n.concept] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }
  })
  const maxAct = Math.max(...nodes.map((n) => n.act), 0.5)
  const maxW = Math.max(...edges.map((e) => e.w), 0.5)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 190 }} role="img" aria-label="Neural model map">
      {edges.map((e, i) => {
        const p = pos[e.a], q = pos[e.b]
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#a78bfa" strokeOpacity={0.12 + 0.5 * (e.w / maxW)} strokeWidth={0.4 + 1.6 * (e.w / maxW)} />
      })}
      {nodes.map((n) => {
        const p = pos[n.concept]
        const r = 3 + 5 * (n.act / maxAct)
        return (
          <g key={n.concept}>
            <circle cx={p.x} cy={p.y} r={r} fill="#f59e0b" fillOpacity={0.9} />
            <text x={p.x} y={p.y - r - 2.5} textAnchor="middle" fontSize="7.5" fill="#e5e7eb">{n.concept.slice(0, 12)}</text>
          </g>
        )
      })}
    </svg>
  )
}
