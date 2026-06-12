import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Send, Trash2, Users, ArrowLeft, MessageCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { isOnline } from '../components/PresenceTracker'
import { GlassCard, Page, Input, Button, Empty } from '../components/ui'
import { cn } from '../lib/utils'

type DMessage = {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
}
type RoomMessage = {
  id: string
  user_id: string
  room: string
  body: string
  author_name: string
  created_at: string
}
type Friend = { friend_id: string; full_name: string; email: string; status: string; last_seen?: string }

function fname(f: Friend) {
  const n = (f.full_name || '').trim()
  if (n) return n
  return f.email ? f.email.split('@')[0] : 'Student'
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
function Avatar({ id, name, online, size = 11 }: { id: string; name: string; online?: boolean; size?: number }) {
  const px = size * 4
  return (
    <div className="relative shrink-0">
      <div className="flex items-center justify-center rounded-full font-bold text-white"
        style={{ background: avatarColor(id), height: px, width: px, fontSize: px * 0.4 }}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </div>
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />}
    </div>
  )
}

export function ChatPage() {
  const [mode, setMode] = useState<'friends' | 'rooms'>('friends')
  return (
    <Page title="Chat" subtitle="Message your friends privately, or join the student community. 🦁">
      <div className="mb-4 flex gap-2">
        {(['friends', 'rooms'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={cn('flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition',
              mode === m ? 'bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300')}>
            {m === 'friends' ? <><MessageCircle size={16} /> Friends</> : <><Users size={16} /> Community</>}
          </button>
        ))}
      </div>
      {mode === 'friends' ? <FriendsChat /> : <RoomsChat />}
    </Page>
  )
}

// ============ FRIEND DIRECT MESSAGES ============
function FriendsChat() {
  const { user } = useAuth()
  const [friends, setFriends] = useState<Friend[]>([])
  const [active, setActive] = useState<Friend | null>(null)
  const [messages, setMessages] = useState<DMessage[]>([])
  const [input, setInput] = useState('')
  const [, setTick] = useState(0)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // load friends + refresh periodically so last_seen (online) stays current
  useEffect(() => {
    if (!user) return
    const load = () => supabase.rpc('my_friends').then(({ data }) => {
      setFriends(((data as Friend[]) ?? []).filter((f) => f.status === 'accepted'))
    })
    load()
    const t = setInterval(load, 25_000)
    const tick = setInterval(() => setTick((n) => n + 1), 20_000)
    return () => { clearInterval(t); clearInterval(tick) }
  }, [user?.id])

  const pairKey = useMemo(() => {
    if (!user || !active) return ''
    return [user.id, active.friend_id].sort().join('__')
  }, [user?.id, active?.friend_id])

  // open a conversation: load history + subscribe to broadcast for instant delivery
  useEffect(() => {
    if (!user || !active) return
    let cancelled = false
    setMessages([])

    supabase
      .from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${user.id},recipient_id.eq.${active.friend_id}),and(sender_id.eq.${active.friend_id},recipient_id.eq.${user.id})`)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => { if (!cancelled) setMessages((data as DMessage[]) ?? []) })

    const channel = supabase.channel(`dm-${pairKey}`)
    channel
      .on('broadcast', { event: 'msg' }, ({ payload }) => {
        const m = payload as DMessage
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m])
      })
      .on('broadcast', { event: 'del' }, ({ payload }) => {
        setMessages((prev) => prev.filter((x) => x.id !== (payload as { id: string }).id))
      })
      .subscribe()
    channelRef.current = channel

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [pairKey])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const body = input.trim()
    if (!body || !user || !active) return
    setInput('')
    const optimistic: DMessage = {
      id: `tmp-${Date.now()}`, sender_id: user.id, recipient_id: active.friend_id,
      body, created_at: new Date().toISOString(),
    }
    setMessages((m) => [...m, optimistic])
    const { data, error } = await supabase
      .from('direct_messages')
      .insert({ sender_id: user.id, recipient_id: active.friend_id, body })
      .select().single()
    if (error) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id))
      return
    }
    const real = data as DMessage
    setMessages((m) => m.map((x) => (x.id === optimistic.id ? real : x)))
    // instant push to the other side
    channelRef.current?.send({ type: 'broadcast', event: 'msg', payload: real })
  }

  async function remove(id: string) {
    setMessages((m) => m.filter((x) => x.id !== id))
    await supabase.from('direct_messages').delete().eq('id', id)
    channelRef.current?.send({ type: 'broadcast', event: 'del', payload: { id } })
  }

  // mobile: show list OR thread
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className={cn('lg:col-span-1', active && 'hidden lg:block')}>
        <GlassCard className="!p-3">
          <div className="mb-2 px-2 text-xs font-bold uppercase tracking-widest text-slate-400">Friends</div>
          {friends.length === 0 ? (
            <Empty emoji="🤝" text={'No friends yet.\nAdd friends in the Friends page to chat!'} />
          ) : (
            <div className="space-y-1">
              {friends
                .slice()
                .sort((a, b) => (isOnline(b.last_seen) ? 1 : 0) - (isOnline(a.last_seen) ? 1 : 0))
                .map((f) => {
                  const online = isOnline(f.last_seen)
                  return (
                    <button key={f.friend_id} onClick={() => setActive(f)}
                      className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition',
                        active?.friend_id === f.friend_id ? 'bg-brand-500/15' : 'hover:bg-slate-500/10')}>
                      <Avatar id={f.friend_id} name={fname(f)} online={online} size={9} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{fname(f)}</div>
                        <div className={cn('text-xs', online ? 'font-semibold text-emerald-500' : 'text-slate-400')}>
                          {online ? '● Online' : 'Offline'}
                        </div>
                      </div>
                    </button>
                  )
                })}
            </div>
          )}
        </GlassCard>
      </div>

      <GlassCard className={cn('flex h-[34rem] flex-col lg:col-span-2', !active && 'hidden lg:flex')}>
        {!active ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-4xl">💬</div>
            <p className="mt-2 text-sm text-slate-500">Pick a friend to start chatting.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-3">
              <button onClick={() => setActive(null)} className="lg:hidden text-slate-500"><ArrowLeft size={20} /></button>
              <Avatar id={active.friend_id} name={fname(active)} online={isOnline(active.last_seen)} size={9} />
              <div>
                <div className="font-bold text-slate-900 dark:text-white">{fname(active)}</div>
                <div className={cn('text-xs', isOnline(active.last_seen) ? 'font-semibold text-emerald-500' : 'text-slate-400')}>
                  {isOnline(active.last_seen) ? '● Online now' : 'Offline'}
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
                  Say hi to {fname(active).split(' ')[0]}! 👋
                </div>
              ) : messages.map((m) => {
                const mine = m.sender_id === user?.id
                return (
                  <div key={m.id} className={cn('group flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className="flex items-center gap-1.5">
                      {mine && (
                        <button onClick={() => remove(m.id)} className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-rose-500">
                          <Trash2 size={13} />
                        </button>
                      )}
                      <div className={cn('max-w-[78vw] sm:max-w-md rounded-2xl px-3.5 py-2 text-sm',
                        mine ? 'rounded-br-md bg-gradient-to-r from-brand-500 to-brand-400 text-white'
                             : 'rounded-bl-md bg-white/60 dark:bg-white/10 text-slate-800 dark:text-slate-100')}>
                        {m.body}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            <div className="mt-3 flex gap-2">
              <Input placeholder={`Message ${fname(active).split(' ')[0]}…`} value={input}
                onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} maxLength={500} />
              <Button onClick={send} disabled={!input.trim()}><Send size={16} /></Button>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}

// ============ COMMUNITY ROOMS ============
function RoomsChat() {
  const { user, profile } = useAuth()
  const [room, setRoom] = useState('general')
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [input, setInput] = useState('')
  const [online, setOnline] = useState(1)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const myName = profile?.full_name?.trim() || 'Anonymous lion'

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setMessages([])

    supabase.from('chat_messages').select('*').eq('room', room)
      .order('created_at', { ascending: true }).limit(100)
      .then(({ data }) => { if (!cancelled) setMessages((data as RoomMessage[]) ?? []) })

    const channel = supabase.channel(`room-${room}`, { config: { presence: { key: user.id } } })
    channel
      .on('broadcast', { event: 'msg' }, ({ payload }) => {
        const m = payload as RoomMessage
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m])
      })
      .on('broadcast', { event: 'del' }, ({ payload }) => {
        setMessages((prev) => prev.filter((x) => x.id !== (payload as { id: string }).id))
      })
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(channel.presenceState()).length))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ name: myName })
      })
    channelRef.current = channel
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [room, user?.id, myName])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const body = input.trim()
    if (!body || !user) return
    setInput('')
    const optimistic: RoomMessage = {
      id: `tmp-${Date.now()}`, user_id: user.id, room, body, author_name: myName,
      created_at: new Date().toISOString(),
    }
    setMessages((m) => [...m, optimistic])
    const { data } = await supabase.from('chat_messages')
      .insert({ user_id: user.id, room, body, author_name: myName }).select().single()
    if (data) {
      const real = data as RoomMessage
      setMessages((m) => m.map((x) => (x.id === optimistic.id ? real : x)))
      channelRef.current?.send({ type: 'broadcast', event: 'msg', payload: real })
    }
  }
  async function remove(id: string) {
    setMessages((m) => m.filter((x) => x.id !== id))
    await supabase.from('chat_messages').delete().eq('id', id)
    channelRef.current?.send({ type: 'broadcast', event: 'del', payload: { id } })
  }

  const activeRoom = ROOMS.find((r) => r.key === room)!
  const grouped = messages.map((m, i) => ({ ...m, showHeader: i === 0 || messages[i - 1].user_id !== m.user_id }))

  return (
    <div className="grid gap-5 lg:grid-cols-4">
      <div className="lg:col-span-1">
        <GlassCard className="!p-3">
          <div className="mb-2 px-2 text-xs font-bold uppercase tracking-widest text-slate-400">Rooms</div>
          <div className="space-y-1">
            {ROOMS.map((r) => (
              <button key={r.key} onClick={() => setRoom(r.key)}
                className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition',
                  room === r.key ? 'bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg shadow-brand-500/30' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-500/10')}>
                <span className="text-lg">{r.emoji}</span> {r.label}
              </button>
            ))}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="flex h-[34rem] flex-col lg:col-span-3">
        <div className="mb-3 flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <span className="text-xl">{activeRoom.emoji}</span> {activeRoom.label}
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {online} online
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          {grouped.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-4xl">{activeRoom.emoji}</div>
              <p className="mt-2 text-sm text-slate-500">No messages yet. Be the first! 👋</p>
            </div>
          ) : grouped.map((m) => {
            const mine = m.user_id === user?.id
            return (
              <div key={m.id} className={cn('group flex gap-2.5', mine && 'flex-row-reverse')}>
                <div className="w-8 shrink-0">
                  {m.showHeader && <Avatar id={m.user_id} name={m.author_name} size={8} />}
                </div>
                <div className={cn('max-w-[72vw] sm:max-w-[75%]', mine && 'flex flex-col items-end')}>
                  {m.showHeader && <div className={cn('mb-0.5 px-1 text-xs font-semibold text-slate-500', mine && 'text-right')}>{mine ? 'You' : m.author_name}</div>}
                  <div className="flex items-center gap-1.5">
                    {mine && <button onClick={() => remove(m.id)} className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-rose-500"><Trash2 size={13} /></button>}
                    <div className={cn('rounded-2xl px-3.5 py-2 text-sm',
                      mine ? 'rounded-br-md bg-gradient-to-r from-brand-500 to-brand-400 text-white' : 'rounded-bl-md bg-white/60 dark:bg-white/10 text-slate-800 dark:text-slate-100')}>
                      {m.body}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
        <div className="mt-3 flex gap-2">
          <Input placeholder={`Message ${activeRoom.label}…`} value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} maxLength={500} />
          <Button onClick={send} disabled={!input.trim()}><Send size={16} /></Button>
        </div>
      </GlassCard>
    </div>
  )
}
