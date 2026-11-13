import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, X, Send, Check, Repeat } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useApp } from '../store/app'
import { supabase } from '../lib/supabase'
import { leoAgent, transcribeVoice, type ChatTurn, type LeoAction } from '../lib/ai'
import { listen, voiceSupported, type Listener } from '../lib/voice'
import { speech } from '../lib/speak'
import { cn } from '../lib/utils'

// ----------------------------------------------------------------------------
// Leo Live — a JARVIS-style voice assistant. Tap the orb and talk (any
// language). Leo transcribes (Whisper), thinks with live context (time, open
// tasks, today's study), DOES things in the app — add/complete tasks, save
// notes, start a focus timer, open pages, switch theme — and answers aloud.
// Hands-free mode keeps the conversation going without tapping again.
// ----------------------------------------------------------------------------

export const LEO_LIVE_EVENT = 'focuslion:leo-live'

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'
type Line = { who: 'you' | 'leo'; text: string; done?: string[] }

const PAGES: Record<string, string> = {
  home: '/', planner: '/planner', tasks: '/tasks', focus: '/focus', wellbeing: '/wellbeing',
  learn: '/learn', quiz: '/quiz', lens: '/lens', insights: '/insights', vocab: '/vocab',
  diet: '/diet', career: '/career', startup: '/startup', notes: '/notes', analytics: '/analytics',
  arena: '/arena', coach: '/coach', feed: '/feed', chat: '/chat', friends: '/friends', settings: '/settings',
}
const LANG_LABEL: Record<string, string> = {
  en: 'english', hi: 'hindi', te: 'telugu', ta: 'tamil', kn: 'kannada', ml: 'malayalam',
  mr: 'marathi', bn: 'bengali', gu: 'gujarati', pa: 'punjabi',
}
const SUGGESTIONS = [
  'Brief me on my day',
  'Add a task to revise physics tomorrow at 6 PM',
  'Start a 25 minute focus session',
  'Explain photosynthesis simply',
  'Save a note: buy lab record',
]

export function LeoLive() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [handsFree, setHandsFree] = useState(() => {
    try { return localStorage.getItem('fl:leo-handsfree') !== '0' } catch { return true }
  })

  const listenerRef = useRef<Listener | null>(null)
  const historyRef = useRef<ChatTurn[]>([])
  const orbRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  const handsFreeRef = useRef(handsFree)
  useEffect(() => { openRef.current = open; handsFreeRef.current = handsFree }, [open, handsFree])
  const scrollRef = useRef<HTMLDivElement>(null)

  // open from anywhere (search palette, buttons) via a window event
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(LEO_LIVE_EVENT, onOpen)
    return () => window.removeEventListener(LEO_LIVE_EVENT, onOpen)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines, phase])

  // the orb reacts to your voice — written straight to the DOM (no re-render
  // 30x a second, which is what would make the app stutter)
  const setLevel = useCallback((l: number) => {
    const el = orbRef.current
    if (el) el.style.setProperty('--lvl', l.toFixed(3))
  }, [])

  const stopAll = useCallback(() => {
    listenerRef.current?.cancel()
    listenerRef.current = null
    speech.stop()
    setLevel(0)
    setPhase('idle')
  }, [setLevel])

  const close = useCallback(() => { stopAll(); setOpen(false) }, [stopAll])

  /** Live context the assistant reasons over. */
  async function buildContext(): Promise<string> {
    const now = new Date()
    const parts = [
      `Local time: ${now.toLocaleString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      `ISO local date: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    ]
    if (profile) parts.push(`User: ${profile.full_name || 'student'} · ${profile.xp} XP · study streak ${profile.study_streak} days`)
    if (user) {
      const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
      const [tasks, sessions] = await Promise.all([
        supabase.from('tasks').select('title, due_at, priority, subject').eq('user_id', user.id).eq('done', false)
          .order('due_at', { ascending: true, nullsFirst: false }).limit(12),
        supabase.from('study_sessions').select('duration_min').eq('user_id', user.id)
          .gte('started_at', startOfDay.toISOString()),
      ])
      const t = (tasks.data ?? []) as { title: string; due_at: string | null; priority: number; subject: string }[]
      parts.push(t.length
        ? `Open tasks:\n${t.map((x) => `- ${x.title}${x.subject ? ` [${x.subject}]` : ''}${x.due_at ? ` (due ${new Date(x.due_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}${x.priority === 2 ? ' URGENT' : ''}`).join('\n')}`
        : 'Open tasks: none')
      const mins = ((sessions.data ?? []) as { duration_min: number }[]).reduce((s, x) => s + (x.duration_min || 0), 0)
      parts.push(`Studied today: ${mins} minutes`)
    }
    return parts.join('\n')
  }

  /** Perform the assistant's actions; returns short labels of what was done. */
  async function runActions(actions: LeoAction[]): Promise<string[]> {
    const done: string[] = []
    for (const a of actions) {
      try {
        if (a.type === 'add_task' && user && a.title) {
          const due = a.due ? new Date(a.due) : null
          const { error } = await supabase.from('tasks').insert({
            user_id: user.id, title: String(a.title).slice(0, 140), notes: '', kind: 'task',
            subject: String(a.subject ?? '').slice(0, 40),
            priority: Math.max(0, Math.min(2, Math.round(Number(a.priority) || 1))),
            due_at: due && !isNaN(due.getTime()) ? due.toISOString() : null,
          })
          if (!error) done.push(`Task added: ${a.title}`)
        } else if (a.type === 'complete_task' && user && a.title) {
          const { data } = await supabase.from('tasks').select('id, title').eq('user_id', user.id).eq('done', false)
          const q = String(a.title).toLowerCase()
          const hit = (data ?? []).find((t: { title: string }) => t.title.toLowerCase() === q)
            ?? (data ?? []).find((t: { title: string }) => t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()))
          if (hit) {
            await supabase.from('tasks').update({ done: true, progress: 100 }).eq('id', hit.id)
            done.push(`Completed: ${hit.title}`)
          }
        } else if (a.type === 'add_note' && user) {
          const { error } = await supabase.from('notes').insert({
            user_id: user.id, title: String(a.title || 'Voice note').slice(0, 120), body: String(a.body ?? ''), color: 0,
          })
          if (!error) done.push(`Note saved: ${a.title || 'Voice note'}`)
        } else if (a.type === 'start_focus') {
          const min = Math.max(5, Math.min(120, Math.round(Number(a.minutes) || 25)))
          const qs = new URLSearchParams({ start: String(min), ...(a.subject ? { subject: String(a.subject) } : {}) })
          navigate(`/focus?${qs}`)
          done.push(`Focus started: ${min} min`)
        } else if (a.type === 'open' && PAGES[a.page]) {
          navigate(PAGES[a.page])
          done.push(`Opened ${a.page}`)
        } else if (a.type === 'theme') {
          const app = useApp.getState()
          if ((a.mode === 'dark') !== app.dark) app.toggleDark()
          done.push(`${a.mode === 'dark' ? 'Dark' : 'Light'} mode`)
        }
      } catch { /* skip a failed action, keep going */ }
    }
    return done
  }

  /** One full turn: user text -> Leo thinks, acts, speaks. */
  async function think(text: string) {
    const q = text.trim()
    if (!q) { setPhase('idle'); return }
    setLines((l) => [...l, { who: 'you', text: q }])
    historyRef.current = [...historyRef.current, { role: 'user', content: q }]
    setPhase('thinking')
    try {
      const reply = await leoAgent(await buildContext(), historyRef.current)
      const done = await runActions(reply.actions)
      historyRef.current = [...historyRef.current, { role: 'assistant', content: JSON.stringify({ say: reply.say, lang: reply.lang, actions: reply.actions }) }]
      setLines((l) => [...l, { who: 'leo', text: reply.say, done }])
      if (!openRef.current) return
      // a navigation action closes the overlay so the user sees the page,
      // but Leo still answers out loud (hands-free won't re-open the mic)
      if (reply.actions.some((a) => a.type === 'open' || a.type === 'start_focus')) {
        setTimeout(() => { openRef.current = false; setOpen(false) }, 900)
      }
      setPhase('speaking')
      speech.play(reply.say, LANG_LABEL[reply.lang] ?? 'english')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setPhase('idle')
    }
  }

  async function startListening() {
    setError('')
    speech.stop()
    if (!voiceSupported()) { setError('Voice is not supported here — type your question below.'); return }
    try {
      const l = await listen(setLevel)
      listenerRef.current = l
      setPhase('listening')
      const clip = await l.done
      listenerRef.current = null
      setLevel(0)
      if (!clip.spoke) { setPhase('idle'); return }
      setPhase('thinking')
      const text = await transcribeVoice(clip.dataUrl)
      if (!text) { setError("I didn't catch that — try again."); setPhase('idle'); return }
      await think(text)
    } catch (e) {
      listenerRef.current = null
      setLevel(0)
      if (e instanceof Error && e.message === 'cancelled') return
      const msg = e instanceof Error ? e.message : String(e)
      setError(/NotAllowed|Permission|denied/i.test(msg)
        ? 'Microphone is blocked. Allow mic access for FocusLion, then try again.'
        : msg)
      setPhase('idle')
    }
  }

  // speaking finished -> back to idle, and in hands-free mode listen again
  // (via a ref so the subscription always calls the latest closure)
  const startRef = useRef(startListening)
  useEffect(() => { startRef.current = startListening })
  useEffect(() => speech.subscribe((s) => {
    if (s !== 'idle') return
    setPhase((p) => {
      if (p !== 'speaking') return p
      if (openRef.current && handsFreeRef.current) setTimeout(() => { if (openRef.current) startRef.current() }, 350)
      return 'idle'
    })
  }), [])

  // never leave the mic on if the component goes away
  useEffect(() => () => { listenerRef.current?.cancel() }, [])

  function onOrb() {
    if (phase === 'listening') listenerRef.current?.stop()
    else if (phase === 'speaking') { speech.stop(); setPhase('idle') }
    else if (phase === 'idle') startListening()
  }

  function toggleHandsFree() {
    setHandsFree((h) => {
      try { localStorage.setItem('fl:leo-handsfree', h ? '0' : '1') } catch { /* ignore */ }
      return !h
    })
  }

  if (!user) return null

  const status = {
    idle: 'Tap the orb and talk',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking — tap to stop',
  }[phase]

  return (
    <>
      {/* floating launcher — stacked above the Lion AI chat button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Leo Live voice assistant"
        className="fixed bottom-[calc(11.5rem+env(safe-area-inset-bottom))] left-5 z-[55] flex h-12 w-12 items-center justify-center rounded-full text-white shadow-xl transition active:scale-95 lg:bottom-24 lg:left-auto lg:right-7"
        style={{ background: 'radial-gradient(circle at 35% 30%,#7dd3fc,#2563eb 60%,#1e1b4b)', boxShadow: '0 8px 22px rgba(37,99,235,.45)' }}
      >
        <Mic size={20} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] flex flex-col text-white"
            style={{ background: 'radial-gradient(ellipse at 50% 30%,#0b2a5b 0%,#050b1f 55%,#02040c 100%)' }}
          >
            {/* top bar */}
            <div className="flex items-center justify-between px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
              <div>
                <div className="text-lg font-black tracking-wide">LEO LIVE</div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-sky-300/80">voice assistant</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={toggleHandsFree} title="Hands-free: keep listening after each answer"
                  className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    handsFree ? 'bg-sky-400/20 text-sky-200' : 'bg-white/5 text-white/50')}>
                  <Repeat size={13} /> Hands-free {handsFree ? 'on' : 'off'}
                </button>
                <button onClick={close} aria-label="Close" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* orb */}
            <div className="flex flex-col items-center pt-6">
              <button onClick={onOrb} aria-label={status} className="relative h-48 w-48 outline-none">
                <div ref={orbRef} className={cn('leo-orb absolute inset-0', `leo-${phase}`)}>
                  <span className="leo-ring leo-ring-1" />
                  <span className="leo-ring leo-ring-2" />
                  <span className="leo-ring leo-ring-3" />
                  <span className="leo-core" />
                </div>
                <span className="absolute inset-0 flex items-center justify-center text-5xl">🦁</span>
              </button>
              <div className="mt-5 h-5 text-sm font-semibold text-sky-200">{status}</div>
            </div>

            {/* conversation */}
            <div ref={scrollRef} className="mx-auto mt-4 w-full max-w-xl flex-1 space-y-3 overflow-y-auto px-5 pb-2">
              {lines.length === 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-center text-xs text-white/50">Try saying…</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => think(s)} disabled={phase === 'thinking'}
                        className="rounded-full border border-sky-300/20 bg-white/5 px-3 py-1.5 text-xs text-sky-100 hover:bg-white/10">
                        “{s}”
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {lines.map((l, i) => (
                <div key={i} className={l.who === 'you' ? 'text-right' : 'text-left'}>
                  <div className={cn('inline-block max-w-[90%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm',
                    l.who === 'you' ? 'bg-white/10 text-white/80' : 'bg-sky-500/15 text-sky-50')}>
                    {l.text}
                  </div>
                  {!!l.done?.length && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {l.done.map((d) => (
                        <span key={d} className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                          <Check size={11} /> {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {error && <p className="text-center text-xs font-semibold text-rose-300">{error}</p>}
            </div>

            {/* type instead of talking */}
            <form
              onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(''); if (phase !== 'thinking') { stopAll(); think(t) } }}
              className="mx-auto flex w-full max-w-xl items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2"
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type to Leo…"
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-sky-400/50" />
              <button type="submit" disabled={!typed.trim() || phase === 'thinking'}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500 text-white disabled:opacity-40">
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
