import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, Check, Repeat, Settings as SettingsIcon } from 'lucide-react'
import { AiLion } from './ui'
import { mascotSrc } from '../lib/mascot'
import { hap } from '../lib/haptics'
import { useAuth } from '../hooks/useAuth'
import { useApp } from '../store/app'
import { supabase } from '../lib/supabase'
import { leoAgent, leoVoice, transcribeVoice, lensAsk, prepareLensImage, type ChatTurn, type LeoAction, type LeoReply } from '../lib/ai'
import { offlineThink, OFFLINE_HELP } from '../lib/leoOffline'
import { listen, voiceSupported, type Listener } from '../lib/voice'
import {
  hasPhonePowers, phone, LEAVES_APP, loadMemory, remember, forget, loadSkills, learnSkill, forgetSkill, matchSkill,
  leoPrefs, setLeoPrefs, clearLeoBrain, LEO_PREFS_EVENT, type LeoPrefs,
} from '../lib/device'
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

// "bye leo", "goodbye", "that's all", "stop listening", Telugu/Hindi byes
const BYE = /^(?:ok(?:ay)?[, ]+)?(?:bye|bye bye|goodbye|good bye|bye leo|tata|see you|that'?s all|thats it|stop listening|close|go to sleep|sleep|alvida|बाय|अलविदा|బై|బాయ్|ఇక చాలు)(?:[ ,]+(?:leo|now|thanks|thank you))*[ .!]*$/i

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

export function LeoLive({ standalone = false }: { standalone?: boolean } = {}) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  // standalone = the Android "Leo only" pop-up window (LeoActivity): Leo is
  // open from the start, and closing him closes that window (not FocusLion)
  const [open, setOpen] = useState(standalone)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  // user-controlled Leo settings (on/off, hands-free, voice, briefing, phone control)
  const [prefs, setPrefs] = useState<LeoPrefs>(leoPrefs)
  const [showSettings, setShowSettings] = useState(false)
  const handsFree = prefs.handsFree
  useEffect(() => {
    const onPrefs = () => setPrefs(leoPrefs())
    window.addEventListener(LEO_PREFS_EVENT, onPrefs)
    return () => window.removeEventListener(LEO_PREFS_EVENT, onPrefs)
  }, [])

  const listenerRef = useRef<Listener | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakGen = useRef(0)
  // which speakOut started the device voice — a manual stop bumps speakGen,
  // so its 'idle' event no longer counts as "finished speaking"
  const ttsGenRef = useRef(-1)
  // "bye": close the overlay once the goodbye has been spoken
  const closeAfterSpeakRef = useRef(false)
  const deferredRef = useRef<{ act: string; args: Record<string, unknown> }[]>([])
  // data the phone reported this turn (screen time, screen text…) for Leo to talk about
  const phoneDataRef = useRef<string[]>([])
  // "look" action: Leo asked to see something — the camera button shows
  const [lookQ, setLookQ] = useState<string | null>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const historyRef = useRef<ChatTurn[]>([])
  const orbRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  const handsFreeRef = useRef(handsFree)
  useEffect(() => { openRef.current = open; handsFreeRef.current = handsFree }, [open, handsFree])
  const scrollRef = useRef<HTMLDivElement>(null)

  // track connectivity so the orb can say when Leo is in offline mode
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  // open from anywhere (search palette, buttons) via a window event
  useEffect(() => {
    const onOpen = () => openLeo()
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
    deferredRef.current = [] // a closed/stopped Leo must not dial or open anything later
    speakGen.current++
    audioRef.current?.pause()
    audioRef.current = null
    speech.stop()
    setLevel(0)
    setPhase('idle')
  }, [setLevel])

  const close = useCallback(() => {
    stopAll()
    if (standalone) {
      const bridge = (window as Window & { FLLeo?: { postMessage: (m: string) => void } }).FLLeo
      if (bridge) bridge.postMessage('close')
      else navigate('/')
      return
    }
    setOpen(false)
  }, [stopAll, standalone, navigate])

  /** Go to a FocusLion page. In the Leo-only window this opens the full app there. */
  function goApp(path: string) {
    if (standalone && hasPhonePowers()) deferredRef.current.push({ act: 'open_focuslion', args: { path } })
    else navigate(path)
  }

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
    parts.push(`Message confirmation: ${leoPrefs().confirmSend ? 'ON — ask before sending' : 'OFF — the user chose instant sending: include the send/schedule action immediately'}`)
    const mem = loadMemory()
    if (mem.length) parts.push(`Things the user asked you to remember:\n${mem.map((m) => `- ${m}`).join('\n')}`)
    const skills = loadSkills()
    if (skills.length) parts.push(`Learned skills (user taught you):\n${skills.map((k) => `- "${k.phrase}" -> ${k.actions.map((x) => String(x.do ?? x.type)).join(', ')}`).join('\n')}`)
    if (hasPhonePowers()) {
      const b = await phone('info', {}, 2500)
      parts.push(`Phone control: available (Android app)${b.ok ? ` · ${b.msg}` : ''}`)
    } else {
      parts.push('Phone control: NOT available (web browser)')
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
          goApp(`/focus?${qs}`)
          done.push(`Focus started: ${min} min`)
        } else if (a.type === 'open' && PAGES[a.page]) {
          goApp(PAGES[a.page])
          done.push(`Opened ${a.page}`)
        } else if (a.type === 'theme') {
          const app = useApp.getState()
          if ((a.mode === 'dark') !== app.dark) app.toggleDark()
          done.push(`${a.mode === 'dark' ? 'Dark' : 'Light'} mode`)
        } else if (a.type === 'remember' && a.fact) {
          remember(String(a.fact))
          done.push(`Remembered: ${a.fact}`)
        } else if (a.type === 'forget' && a.fact) {
          if (forget(String(a.fact))) done.push(`Forgot: ${a.fact}`)
        } else if (a.type === 'flashcards' && user && Array.isArray(a.cards)) {
          const deck = String(a.deck || 'Leo').slice(0, 40)
          const rows = a.cards
            .map((c) => ({ front: String(c?.front ?? '').trim().slice(0, 300), back: String(c?.back ?? '').trim().slice(0, 400) }))
            .filter((c) => c.front && c.back).slice(0, 20)
            .map((c) => ({ ...c, deck, user_id: user.id }))
          if (rows.length) {
            const { error } = await supabase.from('flashcards').insert(rows)
            if (!error) done.push(`${rows.length} flashcards added to "${deck}"`)
          }
        } else if (a.type === 'look') {
          setLookQ(String(a.question || 'What is this? Explain it simply.'))
        } else if (a.type === 'learn' && a.phrase && Array.isArray(a.actions)) {
          learnSkill(String(a.phrase), String(a.say ?? ''), a.actions)
          done.push(`Learned: "${a.phrase}"`)
        } else if (a.type === 'unlearn' && a.phrase) {
          if (forgetSkill(String(a.phrase))) done.push(`Forgot skill: "${a.phrase}"`)
        } else if (a.type === 'phone' && typeof a.do === 'string') {
          const { type: _t, do: act, ...rawArgs } = a
          void _t
          // instant mode (confirmation off): calls are placed directly
          const args = act === 'call' ? { ...rawArgs, direct: !leoPrefs().confirmSend } : rawArgs
          // switching to another app would cut Leo off mid-sentence, so those
          // run right after he finishes speaking (see spokeEnd)
          if (LEAVES_APP.has(act)) deferredRef.current.push({ act, args })
          else {
            const r = await phone(act, args)
            done.push(r.ok ? (act === 'read_screen' ? 'Read your screen' : r.msg) : `⚠ ${r.msg}`)
            if (r.ok && (act === 'screen_time' || act === 'info' || act === 'read_screen')) phoneDataRef.current.push(r.msg)
          }
        }
      } catch { /* skip a failed action, keep going */ }
    }
    return done
  }

  /** One full turn: user text -> Leo thinks, acts, speaks. */
  async function think(text: string) {
    deferredRef.current = [] // never carry phone actions over from an earlier turn
    const q = text.trim()
    if (!q) { setPhase('idle'); return }
    // "bye" / "that's all" — say goodbye and close (works offline, no AI)
    if (BYE.test(q)) {
      setLines((l) => [...l, { who: 'you', text: q }, { who: 'leo', text: 'Bye! Say "Hey Leo" or tap me anytime. 🦁' }])
      closeAfterSpeakRef.current = true
      await speakOut('Bye! Call me anytime.', 'en')
      return
    }
    setLines((l) => [...l, { who: 'you', text: q }])
    historyRef.current = [...historyRef.current, { role: 'user', content: q }]
    setPhase('thinking')
    try {
      let reply: LeoReply
      // a skill the user taught Leo runs instantly — no AI, works offline
      const skill = matchSkill(q)
      if (skill) reply = { say: skill.say || 'On it.', lang: 'en', actions: skill.actions as LeoAction[] }
      else if (!navigator.onLine) reply = await offlineReply(q)
      else {
        try { reply = await leoAgent(await buildContext(), historyRef.current) }
        catch (e) {
          // the AI couldn't be reached (bad network) — phone commands still work
          const r = offlineThink(q)
          if (!r || !/fetch|network|reach|Failed|timeout/i.test(String(e))) throw e
          reply = await offlineReply(q)
        }
      }
      // closed while Leo was thinking = cancelled: don't act on it
      if (!openRef.current) { setPhase('idle'); return }
      phoneDataRef.current = []
      const done = await runActions(reply.actions)
      // the phone reported data (screen time, screen text) — Leo answers with it
      if (phoneDataRef.current.length && navigator.onLine && !skill) {
        try {
          const follow = await leoAgent(await buildContext(), [...historyRef.current,
            { role: 'assistant', content: JSON.stringify({ say: reply.say, lang: reply.lang, actions: reply.actions }) },
            { role: 'user', content: `[Phone reported] ${phoneDataRef.current.join(' | ').slice(0, 6000)}\nAnswer my last request using this — briefly, with a helpful suggestion. No actions.` }])
          reply = { ...reply, say: follow.say, lang: follow.lang }
        } catch { /* keep the first answer */ }
      }
      historyRef.current = [...historyRef.current, { role: 'assistant', content: JSON.stringify({ say: reply.say, lang: reply.lang, actions: reply.actions }) }]
      setLines((l) => [...l, { who: 'leo', text: reply.say, done }])
      if (!openRef.current) return
      // a navigation action closes the overlay so the user sees the page,
      // but Leo still answers out loud (hands-free won't re-open the mic)
      if (reply.actions.some((a) => a.type === 'open' || a.type === 'start_focus')) {
        if (!standalone) setTimeout(() => { openRef.current = false; setOpen(false) }, 900)
      }
      await speakOut(reply.say, reply.lang)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setPhase('idle')
    }
  }

  /** Leo Vision: the user showed a photo — Leo looks, explains, and speaks. */
  async function onPhoto(file: File) {
    const question = lookQ ?? 'What is this? Explain it simply.'
    setLookQ(null)
    stopSpeaking()
    setError('')
    setLines((l) => [...l, { who: 'you', text: `📷 ${question}` }])
    setPhase('thinking')
    try {
      const img = await prepareLensImage(file)
      const answer = await lensAsk(img, `${question} Answer in a natural spoken style (no markdown), in the same language as the question.`)
      const say = answer.replace(/[*#_`]/g, '').trim() || "I couldn't make that out — try a clearer photo."
      historyRef.current = [...historyRef.current, { role: 'user', content: `[showed a photo] ${question}` },
        { role: 'assistant', content: JSON.stringify({ say, lang: 'en', actions: [] }) }]
      setLines((l) => [...l, { who: 'leo', text: say }])
      await speakOut(say, /[ఀ-౿]/.test(say) ? 'te' : /[ऀ-ॿ]/.test(say) ? 'hi' : 'en')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.")
      setPhase('idle')
    }
  }

  /** Offline brain: rule-based commands; "how's my phone" is answered with live data. */
  async function offlineReply(q: string): Promise<LeoReply> {
    const r = offlineThink(q)
    if (!r) return { say: OFFLINE_HELP, lang: 'en', actions: [] }
    const info = r.actions.find((a) => a.type === 'phone' && a.do === 'info')
    if (info) {
      const res = await phone('info')
      return { say: res.ok ? `${res.msg}.` : res.msg, lang: 'en', actions: [] }
    }
    return r
  }

  /**
   * Say a reply out loud: Leo's natural AI voice (Gemini) when available,
   * otherwise the phone's built-in voice. Either way, when it finishes we go
   * back to idle — and in hands-free mode, straight back to listening.
   */
  async function speakOut(text: string, lang: string) {
    const gen = ++speakGen.current
    const url = leoPrefs().aiVoice ? await leoVoice(text) : null
    if (gen !== speakGen.current) return // stopped or superseded meanwhile
    if (url) {
      const a = new Audio(url)
      audioRef.current = a
      const ended = () => { if (gen === speakGen.current) { audioRef.current = null; spokeEnd() } }
      a.onended = ended
      a.onerror = ended
      setPhase('speaking')
      try { await a.play(); return } catch { audioRef.current = null /* fall through to device voice */ }
    }
    if (gen !== speakGen.current) return
    setPhase('speaking')
    ttsGenRef.current = gen
    speech.play(text, LANG_LABEL[lang] ?? 'english')
  }

  function stopSpeaking() {
    speakGen.current++
    audioRef.current?.pause()
    audioRef.current = null
    speech.stop()
  }

  function spokeEnd() {
    if (closeAfterSpeakRef.current) { closeAfterSpeakRef.current = false; close(); return }
    // phone actions that open another app (WhatsApp, YouTube, dialer…) run now
    if (deferredRef.current.length) {
      setPhase('idle')
      void runDeferred()
      return
    }
    setPhase((p) => {
      if (p !== 'speaking') return p
      if (openRef.current && handsFreeRef.current) setTimeout(() => { if (openRef.current) startRef.current() }, 350)
      return 'idle'
    })
  }

  async function runDeferred() {
    const todo = deferredRef.current
    deferredRef.current = []
    for (const { act, args } of todo) {
      const r = await phone(act, args)
      setLines((l) => {
        const i = l.map((x) => x.who).lastIndexOf('leo')
        if (i < 0) return l
        const next = [...l]
        next[i] = { ...next[i], done: [...(next[i].done ?? []), r.ok ? r.msg : `⚠ ${r.msg}`] }
        return next
      })
      if (!r.ok) { setError(r.msg); return }
    }
  }

  async function startListening() {
    setError('')
    stopSpeaking()
    // OFFLINE: Whisper is in the cloud, so use the phone's own (on-device) ears
    if (!navigator.onLine) {
      if (!hasPhonePowers()) { setError("You're offline. Leo needs internet here — in the Android app he can still do phone commands offline."); return }
      setPhase('listening')
      const r = await phone('listen', { lang: 'en-IN' }, 20_000)
      if (!openRef.current) return
      if (!r.ok) { setError(r.msg); setPhase('idle'); return }
      await think(r.msg)
      return
    }
    if (!voiceSupported()) { setError('Voice is not supported here — type your question below.'); return }
    try {
      const l = await listen(setLevel)
      if (!openRef.current) { l.cancel(); return } // Leo was closed while the mic was starting
      listenerRef.current = l
      setPhase('listening')
      hap.tap()
      const clip = await l.done
      listenerRef.current = null
      setLevel(0)
      if (!clip.spoke) { setPhase('idle'); return }
      setPhase('thinking')
      const text = await transcribeVoice(clip.dataUrl)
      if (!openRef.current) return
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
  const spokeEndRef = useRef(spokeEnd)
  useEffect(() => { spokeEndRef.current = spokeEnd })
  // device-voice fallback finished speaking
  useEffect(() => speech.subscribe((s) => {
    // only a NATURAL end of the current device-voice reply counts
    if (s === 'idle' && !audioRef.current && ttsGenRef.current === speakGen.current) {
      ttsGenRef.current = -1
      spokeEndRef.current()
    }
  }), [])

  // "Hey Leo" wake word (Android app, opt-in): the phone listens on-device only
  // while FocusLion is on screen and Leo is closed; hearing it opens Leo and
  // runs the rest of the sentence ("hey leo, open whatsapp")
  const wakeRef = useRef<(rest: string) => void>(() => {})
  useEffect(() => {
    wakeRef.current = (rest: string) => {
      openRef.current = true
      setOpen(true)
      setTimeout(() => { if (rest.trim()) void thinkRef.current(rest); else void startRef.current() }, 250)
    }
  })
  useEffect(() => {
    if (!user || !prefs.enabled || !prefs.heyLeo || standalone) return
    const w = window as Window & { __flWake?: (rest: string) => void }
    w.__flWake = (rest) => wakeRef.current(rest)
    let tries = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      if (!hasPhonePowers()) { if (tries++ < 8) retry = setTimeout(sync, 1500); return } // bridge not ready yet
      if (!open && document.visibilityState === 'visible') void phone('wake_start')
      else void phone('wake_stop')
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', sync)
      if (hasPhonePowers()) void phone('wake_stop')
      delete w.__flWake
    }
  }, [user, prefs.enabled, prefs.heyLeo, open, standalone])

  // floating bubble service (Android): follow the setting; also re-starts it
  // after a reboot the first time FocusLion is opened
  useEffect(() => {
    if (!user || !prefs.enabled || standalone) return
    let tries = 0
    let t: ReturnType<typeof setTimeout> | undefined
    const apply = () => {
      if (!hasPhonePowers()) { if (tries++ < 8) t = setTimeout(apply, 1500); return }
      void phone(prefs.bubble ? 'bubble_start' : 'bubble_stop', { wake: prefs.heyLeo })
    }
    apply()
    return () => clearTimeout(t)
  }, [user, prefs.enabled, prefs.bubble, prefs.heyLeo, standalone])

  // the bubble or "Hey Leo" (outside the app) brought FocusLion up — open Leo
  useEffect(() => {
    if (!user || !prefs.enabled) return
    let tries = 0
    const pull = () => {
      if (document.visibilityState !== 'visible') return
      if (!hasPhonePowers()) { if (tries++ < 6) setTimeout(pull, 1000); return } // bridge not ready yet
      void phone('take_wake', {}, 3000).then((r) => { if (r.ok) wakeRef.current(r.msg === 'none' ? '' : r.msg) })
    }
    const t = setTimeout(pull, 600)
    document.addEventListener('visibilitychange', pull)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', pull) }
  }, [user, prefs.enabled])

  // full app: the Leo-only window asked to open a FocusLion page ("open my tasks")
  useEffect(() => {
    if (!user || standalone) return
    let tries = 0
    const pull = () => {
      if (document.visibilityState !== 'visible') return
      if (!hasPhonePowers()) { if (tries++ < 6) setTimeout(pull, 1000); return }
      void phone('take_route', {}, 3000).then((r) => { if (r.ok && r.msg.startsWith('/')) navigate(r.msg) })
    }
    const t = setTimeout(pull, 700)
    document.addEventListener('visibilitychange', pull)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', pull) }
  }, [user, standalone, navigate])

  // never leave the mic on if the component goes away
  useEffect(() => () => { listenerRef.current?.cancel() }, [])

  function onOrb() {
    if (phase === 'listening') listenerRef.current?.stop()
    else if (phase === 'speaking') {
      stopSpeaking()
      setPhase('idle')
      if (deferredRef.current.length) void runDeferred()
    }
    else if (phase === 'idle') startListening()
  }

  function toggleHandsFree() {
    setLeoPrefs({ handsFree: !prefs.handsFree })
  }

  /** Open Leo; on the first open of the day he greets you with a briefing. */
  function openLeo() {
    setOpen(true)
    const p = leoPrefs()
    if (!p.briefing || !navigator.onLine) return
    const day = new Date().toDateString()
    let last = ''
    try { last = localStorage.getItem('fl:leo-brief-day') ?? '' } catch { /* ignore */ }
    if (last === day) return
    try { localStorage.setItem('fl:leo-brief-day', day) } catch { /* ignore */ }
    setTimeout(() => { void thinkRef.current('Good morning Leo — brief me on my day.') }, 450)
  }
  const thinkRef = useRef(think)
  useEffect(() => { thinkRef.current = think })

  if (!user || (!prefs.enabled && !standalone)) return null

  const status = {
    idle: online ? 'Tap the orb and talk' : 'Offline mode — phone commands only',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking — tap to stop',
  }[phase]

  return (
    <>
      {/* floating launcher — stacked above the Lion AI chat button */}
      {!standalone && <button
        onClick={openLeo}
        aria-label="Leo Live voice assistant"
        className="fixed bottom-[calc(11.5rem+env(safe-area-inset-bottom))] left-5 z-[55] flex h-12 w-12 items-center justify-center rounded-full shadow-xl ring-2 ring-sky-300/70 transition active:scale-95 lg:bottom-24 lg:left-auto lg:right-7"
        style={{ background: 'radial-gradient(circle at 35% 30%,#7dd3fc,#2563eb 60%,#1e1b4b)', boxShadow: '0 8px 22px rgba(37,99,235,.45)' }}
      >
        <AiLion className="h-8" />
      </button>}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            ref={orbRef}
            className="leo-stage fixed inset-0 z-[70] flex flex-col overflow-hidden text-white"
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
                <button onClick={() => setShowSettings((v) => !v)} aria-label="Leo settings" className={cn('rounded-full p-2 hover:bg-white/20', showSettings ? 'bg-sky-400/30' : 'bg-white/10')}>
                  <SettingsIcon size={18} />
                </button>
                <button onClick={close} aria-label="Close" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
                  <X size={18} />
                </button>
              </div>
            </div>

            {showSettings && (
              <div className="mx-auto mt-3 w-full max-w-xl px-4">
                <LeoSettingsPanel dark onTurnedOff={close} />
              </div>
            )}

            {/* holographic backdrop: drifting star grid + a slow scan line (GPU-only) */}
            <div aria-hidden className="leo-bg pointer-events-none absolute inset-0 -z-10">
              <span className="leo-stars" />
              <span className="leo-scan" />
            </div>

            {/* orb — "arc reactor" */}
            <div className="flex flex-col items-center pt-4">
              <motion.button
                onClick={onOrb} aria-label={status}
                initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 160 }}
                className="relative h-56 w-56 outline-none"
              >
                <div className={cn('leo-orb absolute inset-0', `leo-${phase}`)}>
                  <span className="leo-halo" />
                  <span className="leo-ticks" />
                  <span className="leo-arc" />
                  <span className="leo-ring leo-ring-1" />
                  <span className="leo-ring leo-ring-2" />
                  <span className="leo-ring leo-ring-3" />
                  <span className="leo-orbit">
                    {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}
                  </span>
                  <span className="leo-core" />
                </div>
                <img src={mascotSrc('ai')} alt="" draggable={false}
                  className={cn('leo-face pointer-events-none absolute inset-0 m-auto h-24 w-24 object-contain', `leo-face-${phase}`)} />
              </motion.button>

              {/* sound wave: follows your voice while listening, pulses while Leo talks */}
              <div className={cn('leo-wave mt-3', `leo-wave-${phase}`)} aria-hidden>
                {Array.from({ length: 28 }, (_, i) => <span key={i} style={{ '--i': i } as React.CSSProperties} />)}
              </div>
              <div className="mt-2 flex h-5 items-center gap-2 text-sm font-semibold tracking-wide text-sky-200">
                <span className={cn('leo-dot', `leo-dot-${phase}`)} />{status}
              </div>
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
                <motion.div key={i} className={l.who === 'you' ? 'text-right' : 'text-left'}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.22 }}>
                  <div className={cn('inline-block max-w-[90%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm',
                    l.who === 'you' ? 'bg-white/10 text-white/80' : 'leo-msg text-sky-50')}>
                    {l.who === 'leo' && i === lines.length - 1 ? <TypeText key={`${i}:${l.text}`} text={l.text} /> : l.text}
                  </div>
                  {!!l.done?.length && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {l.done.map((d) => (
                        <span key={d} className="leo-chip inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                          <Check size={11} /> {d}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
              {error && <p className="text-center text-xs font-semibold text-rose-300">{error}</p>}
            </div>

            {/* Leo asked to see something — the user taps to open the camera */}
            {lookQ && (
              <div className="mx-auto w-full max-w-xl px-4 pb-1">
                <button
                  onClick={() => camRef.current?.click()}
                  disabled={phase === 'thinking'}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 py-3 text-sm font-bold text-white shadow-lg active:scale-[.98] disabled:opacity-50"
                >
                  📷 Show Leo
                </button>
                <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onPhoto(f) }} />
              </div>
            )}

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

/**
 * Leo Live settings — used inside Leo (⚙) and on the Settings page. Every
 * option is per device and takes effect immediately.
 */
export function LeoSettingsPanel({ dark, onTurnedOff }: { dark?: boolean; onTurnedOff?: () => void }) {
  const [p, setP] = useState<LeoPrefs>(leoPrefs)
  const [cleared, setCleared] = useState(false)
  useEffect(() => {
    const on = () => setP(leoPrefs())
    window.addEventListener(LEO_PREFS_EVENT, on)
    return () => window.removeEventListener(LEO_PREFS_EVENT, on)
  }, [])
  const rows: { key: keyof LeoPrefs; label: string; hint: string }[] = [
    { key: 'enabled', label: 'Leo Live', hint: 'Show the Leo voice assistant button' },
    { key: 'handsFree', label: 'Hands-free', hint: 'Keep listening after each answer' },
    { key: 'aiVoice', label: 'Natural AI voice', hint: "Off = your phone's built-in voice (faster, works offline)" },
    { key: 'briefing', label: 'Daily briefing', hint: 'Brief you on your day the first time you open Leo' },
    { key: 'phoneControl', label: 'Phone control', hint: 'Let Leo open apps, set alarms, control your phone (Android app)' },
    { key: 'confirmSend', label: 'Confirm before calls & messages', hint: 'On: Leo reads messages back and waits for "yes"; calls open the dialer. Off: calls and WhatsApp/SMS go out the moment you ask.' },
    { key: 'bubble', label: 'Floating Leo bubble', hint: 'A lion bubble over other apps — tap it to talk, drag to move, long-press to hide (Android app)' },
    { key: 'heyLeo', label: '"Hey Leo" wake word', hint: 'Say "Hey Leo" to open him — inside FocusLion, and with the bubble on, over other apps too. Listens on-device only.' },
  ]
  const toggle = (k: keyof LeoPrefs) => {
    const v = !p[k]
    setLeoPrefs({ [k]: v })
    if (k === 'enabled' && !v) onTurnedOff?.()
  }
  return (
    <div className={cn('space-y-1 rounded-2xl p-2', dark ? 'bg-white/5' : '')}>
      {rows.map((r) => (
        <button key={r.key} onClick={() => toggle(r.key)}
          className={cn('flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left', dark ? 'hover:bg-white/5' : 'hover:bg-slate-500/5')}>
          <span className="min-w-0">
            <span className={cn('block text-sm font-semibold', dark ? 'text-white' : 'text-slate-900 dark:text-white')}>{r.label}</span>
            <span className={cn('block text-xs', dark ? 'text-white/50' : 'text-slate-500')}>{r.hint}</span>
          </span>
          <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition', p[r.key] ? 'bg-sky-500' : dark ? 'bg-white/15' : 'bg-slate-300 dark:bg-white/15')}>
            <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', p[r.key] ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>
      ))}
      <button onClick={() => { clearLeoBrain(); setCleared(true) }}
        className={cn('w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-400', dark ? 'hover:bg-white/5' : 'hover:bg-rose-500/5')}>
        {cleared ? '✓ Memory and taught skills cleared' : "Clear Leo's memory and taught skills"}
      </button>
    </div>
  )
}

/** Leo's latest reply "types" itself out (≈ speaking pace), then stays static. */
function TypeText({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    // (a new reply re-mounts this via key, so n starts at 0)
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const next = Math.min(text.length, Math.floor((now - start) / 18))
      setN(next)
      if (next < text.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text])
  return <>{text.slice(0, n)}{n < text.length && <span className="leo-caret">▍</span>}</>
}
