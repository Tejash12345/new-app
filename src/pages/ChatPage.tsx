import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Send, Trash2, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { GlassCard, Page, Input, Button } from '../components/ui'
import { cn } from '../lib/utils'

type ChatMessage = {
  id: string
  user_id: string
  room: string
  body: string
  author_name: string
  created_at: string
}

const ROOMS = [
  { key: 'general', label: 'General', emoji: '💬' },
  { key: 'study', label: 'Study Hall', emoji: '📚' },
  { key: 'motivation', label: 'Motivation', emoji: '🔥' },
  { key: 'exams', label: 'Exam Stress', emoji: '🎓' },
  { key: 'wins', label: 'Daily Wins', emoji: '🏆' },
]

function avatarColor(id: string) {
  const colors = ['#6C8CFF', '#FF6584', '#00BFA6', '#FFB454', '#A76CFF', '#42C7F5']
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}

export function ChatPage() {
  const { user, profile } = useAuth()
  const [room, setRoom] = useState('general')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [online, setOnline] = useState(0)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const myName = profile?.full_name?.trim() || 'Anonymous lion'

  // load history + subscribe to realtime for the active room
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    setMessages([])
    setTypingUsers([])

    supabase
      .from('chat_messages')
      .select('*')
      .eq('room', room)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled) {
          setMessages((data as ChatMessage[]) ?? [])
          setLoading(false)
        }
      })

    const channel = supabase.channel(`room-${room}`, {
      config: { presence: { key: user.id } },
    })

    channel
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room=eq.${room}` },
        (payload) => {
          setMessages((m) => {
            const msg = payload.new as ChatMessage
            if (m.some((x) => x.id === msg.id)) return m
            return [...m, msg]
          })
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          setMessages((m) => m.filter((x) => x.id !== (payload.old as { id: string }).id))
        })
      .on('presence', { event: 'sync' }, () => {
        setOnline(Object.keys(channel.presenceState()).length)
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const name = payload.name as string
        if (payload.userId === user.id) return
        setTypingUsers((t) => (t.includes(name) ? t : [...t, name]))
        setTimeout(() => setTypingUsers((t) => t.filter((n) => n !== name)), 2500)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ name: myName, at: Date.now() })
        }
      })

    channelRef.current = channel
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [room, user?.id, myName])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typingUsers])

  function broadcastTyping() {
    if (!channelRef.current || !user) return
    channelRef.current.send({
      type: 'broadcast', event: 'typing',
      payload: { userId: user.id, name: myName },
    })
  }

  function onType(v: string) {
    setInput(v)
    if (typingTimeout.current) clearTimeout(typingTimeout.current)
    broadcastTyping()
    typingTimeout.current = setTimeout(() => {}, 1500)
  }

  async function send() {
    const body = input.trim()
    if (!body || !user) return
    setInput('')
    // optimistic
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      user_id: user.id, room, body, author_name: myName,
      created_at: new Date().toISOString(),
    }
    setMessages((m) => [...m, optimistic])
    const { data } = await supabase
      .from('chat_messages')
      .insert({ user_id: user.id, room, body, author_name: myName })
      .select()
      .single()
    if (data) {
      setMessages((m) => m.map((x) => (x.id === optimistic.id ? (data as ChatMessage) : x)))
    }
  }

  async function remove(id: string) {
    setMessages((m) => m.filter((x) => x.id !== id))
    await supabase.from('chat_messages').delete().eq('id', id)
  }

  const grouped = useMemo(() => {
    return messages.map((m, i) => ({
      ...m,
      showHeader: i === 0 || messages[i - 1].user_id !== m.user_id,
    }))
  }, [messages])

  const activeRoom = ROOMS.find((r) => r.key === room)!

  return (
    <Page
      title="Community"
      subtitle="Study together, stay motivated — real-time chat with students everywhere. 🦁"
    >
      <div className="grid gap-5 lg:grid-cols-4">
        {/* room list */}
        <div className="lg:col-span-1">
          <GlassCard className="!p-3">
            <div className="mb-2 px-2 text-xs font-bold uppercase tracking-widest text-slate-400">Rooms</div>
            <div className="space-y-1">
              {ROOMS.map((r) => (
                <button key={r.key}
                  onClick={() => setRoom(r.key)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition',
                    room === r.key
                      ? 'bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg shadow-brand-500/30'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-500/10',
                  )}
                >
                  <span className="text-lg">{r.emoji}</span> {r.label}
                </button>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* chat window */}
        <GlassCard className="flex h-[36rem] flex-col lg:col-span-3">
          <div className="mb-3 flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
              <span className="text-xl">{activeRoom.emoji}</span> {activeRoom.label}
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <Users size={13} /> {online} online
            </div>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex h-full items-center justify-center text-3xl animate-pulse">🦁</div>
            ) : grouped.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="text-4xl">{activeRoom.emoji}</div>
                <p className="mt-2 text-sm text-slate-500">No messages yet in {activeRoom.label}.<br />Be the first to say hi! 👋</p>
              </div>
            ) : (
              grouped.map((m) => {
                const mine = m.user_id === user?.id
                return (
                  <div key={m.id} className={cn('group flex gap-2.5', mine && 'flex-row-reverse')}>
                    <div className="w-8 shrink-0">
                      {m.showHeader && (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ background: avatarColor(m.user_id) }}>
                          {m.author_name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className={cn('max-w-[75%]', mine && 'flex flex-col items-end')}>
                      {m.showHeader && (
                        <div className={cn('mb-0.5 px-1 text-xs font-semibold text-slate-500', mine && 'text-right')}>
                          {mine ? 'You' : m.author_name}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        {mine && (
                          <button onClick={() => remove(m.id)}
                            className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-rose-500">
                            <Trash2 size={13} />
                          </button>
                        )}
                        <div className={cn(
                          'rounded-2xl px-3.5 py-2 text-sm',
                          mine
                            ? 'rounded-br-md bg-gradient-to-r from-brand-500 to-brand-400 text-white'
                            : 'rounded-bl-md bg-white/60 dark:bg-white/10 text-slate-800 dark:text-slate-100',
                        )}>
                          {m.body}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}

            <AnimatePresence>
              {typingUsers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-1 py-1 text-xs text-slate-400"
                >
                  <div className="flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <motion.span key={d}
                        animate={{ y: [0, -3, 0] }}
                        transition={{ repeat: Infinity, duration: 0.7, delay: d * 0.15 }}
                        className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    ))}
                  </div>
                  {typingUsers.slice(0, 2).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          <div className="mt-3 flex gap-2">
            <Input
              placeholder={`Message ${activeRoom.label}…`}
              value={input}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              maxLength={500}
            />
            <Button onClick={send} disabled={!input.trim()}><Send size={16} /></Button>
          </div>
          <p className="mt-2 px-1 text-[11px] text-slate-400">
            Be kind 🦁 — this is a shared space for students. Messages are public to all FocusLion users.
          </p>
        </GlassCard>
      </div>
    </Page>
  )
}
