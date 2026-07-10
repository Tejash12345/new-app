import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Send, Trash2, Users, ArrowLeft, MessageCircle, Image as ImageIcon, Paperclip, Mic, X, FileText, Play, Newspaper, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getSocket } from '../lib/socket'
import { smartReplies } from '../lib/ai'
import { Lightbox } from '../components/Lightbox'
import { confirmDialog, useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { useAvatars } from '../hooks/useAvatars'
import { StoryRing } from '../components/Stories'
import { useOnlineCheck } from '../hooks/useOnline'
import { GlassCard, Page, Input, Button, Empty } from '../components/ui'
import { cn } from '../lib/utils'

type DMessage = {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
  kind?: 'text' | 'image' | 'audio' | 'file' | 'post'
  file_url?: string | null
  file_name?: string | null
}
type RoomMessage = {
  id: string
  user_id: string
  room: string
  body: string
  author_name: string
  author_avatar_url?: string
  created_at: string
}
type Friend = { friend_id: string; full_name: string; email: string; avatar_url?: string; status: string; last_seen?: string }

function fname(f: Friend) {
  const n = (f.full_name || '').trim()
  if (n) return n
  return f.email ? f.email.split('@')[0] : 'Student'
}

// WhatsApp-style timestamps: a small time on every bubble, and a centered
// Today / Yesterday / weekday / date chip whenever the day changes.
function msgTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function dayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function isNewDay(prev: string | undefined, cur: string) {
  return !prev || new Date(prev).toDateString() !== new Date(cur).toDateString()
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
function Avatar({ id, name, url, online, size = 11 }: { id: string; name: string; url?: string | null; online?: boolean; size?: number }) {
  const px = size * 4
  return (
    <div className="relative shrink-0">
      <StoryRing userId={id}>
        <div className="flex items-center justify-center overflow-hidden rounded-full font-bold text-white"
          style={{ background: avatarColor(id), height: px, width: px, fontSize: px * 0.4 }}>
          {url
            ? <img src={url} alt="" className="h-full w-full object-cover" />
            : (name || '?').slice(0, 1).toUpperCase()}
        </div>
      </StoryRing>
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />}
    </div>
  )
}

// A feed post shared into a DM (sent from the Feed's "Send" button).
// The rich preview is built from JSON metadata stashed on file_name; tapping
// it opens the exact post in the Feed.
type SharedPostMeta = {
  id: string
  title?: string
  type?: string
  media_url?: string | null
  author_name?: string
  category?: string
}
function SharedPostBubble({ m, mine, onOpen }: { m: DMessage; mine: boolean; onOpen: (id: string) => void }) {
  const meta: SharedPostMeta | null = (() => {
    try { return m.file_name ? (JSON.parse(m.file_name) as SharedPostMeta) : null } catch { return null }
  })()
  const id = meta?.id
  const title = meta?.title || (m.body || '').replace(/^Shared:\s*/, '') || 'a post'
  const type = meta?.type || 'post'
  const note = m.body && !/^Shared/.test(m.body) ? m.body : null

  return (
    <div className={cn('max-w-[78vw] sm:max-w-md', mine && 'flex flex-col items-end')}>
      {/* optional note typed alongside the share */}
      {note && (
        <div className={cn('mb-1 rounded-2xl px-3.5 py-2 text-sm',
          mine ? 'rounded-br-md bg-gradient-to-r from-brand-500 to-brand-400 text-white'
               : 'rounded-bl-md bg-white/60 dark:bg-white/10 text-slate-800 dark:text-slate-100')}>
          {note}
        </div>
      )}
      <button
        onClick={() => id ? onOpen(id) : m.file_url && window.open(m.file_url, '_blank')}
        className="flex w-64 max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-slate-200/60 bg-white/70 p-2 text-left transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">
        {meta?.media_url && type === 'post' ? (
          <img src={meta.media_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
        ) : type === 'reel' ? (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black/80 text-white"><Play size={20} /></span>
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-500"><Newspaper size={20} /></span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wide text-brand-500">Shared post · {type}</div>
          <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{title}</div>
          {meta?.author_name && <div className="truncate text-xs text-slate-400">by {meta.author_name}</div>}
        </div>
      </button>
    </div>
  )
}

export function ChatPage() {
  const { pathname } = useLocation()
  // open straight to the right view: /community shows the public rooms; every
  // other entry (/chat and the DM notification deep-links) opens your private
  // Friends messages. The in-page toggle still switches between the two.
  const [mode, setMode] = useState<'friends' | 'rooms'>(pathname.startsWith('/community') ? 'rooms' : 'friends')
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
type Person = { id: string; full_name: string; email: string; avatar_url?: string; last_seen?: string }

function pname(p: Person) {
  const n = (p.full_name || '').trim()
  if (n) return n
  return p.email ? p.email.split('@')[0] : 'Student'
}

/** "last seen 5 mins ago" style label from a heartbeat timestamp. */
function lastSeenLabel(lastSeen?: string | null) {
  if (!lastSeen) return 'Offline'
  const mins = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000)
  if (mins < 1) return 'last seen just now'
  if (mins < 60) return `last seen ${mins} min${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `last seen ${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `last seen ${days} day${days === 1 ? '' : 's'} ago`
  return 'last seen a while ago'
}

function FriendsChat() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isOnline = useOnlineCheck()
  const avatarFor = useAvatars()
  const [friends, setFriends] = useState<Friend[]>([])
  const [active, setActive] = useState<Friend | null>(null)
  const [messages, setMessages] = useState<DMessage[]>([])
  const [input, setInput] = useState('')
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [sendError, setSendError] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({})
  const [people, setPeople] = useState<Person[]>([])
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [, setTick] = useState(0)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const lastTypingSent = useRef(0)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const recDiscardRef = useRef(false)
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function markTyping(from: string) {
    setTypingUsers((t) => ({ ...t, [from]: true }))
    clearTimeout(typingTimers.current[from])
    typingTimers.current[from] = setTimeout(
      () => setTypingUsers((t) => ({ ...t, [from]: false })), 2500)
  }

  // incoming-DM notifications now live in a single app-wide subscription
  // (useDMNotifications in Layout) so they fire on every page, not just here.
  // We just keep the store's "active conversation" in sync so that notifier
  // skips the chat you're currently looking at.
  useEffect(() => {
    activeIdRef.current = active?.friend_id ?? null
    useApp.getState().setActiveChatPeer(active?.friend_id ?? null)
    // opening a thread reads it: clear the Chat nav badge and persist read_at
    // server-side (upgrade-28) so the badge stays correct across reloads/devices
    if (active?.friend_id) {
      useApp.getState().clearChatUnread(active.friend_id)
      supabase.rpc('mark_dms_read', { peer: active.friend_id }).then(() => {}, () => {})
    }
  }, [active?.friend_id])
  useEffect(() => () => { useApp.getState().setActiveChatPeer(null) }, [])

  // deep link from the Feed profile sheet: /chat?dm=<id>&n=<name> opens that
  // conversation directly. Prefer the loaded friend record (avatar/last_seen),
  // else open a minimal thread so messaging works the moment you're friends.
  const dmParam = searchParams.get('dm')
  useEffect(() => {
    if (!dmParam || !user) return
    const existing = friends.find((x) => x.friend_id === dmParam)
    setActive(existing ?? {
      friend_id: dmParam, full_name: searchParams.get('n') ?? '', email: '', status: 'accepted',
    })
    setUnread((u) => ({ ...u, [dmParam]: 0 }))
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmParam, friends])

  // people you may know — visible right in chat, no searching needed
  useEffect(() => {
    if (!user) return
    supabase.rpc('suggested_users').then(({ data }) => {
      setPeople(((data as Person[]) ?? []).slice(0, 8))
    })
  }, [user?.id, friends.length])

  async function addPerson(id: string) {
    if (!user) return
    const { error } = await supabase.rpc('send_friend_request', { target: id })
    if (error) {
      // database without upgrade-7 yet — plain insert still works
      const { error: e2 } = await supabase
        .from('friendships').insert({ requester_id: user.id, addressee_id: id })
      if (e2) return
    }
    setSentTo((s) => new Set(s).add(id))
  }

  // inbox: every incoming DM is delivered straight from the database, even if
  // this thread (or no thread) is open — no need for the sender's broadcast
  useEffect(() => {
    if (!user) return
    const inbox = supabase
      .channel(`dm-inbox-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          const m = payload.new as DMessage
          if (activeIdRef.current === m.sender_id) {
            setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
          } else {
            setUnread((u) => ({ ...u, [m.sender_id]: (u[m.sender_id] ?? 0) + 1 }))
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(inbox) }
  }, [user?.id])

  // socket.io fast path: when the chat server is configured, messages, typing
  // and deletes arrive through it instantly (database delivery stays as backup)
  useEffect(() => {
    if (!user) return
    const s = getSocket()
    if (!s) return
    const onDm = (m: DMessage) => {
      if (m.recipient_id !== user.id) return
      if (activeIdRef.current === m.sender_id) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
      } else {
        setUnread((u) => ({ ...u, [m.sender_id]: (u[m.sender_id] ?? 0) + 1 }))
      }
    }
    const onDel = (p: { id: string }) => setMessages((prev) => prev.filter((x) => x.id !== p.id))
    const onTyping = (p: { from: string }) => markTyping(p.from)
    s.on('dm', onDm)
    s.on('dm:del', onDel)
    s.on('typing', onTyping)
    return () => {
      s.off('dm', onDm)
      s.off('dm:del', onDel)
      s.off('typing', onTyping)
    }
  }, [user?.id])

  // load friends + refresh periodically so last_seen (online) stays current
  useEffect(() => {
    if (!user) return
    const load = () => supabase.rpc('my_friends').then(({ data }) => {
      setFriends(((data as Friend[]) ?? []).filter((f) => f.status === 'accepted'))
    })
    load()
    const t = setInterval(load, 15_000)
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
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const from = (payload as { from: string }).from
        if (from !== user.id) markTyping(from)
      })
      .subscribe()
    channelRef.current = channel

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [pairKey])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send(textOverride?: string) {
    const body = (textOverride ?? input).trim()
    if (!body || !user || !active) return
    setInput('')
    setSuggestions([])
    setSendError(null)
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
      setInput(body) // give the text back so nothing is lost
      setSendError(
        /row-level security|policy/i.test(error.message)
          ? `Not sent — you and ${fname(active)} need to be accepted friends first. Check the Friends page.`
          : `Not sent: ${error.message}`,
      )
      return
    }
    const real = data as DMessage
    setMessages((m) => m.map((x) => (x.id === optimistic.id ? real : x)))
    // instant push to the other side — socket.io first, channel broadcast too
    getSocket()?.emit('dm', real)
    channelRef.current?.send({ type: 'broadcast', event: 'msg', payload: real })
  }

  async function remove(id: string) {
    setMessages((m) => m.filter((x) => x.id !== id))
    await supabase.from('direct_messages').delete().eq('id', id)
    if (active) getSocket()?.emit('dm:del', { id, to: active.friend_id })
    channelRef.current?.send({ type: 'broadcast', event: 'del', payload: { id } })
  }

  async function confirmRemove(m: DMessage) {
    const what =
      m.kind === 'image' ? 'this photo'
      : m.kind === 'audio' ? 'this voice message'
      : m.kind === 'file' ? 'this file'
      : m.kind === 'post' ? 'this shared post'
      : 'this message'
    if (await confirmDialog(`Delete ${what}? It disappears for both of you.`, { yesLabel: 'Delete', noLabel: 'Cancel' })) {
      remove(m.id)
    }
  }

  // ---- photos, documents, voice notes ----

  async function sendMedia(file: File, kind: 'image' | 'audio' | 'file') {
    if (!user || !active) return
    if (file.size > 10 * 1024 * 1024) {
      setSendError('File is too big — maximum is 10 MB.')
      return
    }
    setUploading(true)
    setSendError(null)
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `${user.id}/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from('chat-media')
      .upload(path, file, { contentType: file.type || undefined })
    if (upErr) {
      setUploading(false)
      setSendError(
        /bucket.*not.*found/i.test(upErr.message)
          ? 'Media is not set up yet — run upgrade-8.sql in the Supabase SQL Editor first.'
          : `Upload failed: ${upErr.message}`,
      )
      return
    }
    const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path)
    const { data, error } = await supabase
      .from('direct_messages')
      .insert({
        sender_id: user.id, recipient_id: active.friend_id,
        body: kind === 'file' ? file.name : '',
        kind, file_url: pub.publicUrl, file_name: file.name,
      })
      .select().single()
    setUploading(false)
    if (error) {
      setSendError(
        /row-level security|policy/i.test(error.message)
          ? `Not sent — you and ${fname(active)} need to be accepted friends first.`
          : `Not sent: ${error.message}`,
      )
      return
    }
    const real = data as DMessage
    setMessages((m) => [...m, real])
    getSocket()?.emit('dm', real)
    channelRef.current?.send({ type: 'broadcast', event: 'msg', payload: real })
  }

  async function startRecording() {
    if (recording) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSendError('Voice recording is not supported here — please update the FocusLion app / your browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Android WebViews are picky about the container: probe for a supported
      // mime type instead of trusting the default (an unsupported default
      // throws NotSupportedError on some devices → "mic doesn't work")
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((t) => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } })
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recChunksRef.current = []
      recDiscardRef.current = false
      mr.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recDiscardRef.current) return
        const type = mr.mimeType || mime || 'audio/webm'
        const blob = new Blob(recChunksRef.current, { type })
        if (blob.size < 200) {
          setSendError('That recording was too short — hold on a moment before sending.')
          return
        }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        sendMedia(new File([blob], `voice-message.${ext}`, { type: blob.type }), 'audio')
      }
      // 1s timeslice: chunks flush as we go, so a hiccup at stop can't lose
      // the whole recording on flaky Android MediaRecorder builds
      mr.start(1000)
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecSeconds(0)
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000)
    } catch (e) {
      // distinguish "no permission" from "no mic / busy" so the message is
      // actionable — on Android, denied/dismissed lands here as NotAllowedError
      const name = e instanceof DOMException ? e.name : ''
      setSendError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone blocked. Enable it: Android Settings → Apps → FocusLion → Permissions → Microphone → Allow.'
          : name === 'NotFoundError'
          ? 'No microphone found on this device.'
          : name === 'NotReadableError' || name === 'AbortError'
          ? 'The microphone is busy or unavailable — close other apps using it, or update the FocusLion app and try again.'
          : 'Could not start recording — check the microphone is free and permission is allowed.',
      )
    }
  }

  function stopRecording(sendIt: boolean) {
    recDiscardRef.current = !sendIt
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    setRecording(false)
  }

  // ---- AI smart replies (Leo suggests what to say next) ----

  // suggestions belong to one conversation — drop them when switching threads
  useEffect(() => { setSuggestions([]) }, [active?.friend_id])

  async function suggestReplies() {
    if (!user || !active || suggestBusy || messages.length === 0) return
    setSuggestBusy(true)
    setSendError(null)
    try {
      const meName = 'Me'
      const friendName = fname(active).split(' ')[0] || 'Friend'
      const convo = messages.slice(-10).map((m) => {
        const who = m.sender_id === user.id ? meName : friendName
        const what = m.kind && m.kind !== 'text'
          ? (m.kind === 'image' ? '[sent a photo]' : m.kind === 'audio' ? '[sent a voice message]' : m.kind === 'post' ? '[shared a post]' : `[sent ${m.file_name ?? 'a file'}]`)
          : m.body
        return `${who}: ${what}`
      }).join('\n')
      const replies = await smartReplies(convo)
      if (replies.length === 0) setSendError('Leo could not think of a reply — try again.')
      setSuggestions(replies)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not get suggestions.')
    } finally {
      setSuggestBusy(false)
    }
  }

  // mobile: show list OR thread
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className={cn('lg:col-span-1', active && 'hidden lg:block')}>
        <GlassCard className="!p-3">
          <div className="mb-2 px-2 text-xs font-bold uppercase tracking-widest text-slate-400">Friends</div>
          {friends.length === 0 ? (
            <Empty emoji="🤝" text={'No friends yet.\nAdd friends in the Friends page to chat!'} />
          ) : (
            <div className="space-y-1">
              {friends
                .slice()
                .sort((a, b) => {
                  const ub = (unread[b.friend_id] ?? 0) - (unread[a.friend_id] ?? 0)
                  if (ub !== 0) return ub
                  return (isOnline(b.friend_id, b.last_seen) ? 1 : 0) - (isOnline(a.friend_id, a.last_seen) ? 1 : 0)
                })
                .map((f) => {
                  const online = isOnline(f.friend_id, f.last_seen)
                  const count = unread[f.friend_id] ?? 0
                  return (
                    <button key={f.friend_id}
                      onClick={() => {
                        setActive(f)
                        setSendError(null)
                        setUnread((u) => ({ ...u, [f.friend_id]: 0 }))
                      }}
                      className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition',
                        active?.friend_id === f.friend_id ? 'bg-brand-500/15' : 'hover:bg-slate-500/10')}>
                      <Avatar id={f.friend_id} name={fname(f)} url={avatarFor(f.friend_id) || f.avatar_url} online={online} size={9} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{fname(f)}</div>
                        {typingUsers[f.friend_id] ? (
                          <div className="text-xs font-semibold text-brand-500 animate-pulse">typing…</div>
                        ) : (
                          <div className={cn('text-xs', online ? 'font-semibold text-emerald-500' : 'text-slate-400')}>
                            {online ? '● Online' : lastSeenLabel(f.last_seen)}
                          </div>
                        )}
                      </div>
                      {count > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
                          {count > 9 ? '9+' : count}
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          )}

          {/* people you may know — add friends right from chat, no searching */}
          {people.length > 0 && (
            <>
              <div className="mb-2 mt-4 px-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                People you may know
              </div>
              <div className="space-y-1">
                {people.map((p) => {
                  const online = isOnline(p.id, p.last_seen)
                  const sent = sentTo.has(p.id)
                  return (
                    <div key={p.id} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2">
                      <Avatar id={p.id} name={pname(p)} url={avatarFor(p.id) || p.avatar_url} online={online} size={9} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{pname(p)}</div>
                        <div className={cn('text-xs', online ? 'font-semibold text-emerald-500' : 'text-slate-400')}>
                          {online ? '● Online' : 'Student'}
                        </div>
                      </div>
                      {sent ? (
                        <span className="text-xs font-semibold text-emerald-500">Sent ✓</span>
                      ) : (
                        <button onClick={() => addPerson(p.id)}
                          className="rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-bold text-brand-500 hover:bg-brand-500/25">
                          + Add
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
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
              {(() => {
                // use the freshest record (friends reload every 15s) so last_seen is current
                const fresh = friends.find((f) => f.friend_id === active.friend_id) ?? active
                const on = isOnline(active.friend_id, fresh.last_seen)
                return (
                  <>
                    <Avatar id={active.friend_id} name={fname(active)} url={avatarFor(active.friend_id) || active.avatar_url} online={on} size={9} />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{fname(active)}</div>
                      {typingUsers[active.friend_id] ? (
                        <div className="text-xs font-semibold text-brand-500 animate-pulse">typing…</div>
                      ) : (
                        <div className={cn('text-xs', on ? 'font-semibold text-emerald-500' : 'text-slate-400')}>
                          {on ? '● Online now' : lastSeenLabel(fresh.last_seen)}
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
                  Say hi to {fname(active).split(' ')[0]}! 👋
                </div>
              ) : messages.map((m, i) => {
                const mine = m.sender_id === user?.id
                const time = msgTime(m.created_at)
                return (
                  <Fragment key={m.id}>
                    {isNewDay(messages[i - 1]?.created_at, m.created_at) && (
                      <div className="flex justify-center py-1.5">
                        <span className="rounded-full bg-slate-500/10 px-3 py-1 text-[11px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                          {dayLabel(m.created_at)}
                        </span>
                      </div>
                    )}
                    <div className={cn('group flex items-end gap-1.5', mine ? 'justify-end' : 'justify-start')}>
                    {!mine && <Avatar id={active.friend_id} name={fname(active)} url={avatarFor(active.friend_id) || active.avatar_url} size={7} />}
                    <div className="flex items-center gap-1.5">
                      {mine && (
                        // always visible on touch — hover-reveal only works on
                        // desktop, so a hidden control is unreachable on Android
                        <button onClick={() => confirmRemove(m)} aria-label="Delete message"
                          className="shrink-0 p-1.5 text-slate-400 transition hover:text-rose-500 lg:opacity-0 lg:group-hover:opacity-100">
                          <Trash2 size={14} />
                        </button>
                      )}
                      {m.kind === 'post' ? (
                        <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                          <SharedPostBubble m={m} mine={mine} onOpen={(id) => navigate(`/feed?post=${id}`)} />
                          <span className="mt-0.5 px-1 text-[10px] text-slate-400">{time}</span>
                        </div>
                      ) : (
                      <div className={cn('max-w-[78vw] sm:max-w-md rounded-2xl text-sm',
                        m.kind === 'image' && m.file_url ? 'overflow-hidden p-1' : 'px-3.5 py-2',
                        mine ? 'rounded-br-md bg-gradient-to-r from-brand-500 to-brand-400 text-white'
                             : 'rounded-bl-md bg-white/60 dark:bg-white/10 text-slate-800 dark:text-slate-100')}>
                        {m.kind === 'image' && m.file_url ? (
                          <>
                            {/* in-app viewer — a plain link navigates the whole
                                WebView to the raw file (zoomed wrong, no way back) */}
                            <button type="button" onClick={() => setLightbox({ src: m.file_url!, name: m.file_name ?? undefined })}>
                              <img src={m.file_url} alt={m.file_name ?? 'photo'} loading="lazy"
                                className="max-h-64 rounded-xl object-contain" />
                            </button>
                            <div className={cn('px-1.5 pb-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-slate-400')}>{time}</div>
                          </>
                        ) : m.kind === 'audio' && m.file_url ? (
                          <>
                            <audio controls preload="metadata" src={m.file_url} className="h-10 w-56 max-w-full" />
                            <div className={cn('mt-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-slate-400')}>{time}</div>
                          </>
                        ) : m.kind === 'file' && m.file_url ? (
                          <>
                            <a href={m.file_url} target="_blank" rel="noreferrer" download={m.file_name ?? true}
                              className="flex items-center gap-2 font-semibold underline underline-offset-2">
                              <FileText size={17} className="shrink-0" />
                              <span className="truncate">{m.file_name ?? 'Document'}</span>
                            </a>
                            <div className={cn('mt-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-slate-400')}>{time}</div>
                          </>
                        ) : (
                          <>
                            {m.body}
                            {/* WhatsApp-style inline time, bottom-right of the bubble */}
                            <span className={cn('float-right ml-2 mt-1.5 text-[10px] leading-none', mine ? 'text-white/70' : 'text-slate-400')}>{time}</span>
                          </>
                        )}
                      </div>
                      )}
                    </div>
                    </div>
                  </Fragment>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {sendError && (
              <div className="mt-2 rounded-2xl bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-500">
                {sendError}
              </div>
            )}
            {uploading && (
              <div className="mt-2 animate-pulse text-xs font-semibold text-slate-400">Uploading…</div>
            )}
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Sparkles size={14} className="shrink-0 text-brand-500" />
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)}
                    className="max-w-full truncate rounded-full border border-brand-400/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-500/20 dark:text-brand-300">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {recording ? (
              <div className="mt-3 flex items-center gap-3 rounded-2xl bg-rose-500/10 px-4 py-2.5">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                <span className="flex-1 text-sm font-semibold text-rose-500">
                  Recording… {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}
                </span>
                <button onClick={() => stopRecording(false)} title="Cancel"
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-500/10 hover:text-rose-500">
                  <X size={18} />
                </button>
                <Button onClick={() => stopRecording(true)}><Send size={16} /></Button>
              </div>
            ) : (
              // WhatsApp-style composer: one big pill with the actions visible
              // inside it, and a round button that is Mic when empty / Send
              // once you start typing
              <div className="mt-3 flex items-center gap-2">
                <input ref={imageInputRef} type="file" accept="image/*" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) sendMedia(f, 'image'); e.target.value = '' }} />
                <input ref={fileInputRef} type="file" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) sendMedia(f, 'file'); e.target.value = '' }} />
                <div className="flex min-w-0 flex-1 items-center rounded-full border border-slate-200/60 bg-white/70 px-1.5 dark:border-white/10 dark:bg-white/10">
                  <button onClick={suggestReplies} title="Leo suggests replies" disabled={suggestBusy || messages.length === 0}
                    className={cn('shrink-0 rounded-full p-2 text-slate-400 transition hover:text-brand-500 disabled:opacity-40',
                      suggestBusy && 'animate-pulse text-brand-500')}>
                    <Sparkles size={21} />
                  </button>
                  <input
                    className="min-w-0 flex-1 bg-transparent px-1.5 py-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
                    placeholder="Message…" value={input} maxLength={500}
                    onChange={(e) => {
                      setInput(e.target.value)
                      const now = Date.now()
                      if (user && active && now - lastTypingSent.current > 1200) {
                        lastTypingSent.current = now
                        getSocket()?.emit('typing', { to: active.friend_id })
                        channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { from: user.id } })
                      }
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && send()} />
                  <button onClick={() => fileInputRef.current?.click()} title="Send a document" disabled={uploading}
                    className="shrink-0 rounded-full p-2 text-slate-400 transition hover:text-brand-500 disabled:opacity-40">
                    <Paperclip size={21} />
                  </button>
                  <button onClick={() => imageInputRef.current?.click()} title="Send a photo" disabled={uploading}
                    className="shrink-0 rounded-full p-2 text-slate-400 transition hover:text-brand-500 disabled:opacity-40">
                    <ImageIcon size={21} />
                  </button>
                </div>
                <button
                  onClick={() => (input.trim() ? send() : startRecording())}
                  disabled={uploading}
                  aria-label={input.trim() ? 'Send message' : 'Record a voice message'}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30 transition active:scale-95 disabled:opacity-50"
                >
                  {input.trim() ? <Send size={20} /> : <Mic size={22} />}
                </button>
              </div>
            )}
          </>
        )}
      </GlassCard>
      {lightbox && <Lightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />}
    </div>
  )
}

// ============ COMMUNITY ROOMS ============
function RoomsChat() {
  const { user, profile } = useAuth()
  const avatarFor = useAvatars()
  const [room, setRoom] = useState('general')
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [input, setInput] = useState('')
  const [online, setOnline] = useState(1)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const myName = profile?.full_name?.trim() || 'Anonymous lion'
  const myAvatar = profile?.avatar_url || ''

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
      // database-backed delivery too, in case a sender's broadcast never goes out
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room=eq.${room}` },
        (payload) => {
          const m = payload.new as RoomMessage
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

  // socket.io fast path for rooms
  useEffect(() => {
    if (!user) return
    const s = getSocket()
    if (!s) return
    s.emit('room:join', room)
    const onMsg = (m: RoomMessage) => {
      if (m.room !== room) return
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    }
    s.on('room:msg', onMsg)
    return () => {
      s.emit('room:leave', room)
      s.off('room:msg', onMsg)
    }
  }, [room, user?.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const body = input.trim()
    if (!body || !user) return
    setInput('')
    const optimistic: RoomMessage = {
      id: `tmp-${Date.now()}`, user_id: user.id, room, body, author_name: myName,
      author_avatar_url: myAvatar,
      created_at: new Date().toISOString(),
    }
    setMessages((m) => [...m, optimistic])
    const { data } = await supabase.from('chat_messages')
      .insert({ user_id: user.id, room, body, author_name: myName, author_avatar_url: myAvatar }).select().single()
    if (data) {
      const real = data as RoomMessage
      setMessages((m) => m.map((x) => (x.id === optimistic.id ? real : x)))
      getSocket()?.emit('room:msg', { room, msg: real })
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
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
                  {m.showHeader && <Avatar id={m.user_id} name={m.author_name} url={avatarFor(m.user_id) || m.author_avatar_url} size={8} />}
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
