import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Trash2, Sparkles } from 'lucide-react'
import { AiLion } from './ui'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { askLionStream, type ChatTurn } from '../lib/ai'
import { cn } from '../lib/utils'

type Msg = ChatTurn

const QUICK: { label: string; prompt: string }[] = [
  { label: '💡 Productivity tip', prompt: 'Give me a productivity tip I can use right now.' },
  { label: '🧠 Explain code', prompt: 'Explain the concept of recursion with a tiny example.' },
  { label: '🚀 Startup idea', prompt: 'Suggest a startup idea for a student in tech.' },
  { label: '🔥 Motivate me', prompt: "I'm feeling unmotivated about studying. Help." },
  { label: '⚕️ Health (edu)', prompt: 'Explain why sleep matters for memory (educational only).' },
]

/**
 * Lion AI Assistant — a floating, app-wide button that opens a Lion AI-powered
 * chat (via the secure lion-ai Edge Function). Chat bubbles, typing animation,
 * loading state, persisted history, dark mode, lion-themed.
 */
export function LionAI() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const welcome: Msg = {
    role: 'assistant',
    content: "Hi! I'm Leo, your Lion AI Assistant 🦁 Ask me about tech, study plans, startup ideas, motivation — or tap a shortcut below.",
  }

  // lazy-load history the first time the panel opens
  useEffect(() => {
    if (!open || loaded || !user) return
    setLoaded(true)
    supabase
      .from('ai_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(40)
      .then(({ data }) => {
        const rows = (data as Msg[]) ?? []
        setMsgs(rows.length ? rows : [welcome])
      })
  }, [open, loaded, user])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, typing, open])

  async function persist(role: Msg['role'], content: string, task = 'chat') {
    if (!user) return
    await supabase.from('ai_messages').insert({ user_id: user.id, role, content, task })
  }

  async function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || typing) return
    setError('')
    setInput('')
    const history = [...msgs.filter((m) => m.content !== welcome.content), { role: 'user' as const, content: q }]
    setMsgs((m) => [...m, { role: 'user', content: q }])
    setTyping(true)
    persist('user', q)
    try {
      // stream the reply in: append a bubble on the first token, then grow it
      let acc = ''
      const reply = await askLionStream({ task: 'chat', messages: history }, (delta) => {
        acc += delta
        setMsgs((m) => {
          const last = m[m.length - 1]
          if (last?.role === 'assistant') {
            const copy = m.slice()
            copy[copy.length - 1] = { role: 'assistant', content: acc }
            return copy
          }
          return [...m, { role: 'assistant', content: acc }]
        })
      })
      const finalText = (reply || acc).trim() || '…'
      setMsgs((m) => {
        const last = m[m.length - 1]
        if (last?.role === 'assistant') {
          const copy = m.slice()
          copy[copy.length - 1] = { role: 'assistant', content: finalText }
          return copy
        }
        return [...m, { role: 'assistant', content: finalText }]
      })
      persist('assistant', finalText)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setTyping(false)
    }
  }

  async function clearChat() {
    setMsgs([welcome])
    if (user) await supabase.from('ai_messages').delete().eq('user_id', user.id)
  }

  return (
    <>
      {/* floating button — app-wide, sits above the mobile bottom nav */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Lion AI Assistant"
        // Bottom-LEFT on mobile so it never collides with the app-blocker shield
        // (which lives bottom-right in the Android wrapper); bottom-right on desktop.
        className="fixed bottom-[calc(7rem+env(safe-area-inset-bottom))] left-4 z-[55] flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-xl transition active:scale-95 lg:bottom-6 lg:left-auto lg:right-6"
        style={{ background: 'linear-gradient(135deg,#FFB454,#FF7A1A)', boxShadow: '0 8px 24px rgba(255,140,0,.45)' }}
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-25" />
        <span className="relative">{open ? '✕' : <AiLion className="h-9" />}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="fixed z-[56] flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900
                       inset-x-3 bottom-44 top-20
                       sm:inset-x-auto sm:right-4 sm:bottom-24 sm:top-auto sm:h-[32rem] sm:w-96 lg:bottom-24"
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <AiLion className="h-7" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">Lion AI Assistant</div>
                  <div className="flex items-center gap-1 text-[11px] text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Powered by Lion AI
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={clearChat} title="Clear chat" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-500/10 hover:text-rose-500">
                  <Trash2 size={15} />
                </button>
                <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-500/10">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* messages */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {msgs.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={m.role === 'user'
                    ? 'max-w-[82%] whitespace-pre-line break-words rounded-3xl rounded-br-lg bg-gradient-to-r from-brand-500 to-brand-400 px-3.5 py-2 text-sm text-white'
                    : 'max-w-[88%] whitespace-pre-line break-words rounded-3xl rounded-bl-lg bg-slate-100 px-3.5 py-2 text-sm text-slate-800 dark:bg-white/10 dark:text-slate-100'}>
                    {m.role === 'assistant' && <AiLion className="mr-1 h-5 align-text-bottom" />}{m.content}
                  </div>
                </motion.div>
              ))}
              {typing && msgs[msgs.length - 1]?.role === 'user' && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg bg-slate-100 px-4 py-3 dark:bg-white/10">
                    <AiLion className="mr-1 h-5" />
                    {[0, 1, 2].map((d) => (
                      <motion.span key={d} animate={{ y: [0, -4, 0] }}
                        transition={{ repeat: Infinity, duration: 0.7, delay: d * 0.15 }}
                        className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-center text-xs font-semibold text-rose-500">{error}</p>}
              <div ref={bottomRef} />
            </div>

            {/* quick actions */}
            <div className="flex gap-2 overflow-x-auto px-4 pb-2">
              {QUICK.map((q) => (
                <button key={q.label} onClick={() => send(q.prompt)} disabled={typing}
                  className="shrink-0 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-400/25 disabled:opacity-50 dark:text-amber-300">
                  {q.label}
                </button>
              ))}
            </div>

            {/* input */}
            <div className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-white/10">
              <input
                value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Ask Leo anything…"
                className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-amber-400/60 dark:border-white/10 dark:bg-white/5 dark:text-white" />
              <button onClick={() => send()} disabled={typing || !input.trim()}
                className={cn('flex h-9 w-9 items-center justify-center rounded-2xl text-white transition active:scale-95 disabled:opacity-40',
                  'bg-gradient-to-br from-amber-400 to-orange-500')}>
                {typing ? <Sparkles size={16} className="animate-pulse" /> : <Send size={16} />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
