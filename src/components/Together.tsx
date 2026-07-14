/**
 * Together — watch, listen and talk at the same time, inside a DM.
 *
 * Two synced-playback modes over the chat's realtime channel ('tg' events):
 *  - youtube: both phones run the same YouTube video in lockstep
 *  - media:   both phones play the same chat attachment (song / video) from
 *             their device vault, in lockstep
 * Play, pause and seeks propagate both ways; a heartbeat corrects drift.
 *
 * Voice calling is WebRTC ('rtc' events for signaling, Google STUN): mic to
 * mic, no server in the media path. Some strict mobile networks need a TURN
 * relay to connect — those calls fail gracefully with a note.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Clapperboard, Maximize2, Mic, MicOff, Minimize2, Music, Phone, PhoneOff, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils'

export type TogetherSession =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'media'; msgId: string; name?: string; isVideo?: boolean }
  | { kind: 'drive'; fileId: string; name?: string }

/** An Up-Next entry — both sides hold the same queue and auto-advance together. */
export type QueueItem = { qid: string; kind: 'youtube' | 'drive'; videoId?: string; fileId?: string; label: string }

export type TgPayload = {
  a: 'open' | 'state' | 'close' | 'emote' | 'join' | 'queue' | 'next'
  from: string
  kind?: TogetherSession['kind']
  videoId?: string
  msgId?: string
  fileId?: string
  name?: string
  isVideo?: boolean
  playing?: boolean
  t?: number
  at?: number
  e?: string
  items?: QueueItem[]
  item?: QueueItem
}

export function ytIdFrom(text?: string | null): string | null {
  if (!text) return null
  const m = text.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

export function driveIdFrom(text?: string | null): string | null {
  if (!text) return null
  const m = text.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[\w=&]*id=)?)([\w-]{10,})/)
  return m ? m[1] : null
}

export function playableKind(kind?: string, fileName?: string | null): 'audio' | 'video' | null {
  if (kind === 'audio') return 'audio'
  if (kind === 'file' && /\.(mp4|webm|mov)$/i.test(fileName ?? '')) return 'video'
  if (kind === 'file' && /\.(mp3|m4a|ogg|wav|aac)$/i.test(fileName ?? '')) return 'audio'
  return null
}

// ---------- YouTube IFrame API (loaded once, on demand) ----------
declare global {
  interface Window {
    YT?: { Player: new (el: string | HTMLElement, opts: unknown) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number } }
    onYouTubeIframeAPIReady?: () => void
  }
}
type YTPlayer = {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (s: number, allow: boolean) => void
  loadVideoById: (id: string) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  mute: () => void
  unMute: () => void
  destroy: () => void
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
let ytReady: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (!ytReady) {
    ytReady = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve()
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  }
  return ytReady
}

// ---------- synced playback overlay ----------
export function TogetherOverlay({
  session, meId, partnerName, sendTg, registerTgHandler, resolveMediaUrl, onClose, callNode, chatNode,
}: {
  session: TogetherSession
  meId: string
  partnerName: string
  sendTg: (p: Omit<TgPayload, 'from'>) => void
  registerTgHandler: (fn: (p: TgPayload) => void) => void
  resolveMediaUrl: (msgId: string) => Promise<string | null>
  onClose: () => void
  callNode?: React.ReactNode
  chatNode?: React.ReactNode
}) {
  const ytRef = useRef<YTPlayer | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  // Echo control — the cure for play/pause ping-pong between the phones:
  // whoever touched the controls last "drives"; the follower applies remote
  // state silently (never re-broadcasts it) and only heartbeats when driving.
  const applyingRemote = useRef(0)
  const iDrive = useRef(false)
  const ECHO_MS = 4000
  const expectedEcho = useRef<{ playing: boolean; until: number } | null>(null)
  const expectEcho = (playing: boolean) => {
    expectedEcho.current = { playing, until: Date.now() + 8000 }
  }
  const DRIFT_S = 5 // mobile buffering makes small gaps normal — don't chase them

  // what's on screen NOW — starts at the invite and advances through the
  // shared Up-Next queue (both sides hold the same queue and move together)
  const [current, setCurrent] = useState<TogetherSession>(session)
  const currentRef = useRef(current)
  useEffect(() => { currentRef.current = current })
  const [queue, setQueue] = useState<QueueItem[]>([])
  const queueRef = useRef(queue)
  useEffect(() => { queueRef.current = queue })
  const [addOpen, setAddOpen] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const advanceLock = useRef(0)
  const qSeq = useRef(0)

  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaGone, setMediaGone] = useState(false)
  const [partnerHere, setPartnerHere] = useState(false)
  // Drive files that refuse direct playback drop to Drive's own player iframe
  const [driveFallback, setDriveFallback] = useState(false)
  // mobile browsers refuse playback started by ANOTHER phone until this
  // device gets one real tap — gate everything behind "Tap to play"
  const [needsTap, setNeedsTap] = useState(true)
  const needsTapRef = useRef(true)
  useEffect(() => { needsTapRef.current = needsTap })
  const pendingState = useRef<{ playing: boolean; t: number; at: number } | null>(null)
  // follower autoplay: playback starts MUTED automatically (YouTube-style);
  // one tap turns the sound on — browsers only allow silent autoplay
  const [soundGate, setSoundGate] = useState(false)
  // our own transport for ALL players (YouTube iframe AND <video>): phone
  // players stop/start by themselves, so ONLY our buttons ever broadcast
  const [uiPlaying, setUiPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  // drag shows the scrub position; the seek+sync happens once, on release
  const [scrub, setScrub] = useState<number | null>(null)
  // fullscreen for the player box (works for iframe and <video> alike)
  const boxRef = useRef<HTMLDivElement>(null)
  const [fs, setFs] = useState(false)
  useEffect(() => {
    const f = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  function toggleFs() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void boxRef.current?.requestFullscreen?.().catch(() => {})
  }

  // how long this hangout has been running
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  // "X joined / left the room" announcements
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([])
  const noticeSeq = useRef(0)
  const pushNotice = useCallback((text: string) => {
    const id = ++noticeSeq.current
    setNotices((list) => [...list.slice(-2), { id, text }])
    setTimeout(() => setNotices((list) => list.filter((n) => n.id !== id)), 3200)
  }, [])
  // announce ourselves so the partner's room greets us by name
  const sendTgRef = useRef(sendTg)
  useEffect(() => { sendTgRef.current = sendTg })
  useEffect(() => {
    sendTgRef.current({ a: 'join' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // floating emoji reactions, mirrored on both screens
  const [emotes, setEmotes] = useState<{ id: number; e: string; x: number }[]>([])
  const emoteSeq = useRef(0)
  const pushEmote = useCallback((e: string) => {
    const id = ++emoteSeq.current
    setEmotes((list) => [...list.slice(-14), { id, e, x: 8 + Math.random() * 84 }])
    setTimeout(() => setEmotes((list) => list.filter((x) => x.id !== id)), 2600)
  }, [])

  /** One face for both player types — every control goes through here. */
  const player = useCallback(() => {
    const yt = currentRef.current.kind === 'youtube' ? ytRef.current : null
    const el = currentRef.current.kind !== 'youtube' ? mediaRef.current : null
    return {
      ready: !!(yt || el),
      t: () => (yt ? yt.getCurrentTime() : el ? el.currentTime : 0),
      d: () => (yt ? yt.getDuration() || 0 : el && Number.isFinite(el.duration) ? el.duration : 0),
      playing: () => (yt && window.YT ? yt.getPlayerState() === window.YT.PlayerState.PLAYING : el ? !el.paused : false),
      play: () => { yt?.playVideo(); if (el) void el.play().catch(() => {}) },
      pause: () => { yt?.pauseVideo(); el?.pause() },
      seek: (v: number) => { yt?.seekTo(v, true); if (el) el.currentTime = v },
      mute: (m: boolean) => { if (yt) { if (m) yt.mute(); else yt.unMute() } if (el) el.muted = m },
    }
  }, [])

  const broadcastState = useCallback((playing: boolean, t: number) => {
    const exp = expectedEcho.current
    if (exp && Date.now() < exp.until && exp.playing === playing) {
      expectedEcho.current = null
      return
    }
    if (Date.now() < applyingRemote.current) return
    expectedEcho.current = null
    iDrive.current = true
    sendTg({ a: 'state', playing, t, at: Date.now() })
  }, [sendTg])

  /** A REAL user action on our transport — always broadcasts, no echo guards. */
  function userAction(playing: boolean, t: number) {
    expectedEcho.current = null
    applyingRemote.current = 0
    iDrive.current = true
    sendTg({ a: 'state', playing, t, at: Date.now() })
  }

  // ---- the shared Up-Next queue ----
  function sessionFromItem(item: QueueItem): TogetherSession {
    return item.kind === 'youtube'
      ? { kind: 'youtube', videoId: item.videoId! }
      : { kind: 'drive', fileId: item.fileId!, name: item.label }
  }
  function sameAsCurrent(item: QueueItem) {
    const c = currentRef.current
    return (c.kind === 'youtube' && item.kind === 'youtube' && c.videoId === item.videoId)
      || (c.kind === 'drive' && item.kind === 'drive' && c.fileId === item.fileId)
  }
  const applyNext = useCallback((item: QueueItem, broadcast: boolean, items?: QueueItem[]) => {
    const remaining = (items ?? queueRef.current).filter((q) => q.qid !== item.qid)
    setQueue(remaining)
    pendingState.current = null
    setCur(0)
    setDur(0)
    setCurrent(sessionFromItem(item))
    pushNotice(`▶ Up next: ${item.label}`)
    if (broadcast) sendTgRef.current({ a: 'next', item, items: remaining })
  }, [pushNotice])
  /** The video finished — roll into the next one together, no pause. */
  const handleEnded = useCallback(() => {
    if (Date.now() < advanceLock.current) return
    const next = queueRef.current[0]
    if (!next) {
      setUiPlaying(false)
      return
    }
    advanceLock.current = Date.now() + 3000
    applyNext(next, true)
  }, [applyNext])
  function addToQueue() {
    const yt = ytIdFrom(addUrl)
    const drive = yt ? null : driveIdFrom(addUrl)
    if (!yt && !drive) return
    const item: QueueItem = yt
      ? { qid: `q${Date.now()}-${++qSeq.current}`, kind: 'youtube', videoId: yt, label: `YouTube · ${yt.slice(0, 6)}` }
      : { qid: `q${Date.now()}-${++qSeq.current}`, kind: 'drive', fileId: drive!, label: 'Drive video' }
    const items = [...queueRef.current, item]
    setQueue(items)
    setAddUrl('')
    setAddOpen(false)
    sendTgRef.current({ a: 'queue', items })
    pushNotice('🎬 Added to Up Next — for both of you')
  }
  function removeFromQueue(qid: string) {
    const items = queueRef.current.filter((q) => q.qid !== qid)
    setQueue(items)
    sendTgRef.current({ a: 'queue', items })
  }

  // apply the partner's play/pause/seek, with drift correction
  useEffect(() => {
    registerTgHandler((p) => {
      if (p.from === meId) return
      if (p.a === 'emote' && p.e) {
        pushEmote(p.e)
        return
      }
      if (p.a === 'queue') {
        setQueue(p.items ?? [])
        pushNotice('🎬 Up Next updated')
        return
      }
      if (p.a === 'next' && p.item) {
        if (!sameAsCurrent(p.item)) applyNext(p.item, false, p.items ? [...p.items, p.item] : undefined)
        else if (p.items) setQueue(p.items)
        return
      }
      if (p.a === 'join') {
        setPartnerHere(true)
        pushNotice(`🎉 ${partnerName} joined the room`)
        navigator.vibrate?.(15)
        // greet the newcomer with our position — playing OR paused — plus
        // the queue, so their room matches ours exactly
        const api = player()
        if (api.ready && (api.playing() || api.t() > 1)) {
          sendTgRef.current({ a: 'state', playing: api.playing(), t: api.t(), at: Date.now() })
        }
        if (queueRef.current.length) sendTgRef.current({ a: 'queue', items: queueRef.current })
        return
      }
      if (p.a === 'close') {
        setPartnerHere(false)
        pushNotice(`👋 ${partnerName} left the room`)
        return
      }
      if (p.a !== 'state' || p.t == null || p.at == null) return
      setPartnerHere(true)
      // before this device's first tap: start muted automatically (silent
      // autoplay is allowed) and offer a tap-for-sound pill instead
      if (needsTapRef.current) {
        pendingState.current = { playing: !!p.playing, t: p.t, at: p.at }
        const api = player()
        if (p.playing && api.ready) {
          iDrive.current = false
          applyingRemote.current = Date.now() + ECHO_MS
          expectEcho(true)
          const exp = p.t + (Date.now() - p.at) / 1000
          api.mute(true)
          if (exp > 1) api.seek(exp)
          api.play()
          setNeedsTap(false)
          setSoundGate(true)
        }
        return
      }
      // the partner acted — they drive now, we follow silently
      iDrive.current = false
      const expected = p.playing ? p.t + (Date.now() - p.at) / 1000 : p.t
      const api = player()
      if (!api.ready) return
      const localT = api.t()
      const localPlaying = api.playing()
      // already aligned → touch nothing (re-applying caused stutter)
      if (localPlaying === !!p.playing && Math.abs(localT - expected) < DRIFT_S) return
      applyingRemote.current = Date.now() + ECHO_MS
      if (localPlaying !== !!p.playing) expectEcho(!!p.playing)
      // land slightly AHEAD when catching up so buffering doesn't leave us behind
      const target = expected + (p.playing ? 1 : 0)
      if (Math.abs(localT - expected) >= DRIFT_S) api.seek(target)
      if (p.playing) api.play()
      else api.pause()
    })
    return () => registerTgHandler(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerTgHandler, meId, pushEmote, pushNotice, partnerName, applyNext, player])

  // youtube player — constructed once per youtube stint; videoId changes
  // (queue advance) reuse the same player via loadVideoById
  useEffect(() => {
    if (current.kind !== 'youtube') return
    let dead = false
    let playerObj: YTPlayer | null = null
    void loadYouTubeApi().then(() => {
      if (dead || !window.YT) return
      playerObj = new window.YT.Player('tg-yt', {
        videoId: currentRef.current.kind === 'youtube' ? currentRef.current.videoId : '',
        width: '100%',
        height: '100%',
        // controls: 0 — the iframe swallows taps and phone players stop and
        // start on their own; only OUR transport ever syncs
        playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, origin: window.location.origin },
        events: {
          // expose the player only when its API methods actually exist —
          // sync events during boot used to crash on a half-built object
          onReady: () => {
            if (dead || !playerObj) return
            ytRef.current = playerObj
            const pend = pendingState.current
            if (needsTapRef.current && pend?.playing) {
              iDrive.current = false
              applyingRemote.current = Date.now() + ECHO_MS
              expectEcho(true)
              const exp = pend.t + (Date.now() - pend.at) / 1000
              playerObj.mute()
              if (exp > 1) playerObj.seekTo(exp, true)
              playerObj.playVideo()
              setNeedsTap(false)
              setSoundGate(true)
            }
          },
          onStateChange: (e: { data: number }) => {
            if (!window.YT) return
            setUiPlaying(e.data === window.YT.PlayerState.PLAYING)
            if (e.data === 0) handleEnded() // ENDED → auto-advance the queue
          },
        },
      })
    })
    return () => {
      dead = true
      ytRef.current = null
      try { playerObj?.destroy() } catch { /* died with the iframe */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.kind])
  // queue advance within youtube: swap the video in the SAME player
  const ytVideoId = current.kind === 'youtube' ? current.videoId : ''
  useEffect(() => {
    if (!ytVideoId) return
    const yt = ytRef.current
    if (yt) {
      try { yt.loadVideoById(ytVideoId) } catch { /* player rebooting */ }
      setUiPlaying(true)
    }
  }, [ytVideoId])

  // chat-attachment player (from the device vault)
  useEffect(() => {
    if (current.kind !== 'media') return
    let dead = false
    void resolveMediaUrl(current.msgId).then((url) => {
      if (dead) return
      if (url) setMediaUrl(url)
      else setMediaGone(true)
    })
    return () => { dead = true }
  }, [current.kind, current.kind === 'media' ? current.msgId : '', resolveMediaUrl])
  // fresh drive file → give direct playback another chance
  useEffect(() => { setDriveFallback(false) }, [current.kind === 'drive' ? current.fileId : ''])

  // gentle heartbeat so a missed event can't leave the two sides apart —
  // only the driving side speaks, so heartbeats can't ping-pong
  useEffect(() => {
    const iv = setInterval(() => {
      if (!iDrive.current) return
      const api = player()
      if (api.ready && api.playing()) broadcastState(true, api.t())
    }, 7000)
    return () => clearInterval(iv)
  }, [broadcastState, player])

  // transport position poll (UI only)
  useEffect(() => {
    const iv = setInterval(() => {
      const api = player()
      if (!api.ready) return
      try {
        setCur(api.t() || 0)
        setDur(api.d() || 0)
      } catch { /* player booting */ }
    }, 500)
    return () => clearInterval(iv)
  }, [player])

  const isVideo = current.kind === 'youtube' || current.kind === 'drive' || (current.kind === 'media' && current.isVideo)
  const title = ('name' in current && current.name) ? current.name : 'Watching together'

  /** First real tap on this device — unblocks playback and catches up to the partner. */
  function tapStart() {
    const api = player()
    if (!api.ready) return // player still booting
    setNeedsTap(false)
    const pend = pendingState.current
    const expected = pend ? (pend.playing ? pend.t + (Date.now() - pend.at) / 1000 : pend.t) : 0
    if (pend) {
      iDrive.current = false
      applyingRemote.current = Date.now() + ECHO_MS
      expectEcho(pend.playing)
    }
    // if the partner is PAUSED, land on their second but stay paused too
    const shouldPlay = !pend || pend.playing
    if (expected > 1) api.seek(expected)
    if (shouldPlay) api.play()
    if (!pend) userAction(true, expected)
  }

  // real-world phone needs: keep the screen awake while watching, and make
  // Android's back button close the player instead of leaving the page
  useEffect(() => {
    type WakeSentinel = { release: () => Promise<void> }
    let lock: WakeSentinel | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeSentinel> } }
    const acquire = async () => {
      try { lock = (await nav.wakeLock?.request('screen')) ?? null } catch { /* unsupported */ }
    }
    void acquire()
    const onVis = () => { if (document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      void lock?.release().catch(() => {})
    }
  }, [])
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    window.history.pushState({ flTogether: true }, '')
    const onPop = () => {
      sendTgRef.current({ a: 'close' })
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function togglePlay() {
    const api = player()
    if (!api.ready) return
    const t = api.t()
    if (uiPlaying) {
      api.pause()
      setUiPlaying(false)
      userAction(false, t)
    } else {
      api.play()
      setUiPlaying(true)
      userAction(true, t)
    }
  }
  function seekBoth(v: number) {
    const api = player()
    if (!api.ready) return
    api.seek(v)
    setCur(v)
    userAction(uiPlaying, v)
  }

  /** The tap that turns sound on after a muted autoplay start. */
  function tapSound() {
    setSoundGate(false)
    applyingRemote.current = Date.now() + ECHO_MS
    const api = player()
    api.mute(false)
    api.play()
  }

  const showTransport = !needsTap && !(current.kind === 'drive' && driveFallback) && !(current.kind === 'media' && mediaGone)
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[85] flex flex-col bg-[#06050d]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-white">
          {current.kind === 'media' && !current.isVideo
            ? <Music size={18} className="shrink-0 text-amber-400" />
            : <Clapperboard size={18} className="shrink-0 text-red-400" />}
          <span className="truncate text-sm font-bold">{title} · with {partnerName}</span>
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] font-bold text-white/70">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
        <button onClick={() => { sendTg({ a: 'close' }); onClose() }} aria-label="Leave together session"
          className="shrink-0 rounded-full p-2 text-white/70 hover:bg-white/10">
          <X size={18} />
        </button>
      </div>

      <div ref={boxRef}
        className={cn('relative mx-3 shrink-0 overflow-hidden bg-black', fs ? 'h-full rounded-none' : 'rounded-3xl ring-1 ring-white/15', isVideo ? (fs ? '' : 'aspect-video') : 'h-32')}>
        {current.kind === 'youtube' && <div id="tg-yt" className="h-full w-full" />}
        {current.kind === 'drive' && (
          driveFallback ? (
            // Drive refused direct playback — its own player still works for
            // both, just without automatic sync
            <iframe
              src={`https://drive.google.com/file/d/${current.fileId}/preview`}
              className="h-full w-full"
              allow="autoplay; fullscreen"
              title="Google Drive player"
            />
          ) : (
            <video
              ref={mediaRef}
              src={`https://drive.google.com/uc?export=download&id=${current.fileId}`}
              playsInline
              className="h-full w-full object-contain"
              onError={() => setDriveFallback(true)}
              onPlay={() => setUiPlaying(true)}
              onPause={() => setUiPlaying(false)}
              onEnded={handleEnded}
            />
          )
        )}
        {current.kind === 'media' && (
          mediaGone ? (
            <p className="py-8 text-center text-sm text-white/60">
              This file isn't on your device anymore — media lives on the phones that exchanged it.
            </p>
          ) : mediaUrl ? (
            <>
              <video
                ref={mediaRef}
                src={mediaUrl}
                playsInline
                className={cn('h-full w-full', current.isVideo ? 'object-contain' : 'opacity-0')}
                onPlay={() => setUiPlaying(true)}
                onPause={() => setUiPlaying(false)}
                onEnded={handleEnded}
              />
              {!current.isVideo && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <Music size={40} className={cn('text-amber-400', uiPlaying && 'animate-pulse')} />
                </div>
              )}
            </>
          ) : (
            <div className="h-full w-full animate-pulse bg-white/10" />
          )
        )}

        {/* tap shield: makes tap = play/pause on every player type */}
        {showTransport && <div className="absolute inset-0 z-[5]" onClick={togglePlay} />}
        {/* the unified transport — the ONLY thing that syncs */}
        {showTransport && (
          <div className="absolute inset-x-0 bottom-0 z-[8] flex items-center gap-1.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pb-2 pt-7 sm:gap-2 sm:px-3">
            <button onClick={togglePlay} aria-label={uiPlaying ? 'Pause for both' : 'Play for both'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow active:scale-90">
              {uiPlaying ? '❚❚' : '▶'}
            </button>
            <button onClick={() => seekBoth(Math.max(0, cur - 10))} aria-label="Back 10 seconds"
              className="shrink-0 rounded-full px-1 py-1 text-[11px] font-black text-white/85 active:scale-90">
              ↺10
            </button>
            <span className="shrink-0 font-mono text-[10px] font-bold text-white/85">{fmtTime(scrub ?? cur)}</span>
            <input
              type="range" min={0} max={Math.max(1, dur)} step={1}
              value={Math.min(scrub ?? cur, Math.max(1, dur))}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => { if (scrub != null) { seekBoth(scrub); setScrub(null) } }}
              onTouchEnd={() => { if (scrub != null) { seekBoth(scrub); setScrub(null) } }}
              onKeyUp={() => { if (scrub != null) { seekBoth(scrub); setScrub(null) } }}
              aria-label="Seek for both"
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-amber-400"
            />
            <button onClick={() => seekBoth(Math.min(dur || cur + 10, cur + 10))} aria-label="Forward 10 seconds"
              className="shrink-0 rounded-full px-1 py-1 text-[11px] font-black text-white/85 active:scale-90">
              ↻10
            </button>
            <span className="shrink-0 font-mono text-[10px] font-bold text-white/60">{fmtTime(dur)}</span>
            {isVideo && (
              <button onClick={toggleFs} aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'}
                className="shrink-0 rounded-full p-1.5 text-white/85 active:scale-90">
                {fs ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            )}
          </div>
        )}

        {/* one real tap unblocks playback on this device */}
        {needsTap && !(current.kind === 'drive' && driveFallback) && !(current.kind === 'media' && mediaGone) && (
          <button onClick={tapStart}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/55 text-white">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-500 text-2xl shadow-lg">
              ▶
            </span>
            <span className="text-sm font-bold">Tap to play</span>
            <span className="px-6 text-center text-[11px] text-white/60">each phone taps once — then you stay in sync</span>
          </button>
        )}
        {/* muted-autoplay started — one tap for sound */}
        {soundGate && (
          <button onClick={tapSound}
            className="absolute bottom-14 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-black text-slate-900 shadow-xl active:scale-95">
            🔊 Tap for sound
          </button>
        )}
        {/* join / leave announcements */}
        <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex flex-col items-center gap-1">
          {notices.map((n) => (
            <motion.div key={n.id}
              initial={{ opacity: 0, y: -10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-slate-900 shadow-xl">
              {n.text}
            </motion.div>
          ))}
        </div>
        {/* floating live reactions from both sides */}
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          {emotes.map((em) => (
            <motion.div key={em.id}
              initial={{ opacity: 1, y: 0, scale: 0.8 }}
              animate={{ opacity: 0, y: -180, scale: 1.5 }}
              transition={{ duration: 2.4, ease: 'easeOut' }}
              className="absolute bottom-2 text-2xl"
              style={{ left: `${em.x}%` }}>
              {em.e}
            </motion.div>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-4 py-1.5 text-center text-[11px] text-white/50">
        {current.kind === 'drive' && driveFallback
          ? 'Drive player mode — press play on both phones.'
          : partnerHere
            ? `In sync with ${partnerName} 🎧`
            : `Waiting for ${partnerName} to join…`}
      </div>

      {/* Up Next — shared queue, auto-plays for both when a video ends */}
      <div className="shrink-0 px-3 pb-1">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-white/40">Up next</span>
          {queue.map((q) => (
            <span key={q.qid} className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 py-1 pl-2.5 pr-1 text-[11px] font-semibold text-white/85">
              {q.label}
              <button onClick={() => removeFromQueue(q.qid)} aria-label={`Remove ${q.label} from queue`}
                className="rounded-full p-0.5 text-white/50 hover:bg-white/10">
                <X size={11} />
              </button>
            </span>
          ))}
          {queue.length === 0 && <span className="shrink-0 text-[11px] text-white/35">nothing queued — keep it rolling</span>}
          <button onClick={() => setAddOpen((o) => !o)} aria-label="Add to queue"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-white active:scale-90">
            <Plus size={13} />
          </button>
        </div>
        {addOpen && (
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToQueue()}
              placeholder="Paste the next YouTube or Drive link…"
              className="min-w-0 flex-1 rounded-full bg-white/10 px-3.5 py-2 text-xs text-white outline-none placeholder:text-white/40"
            />
            <button onClick={addToQueue} disabled={!ytIdFrom(addUrl) && !driveIdFrom(addUrl)}
              className="shrink-0 rounded-full bg-gradient-to-r from-brand-500 to-purple-500 px-3.5 py-2 text-xs font-black uppercase text-white shadow active:scale-95 disabled:opacity-40">
              Add
            </button>
          </div>
        )}
      </div>

      {/* chat rides along under the player */}
      {chatNode}

      {/* live emote bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 px-4 pb-1.5">
        {['❤️', '😂', '🔥', '😮', '👏', '💯'].map((e) => (
          <button key={e} onClick={() => { pushEmote(e); sendTg({ a: 'emote', e }) }}
            className="rounded-full bg-white/10 px-2.5 py-1 text-lg transition hover:bg-white/20 active:scale-90">
            {e}
          </button>
        ))}
      </div>
      {callNode}
    </motion.div>
  )
}

// ---------- live voice call (WebRTC over the chat channel) ----------
export type RtcPayload = {
  t: 'offer' | 'answer' | 'ice' | 'end'
  from: string
  sdp?: RTCSessionDescriptionInit
  cand?: RTCIceCandidateInit
}
export type CallState = 'idle' | 'incoming' | 'connecting' | 'answered' | 'live' | 'failed' | 'mic'

export function useVoiceCall({ meId, sendRtc }: { meId: string | undefined; sendRtc: (p: Omit<RtcPayload, 'from'>) => void }) {
  const [state, setState] = useState<CallState>('idle')
  const [muted, setMuted] = useState(false)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const remoteStream = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null)
  const candBuffer = useRef<RTCIceCandidateInit[]>([])
  const roleRef = useRef<'caller' | 'callee' | null>(null)
  const restarted = useRef(false)

  // callback ref: re-attach the remote stream whenever the element mounts,
  // and ALWAYS call play() explicitly — relying on the autoPlay attribute
  // after a srcObject swap is exactly why audio was intermittent
  const attachEl = useCallback((el: HTMLAudioElement | null) => {
    remoteAudioRef.current = el
    if (el && remoteStream.current) {
      el.srcObject = remoteStream.current
      el.volume = 1
      void el.play().catch(() => {})
    }
  }, [])

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    // drop the dead stream too, or the next call re-attaches silence
    remoteStream.current = null
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    pcRef.current?.close()
    pcRef.current = null
    pendingOffer.current = null
    candBuffer.current = []
    roleRef.current = null
    restarted.current = false
    setMuted(false)
  }, [])

  // one in-call second chance: renegotiate with fresh network candidates
  // before declaring the call dead (transient mobile-network failures)
  const tryIceRestart = useCallback((): boolean => {
    const pc = pcRef.current
    if (!pc || restarted.current || roleRef.current !== 'caller') return false
    restarted.current = true
    void (async () => {
      try {
        const offer = await pc.createOffer({ iceRestart: true })
        await pc.setLocalDescription(offer)
        sendRtc({ t: 'offer', sdp: offer })
      } catch { /* connection already gone */ }
    })()
    return true
  }, [sendRtc])

  const endCall = useCallback((notify = true) => {
    if (notify) sendRtc({ t: 'end' })
    cleanup()
    setState('idle')
  }, [cleanup, sendRtc])

  const makePc = useCallback(async () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        // several STUNs — different carriers blacklist different ones
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
        // free public TURN relay — mobile carriers usually block direct
        // peer-to-peer, so calls ride this relay when punching through
        // fails. NOTE: this relay's :443 endpoints are DEAD (refused) —
        // only :80 udp/tcp are alive, so don't list 443 as false hope.
        {
          urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:80?transport=tcp'],
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
      iceCandidatePoolSize: 4,
    })
    pc.onicecandidate = (e) => { if (e.candidate) sendRtc({ t: 'ice', cand: e.candidate.toJSON() }) }
    pc.ontrack = (e) => {
      remoteStream.current = e.streams[0]
      const el = remoteAudioRef.current
      if (el) {
        el.srcObject = e.streams[0]
        el.volume = 1
        void el.play().catch(() => {})
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setState('live')
      if (pc.connectionState === 'failed') {
        // try once more with fresh candidates before giving up
        if (!tryIceRestart()) {
          cleanup()
          setState('failed')
        }
      }
      if (pc.connectionState === 'closed') { cleanup(); setState('idle') }
      // 'disconnected' is often transient on mobile — let ICE recover on
      // its own instead of hanging up (cutting here dropped live calls)
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    pcRef.current = pc
    return pc
  }, [cleanup, sendRtc])

  const failState = (e: unknown): CallState =>
    e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'SecurityError')
      ? 'mic'
      : 'failed'

  const startCall = useCallback(async () => {
    try {
      roleRef.current = 'caller'
      const pc = await makePc()
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sendRtc({ t: 'offer', sdp: offer })
      setState('connecting')
    } catch (e) {
      setState(failState(e))
    }
  }, [makePc, sendRtc])

  const acceptCall = useCallback(async () => {
    const offer = pendingOffer.current
    if (!offer) return
    try {
      roleRef.current = 'callee'
      const pc = await makePc()
      await pc.setRemoteDescription(offer)
      for (const c of candBuffer.current) await pc.addIceCandidate(c).catch(() => {})
      candBuffer.current = []
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendRtc({ t: 'answer', sdp: answer })
      setState('answered')
    } catch (e) {
      setState(failState(e))
    }
  }, [makePc, sendRtc])

  const toggleMute = useCallback(() => {
    const s = streamRef.current
    if (!s) return
    const next = !muted
    s.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }, [muted])

  /** Feed 'rtc' broadcast events here (registered by the chat's channel). */
  const handleRtc = useCallback((p: RtcPayload) => {
    if (p.from === meId) return
    if (p.t === 'offer' && p.sdp) {
      const pc = pcRef.current
      if (pc && roleRef.current) {
        // renegotiation (ICE restart mid-call) — answer in place, no re-ring
        const sdp = p.sdp
        void (async () => {
          try {
            await pc.setRemoteDescription(sdp)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            sendRtc({ t: 'answer', sdp: answer })
          } catch { /* stale renegotiation */ }
        })()
        return
      }
      pendingOffer.current = p.sdp
      setState('incoming')
      navigator.vibrate?.([80, 60, 80])
    }
    if (p.t === 'answer' && p.sdp) {
      // the caller hears about the ACCEPT immediately — before this, the
      // UI sat on "Calling…" until audio connected, looking broken
      // (but a renegotiation answer during a LIVE call must not regress it)
      setState((s) => (s === 'live' ? s : 'answered'))
      void pcRef.current?.setRemoteDescription(p.sdp).catch(() => {})
    }
    if (p.t === 'ice' && p.cand) {
      if (pcRef.current?.remoteDescription) void pcRef.current.addIceCandidate(p.cand).catch(() => {})
      else candBuffer.current.push(p.cand)
    }
    if (p.t === 'end') { cleanup(); setState('idle') }
  }, [meId, cleanup])

  // two-stage watchdog: mobile relays legitimately take 30-40s, so the old
  // 25s cutoff was hanging up calls that were still connecting. Stage 1
  // (18s): quietly retry with fresh network candidates. Stage 2 (55s): give
  // up with the Retry button.
  useEffect(() => {
    if (state !== 'connecting' && state !== 'answered') return
    const t1 = setTimeout(() => { tryIceRestart() }, 18_000)
    const t2 = setTimeout(() => {
      cleanup()
      setState('failed')
    }, 55_000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [state, cleanup, tryIceRestart])

  // hang up if the component unmounts (leaving the conversation)
  useEffect(() => () => { cleanup() }, [cleanup])

  return { state, muted, startCall, acceptCall, endCall, toggleMute, handleRtc, attachEl }
}

/** The in-chat call strip: incoming / connecting / live, with mute + hang up. */
export function VoiceCallBar({ call, partnerName }: {
  call: ReturnType<typeof useVoiceCall>
  partnerName: string
}) {
  // NOTE: the remote <audio> sink is owned by CallHost (always mounted) —
  // this bar is pure UI
  if (call.state === 'idle') return null
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('mb-2 flex items-center gap-2 rounded-2xl border bg-white px-3 py-2.5 shadow-md dark:bg-slate-900 sm:gap-2.5 sm:px-3.5',
        call.state === 'incoming' ? 'border-emerald-400/70' : call.state === 'failed' || call.state === 'mic' ? 'border-rose-400/60' : 'border-brand-400/50')}>
      <Phone size={16} className={cn(
        call.state === 'live' ? 'text-emerald-500' : call.state === 'failed' || call.state === 'mic' ? 'text-rose-500' : 'animate-pulse text-brand-500')} />
      <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
        {call.state === 'incoming' && `${partnerName} is calling…`}
        {call.state === 'connecting' && `Calling ${partnerName}…`}
        {call.state === 'answered' && 'Call accepted ✓ — connecting audio…'}
        {call.state === 'live' && `Voice call with ${partnerName}`}
        {call.state === 'failed' && 'No audio path — the network blocked the call.'}
        {call.state === 'mic' && 'Microphone is blocked — allow mic access for FocusLion in your phone settings, then try again.'}
      </span>
      {call.state === 'failed' && (
        <button onClick={() => void call.startCall()}
          className="shrink-0 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-black uppercase text-white shadow active:scale-95">
          Retry
        </button>
      )}
      {call.state === 'incoming' && (
        <button onClick={call.acceptCall}
          className="rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-black uppercase text-white shadow active:scale-95">
          Accept
        </button>
      )}
      {call.state === 'live' && (
        <button onClick={call.toggleMute} aria-label={call.muted ? 'Unmute' : 'Mute'}
          className={cn('rounded-full p-2', call.muted ? 'bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-500 dark:text-slate-300')}>
          {call.muted ? <MicOff size={15} /> : <Mic size={15} />}
        </button>
      )}
      <button onClick={() => call.endCall(true)} aria-label="End call"
        className="rounded-full bg-rose-500 p-2 text-white shadow active:scale-95">
        <PhoneOff size={15} />
      </button>
    </motion.div>
  )
}
