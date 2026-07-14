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
import { ChevronDown, Clapperboard, Maximize2, MessageCircle, Mic, MicOff, Minimize2, MonitorOff, MonitorUp, Music, Pause, Phone, PhoneOff, Play, Plus, RotateCcw, RotateCw, SwitchCamera, Video, VideoOff, Volume1, Volume2, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { callAudioStart, callAudioSpeaker, callAudioEnd } from '../lib/callAudio'
import { hasNativeScreen, nativeScreenStart, nativeScreenStop } from '../lib/nativeScreen'

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

// YouTube Data API — powers "More like this" + endless auto-play. A client
// key is normal for this API; it should be restricted to YouTube Data API +
// the app's domains in Google Cloud Console.
const YT_KEY = (import.meta.env.VITE_YT_API_KEY as string | undefined) ?? 'AIzaSyAdUDhzkBCpt_Qk8cAMWTHzpgqgjPsr88s'

export type YtSuggestion = { videoId: string; title: string; thumb: string }
const sugCache = new Map<string, YtSuggestion[]>()
async function fetchSuggestions(videoId: string): Promise<YtSuggestion[]> {
  const hit = sugCache.get(videoId)
  if (hit) return hit
  try {
    // related-videos API is gone — search by the current title instead,
    // which lands on the same artist/topic well enough
    const title = await fetchYtTitle(videoId)
    if (!title) return []
    const q = title.replace(/[([].*?[)\]]/g, '').slice(0, 60) // drop "(Official Video)" noise
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=9&q=${encodeURIComponent(q)}&key=${YT_KEY}`)
    if (!r.ok) return []
    const j = (await r.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } } }[] }
    const out = (j.items ?? [])
      .filter((i) => i.id?.videoId && i.id.videoId !== videoId && i.snippet?.title)
      .map((i) => ({
        videoId: i.id!.videoId!,
        title: i.snippet!.title!.replace(/&amp;/g, '&').replace(/&#39;/g, '’').replace(/&quot;/g, '"'),
        thumb: i.snippet!.thumbnails?.medium?.url ?? '',
      }))
      .slice(0, 8)
    sugCache.set(videoId, out)
    return out
  } catch {
    return []
  }
}

// real video titles via YouTube's keyless oEmbed (CORS-open), cached per id
const ytTitleCache = new Map<string, string>()
async function fetchYtTitle(videoId: string): Promise<string | null> {
  const hit = ytTitleCache.get(videoId)
  if (hit) return hit
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://youtu.be/${videoId}`)}&format=json`)
    if (!r.ok) return null
    const j = (await r.json()) as { title?: string }
    if (j.title) ytTitleCache.set(videoId, j.title)
    return j.title ?? null
  } catch {
    return null
  }
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
  session, meId, partnerName, sendTg, registerTgHandler, resolveMediaUrl, onClose, callNode, chatNode, callInfo,
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
  // live call controls so fullscreen can start / mute / end without leaving —
  // plus the camera switch and video-tile hookups, so faces stay on screen
  // while the video plays (the floating panel outside can't render inside a
  // fullscreened element)
  callInfo?: {
    state: string
    muted: boolean
    camOn: boolean
    remoteCamOn: boolean
    start: () => void
    startVideo: () => void
    end: () => void
    toggleMute: () => void
    toggleCam: () => void
    flipCam: () => void
    attachLocalVideo: (el: HTMLVideoElement | null) => void
    attachRemoteVideo: (el: HTMLVideoElement | null) => void
  }
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
  const [driveLoading, setDriveLoading] = useState(true)
  // the playing video's real aspect ratio (w/h), read on loadedmetadata, so the
  // player window matches the clip (a portrait video no longer sits tiny inside
  // a 16:9 box with huge black bars). null → fall back to 16:9. YouTube stays
  // 16:9 (its dimensions aren't readable from the iframe).
  const [videoAspect, setVideoAspect] = useState<number | null>(null)
  // Drive plays in a real <video> (synced, like device media). If Drive won't
  // stream it (large / non-streamable / codec), fall back to the /preview
  // iframe (unsynced). driveLoadingRef lets the load-timeout read live state.
  const [driveFallback, setDriveFallback] = useState(false)
  const driveLoadingRef = useRef(true)
  useEffect(() => { driveLoadingRef.current = driveLoading })
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
  // chat slides up OVER the video while fullscreen (everything outside the
  // fullscreened element is invisible, so it must live inside the box)
  const [fsChat, setFsChat] = useState(false)
  useEffect(() => {
    const f = () => {
      const on = !!document.fullscreenElement
      setFs(on)
      if (!on) setFsChat(false)
    }
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
  // "More like this" — refreshed for every video that comes on screen
  const [sugs, setSugs] = useState<YtSuggestion[]>([])
  const sugsRef = useRef(sugs)
  useEffect(() => { sugsRef.current = sugs })
  useEffect(() => {
    setSugs([])
    if (current.kind !== 'youtube') return
    let dead = false
    void fetchSuggestions(current.videoId).then((s) => { if (!dead) setSugs(s) })
    return () => { dead = true }
  }, [current.kind, current.kind === 'youtube' ? current.videoId : ''])

  /** The video finished — queue first, else roll straight into a similar
   *  video (endless auto-play), never a dead stop. */
  const handleEnded = useCallback(() => {
    if (Date.now() < advanceLock.current) return
    const next = queueRef.current[0]
    if (next) {
      advanceLock.current = Date.now() + 3000
      applyNext(next, true)
      return
    }
    const sug = sugsRef.current[0]
    if (sug) {
      advanceLock.current = Date.now() + 3000
      applyNext({ qid: `s${Date.now()}`, kind: 'youtube', videoId: sug.videoId, label: sug.title.slice(0, 48) }, true)
      return
    }
    setUiPlaying(false)
  }, [applyNext])
  function pushQueueItem(item: QueueItem) {
    const items = [...queueRef.current, item]
    setQueue(items)
    sendTgRef.current({ a: 'queue', items })
    pushNotice('🎬 Added to Up Next — for both of you')
  }
  async function addToQueue() {
    const yt = ytIdFrom(addUrl)
    const drive = yt ? null : driveIdFrom(addUrl)
    if (!yt && !drive) return
    setAddUrl('')
    setAddOpen(false)
    // queue entries carry the real video title so Up Next reads like a playlist
    const label = yt ? (await fetchYtTitle(yt))?.slice(0, 48) ?? 'YouTube video' : 'Drive video'
    pushQueueItem(yt
      ? { qid: `q${Date.now()}-${++qSeq.current}`, kind: 'youtube', videoId: yt, label }
      : { qid: `q${Date.now()}-${++qSeq.current}`, kind: 'drive', fileId: drive!, label })
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
  // reset per-source state whenever a new video comes on (Drive spinner/fallback
  // + the measured aspect ratio, so the window re-fits the next clip)
  useEffect(() => {
    setVideoAspect(null)
    if (current.kind === 'drive') { setDriveLoading(true); setDriveFallback(false) }
  }, [current.kind,
    current.kind === 'youtube' ? current.videoId
      : current.kind === 'drive' ? current.fileId
      : current.kind === 'media' ? current.msgId : ''])
  // if the direct <video> hasn't loaded within 8s (Drive served an HTML page
  // instead of the file, or the codec isn't supported), drop to the iframe.
  // A plain onError often never fires for the HTML-page case — hence a timer.
  useEffect(() => {
    if (current.kind !== 'drive' || driveFallback) return
    const t = setTimeout(() => { if (driveLoadingRef.current) setDriveFallback(true) }, 8000)
    return () => clearTimeout(t)
  }, [current.kind, current.kind === 'drive' ? current.fileId : '', driveFallback])

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
  // show the REAL video title in the header (keyless oEmbed lookup)
  const [ytTitle, setYtTitle] = useState<string | null>(null)
  useEffect(() => {
    setYtTitle(null)
    if (current.kind !== 'youtube') return
    let dead = false
    void fetchYtTitle(current.videoId).then((t) => { if (!dead && t) setYtTitle(t) })
    return () => { dead = true }
  }, [current.kind, current.kind === 'youtube' ? current.videoId : ''])
  const title = current.kind === 'youtube'
    ? (ytTitle ?? 'YouTube video')
    : ('name' in current && current.name) ? current.name : 'Watching together'

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

  // Drive uses our synced transport when streamed as a <video>; only the
  // iframe fallback (cross-origin) can't be driven by it
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
        style={!fs && isVideo
          ? { aspectRatio: String(current.kind === 'youtube' ? 16 / 9 : (videoAspect ?? 16 / 9)), maxHeight: '55vh' }
          : undefined}
        className={cn('relative shrink-0 overflow-hidden bg-black',
          fs ? 'h-full w-full rounded-none' : 'mx-3 rounded-3xl ring-1 ring-white/15',
          !isVideo && !fs && 'h-32')}>
        {current.kind === 'youtube' && <div id="tg-yt" className="h-full w-full" />}
        {current.kind === 'drive' && (
          driveFallback ? (
            // Drive won't stream this file directly → its own /preview player.
            // Displays reliably, but can't be synced (cross-origin, no API).
            <iframe
              src={`https://drive.google.com/file/d/${current.fileId}/preview`}
              className="absolute inset-0 h-full w-full border-0"
              allow="autoplay; fullscreen"
              allowFullScreen
              title="Google Drive player"
            />
          ) : (
            // direct stream in a real <video> → goes through the SAME synced
            // transport as device media (play/pause/seek stay in lockstep)
            <>
              <video
                ref={mediaRef}
                src={`https://drive.usercontent.google.com/download?id=${current.fileId}&export=download&confirm=t`}
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  setDriveLoading(false)
                  const v = e.currentTarget
                  if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight)
                }}
                onError={() => setDriveFallback(true)}
                onPlay={() => setUiPlaying(true)}
                onPause={() => setUiPlaying(false)}
                onEnded={handleEnded}
              />
              {driveLoading && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/25 border-t-white/90" />
                  <span className="text-xs text-white/60">Loading Drive video…</span>
                </div>
              )}
            </>
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
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight)
                }}
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

        {/* Drive plays in its own iframe (no custom transport bar), so give it a
            standalone fullscreen toggle — the app's fullscreen button otherwise
            lives in that bar. Fullscreening boxRef makes the iframe fill screen. */}
        {current.kind === 'drive' && driveFallback && (
          // the iframe fallback has no transport bar → give it a fullscreen
          // toggle (top-LEFT, clear of Drive's own popout icon top-right)
          <button onClick={toggleFs} aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'}
            className="absolute left-2 top-2 z-[8] rounded-full bg-black/55 p-2 text-white/90 backdrop-blur active:scale-90">
            {fs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}

        {/* tap shield: makes tap = play/pause on every player type */}
        {showTransport && <div className="absolute inset-0 z-[5]" onClick={togglePlay} />}
        {/* the unified transport — the ONLY thing that syncs */}
        {showTransport && (
          <div className="absolute inset-x-0 bottom-0 z-[8] flex items-center gap-1.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pb-2 pt-7 sm:gap-2 sm:px-3">
            <button onClick={togglePlay} aria-label={uiPlaying ? 'Pause for both' : 'Play for both'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow active:scale-90">
              {uiPlaying ? <Pause size={16} className="fill-current" /> : <Play size={16} className="ml-0.5 fill-current" />}
            </button>
            <button onClick={() => seekBoth(Math.max(0, cur - 10))} aria-label="Back 10 seconds"
              className="flex shrink-0 items-center rounded-full p-1 text-white/85 active:scale-90">
              <RotateCcw size={16} />
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
              className="flex shrink-0 items-center rounded-full p-1 text-white/85 active:scale-90">
              <RotateCw size={16} />
            </button>
            <span className="shrink-0 font-mono text-[10px] font-bold text-white/60">{fmtTime(dur)}</span>
            {isVideo && (
              <button onClick={toggleFs} aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'}
                className="shrink-0 rounded-full p-1.5 text-white/85 active:scale-90">
                {fs ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            )}
            {/* fullscreen-only: chat + live voice-call controls stay reachable */}
            {fs && (
              <button onClick={() => setFsChat((o) => !o)} aria-label="Chat"
                className={cn('shrink-0 rounded-full p-1.5 active:scale-90', fsChat ? 'bg-white/25 text-white' : 'text-white/85')}>
                <MessageCircle size={15} />
              </button>
            )}
            {/* call buttons live in the top-right call corner — 11 controls
                in this row crushed the scrub bar to nothing on 360px */}
          </div>
        )}

        {/* fullscreen call status pill */}
        {fs && callInfo && callInfo.state !== 'idle' && (
          <div className="pointer-events-none absolute left-2 top-2 z-[9] rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white/90">
            {callInfo.state === 'live' ? `${callInfo.camOn || callInfo.remoteCamOn ? '🎥' : '🎙'} In call with ${partnerName}` : callInfo.state === 'incoming' ? `📞 ${partnerName} is calling — exit fullscreen to answer` : '📞 Connecting…'}
          </div>
        )}

        {/* the call corner — faces ride the video's top-right in BOTH modes
            (watch-party style; the global floating panel steps aside via
            tgOpen, and native fullscreen only renders inside this box).
            Fullscreen adds the call buttons here — the transport row is full. */}
        {/* eslint-disable react-hooks/refs -- callback refs ARE the render-time
            attach point; the rule taints the whole hook return through them */}
        {callInfo && (fs || callInfo.remoteCamOn || callInfo.camOn) && (
          <div className="absolute right-2 top-2 z-[9] flex flex-col items-end gap-1.5">
            {callInfo.remoteCamOn && (
              <video ref={callInfo.attachRemoteVideo} autoPlay playsInline muted
                className={cn('pointer-events-none aspect-[3/4] rounded-xl bg-black/60 object-cover shadow-lg ring-1 ring-white/20', fs ? 'w-28' : 'w-16')} />
            )}
            {callInfo.camOn && (
              <button onClick={callInfo.flipCam} aria-label="Flip camera" className="relative active:scale-95">
                <video ref={callInfo.attachLocalVideo} autoPlay playsInline muted
                  className={cn('aspect-[3/4] -scale-x-100 rounded-xl bg-black/60 object-cover shadow-lg ring-1 ring-white/20', fs ? 'w-20' : 'w-12')} />
                <SwitchCamera size={12} className="absolute bottom-1 right-1 text-white/80" />
              </button>
            )}
            {fs && (
              <div className="flex gap-1.5">
                {callInfo.state === 'idle' ? (
                  <>
                    <button onClick={callInfo.start} aria-label="Start voice call"
                      className="rounded-full bg-black/55 p-2 text-emerald-400 active:scale-90">
                      <Phone size={15} />
                    </button>
                    <button onClick={callInfo.startVideo} aria-label="Start video call"
                      className="rounded-full bg-black/55 p-2 text-sky-400 active:scale-90">
                      <Video size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={callInfo.toggleCam} aria-label={callInfo.camOn ? 'Turn camera off' : 'Turn camera on'}
                      className={cn('rounded-full bg-black/55 p-2 active:scale-90', callInfo.camOn ? 'text-sky-400' : 'text-white/85')}>
                      {callInfo.camOn ? <Video size={15} /> : <VideoOff size={15} />}
                    </button>
                    <button onClick={callInfo.toggleMute} aria-label={callInfo.muted ? 'Unmute' : 'Mute'}
                      className={cn('rounded-full bg-black/55 p-2 active:scale-90', callInfo.muted ? 'text-rose-400' : 'text-white/85')}>
                      {callInfo.muted ? <MicOff size={15} /> : <Mic size={15} />}
                    </button>
                    <button onClick={callInfo.end} aria-label="End call"
                      className="rounded-full bg-rose-500 p-2 text-white active:scale-90">
                      <PhoneOff size={15} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {/* eslint-enable react-hooks/refs */}

        {/* fullscreen chat sheet — the conversation, over the video */}
        {fs && fsChat && (
          <div className="absolute inset-x-0 bottom-[52px] z-[9] flex h-[46%] flex-col rounded-t-2xl bg-black/80 backdrop-blur-sm">
            <div className="flex shrink-0 items-center justify-center gap-1 py-1">
              {['❤️', '😂', '🔥', '😮', '👏', '💯'].map((e) => (
                <button key={e} onClick={() => { pushEmote(e); sendTg({ a: 'emote', e }) }}
                  className="rounded-full bg-white/10 px-2 py-0.5 text-base active:scale-90">
                  {e}
                </button>
              ))}
            </div>
            {chatNode}
          </div>
        )}

        {/* one real tap unblocks playback on this device */}
        {needsTap && !(current.kind === 'drive' && driveFallback) && !(current.kind === 'media' && mediaGone) && (
          <button onClick={tapStart}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/55 text-white">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-500 shadow-lg">
              <Play size={26} className="ml-1 fill-current" />
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
          ? 'Drive player — press play on both phones (this file can’t be synced).'
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

      {/* More like this — tap to queue; when the queue is empty the first
          suggestion auto-plays at the end, YouTube-style, for both */}
      {sugs.length > 0 && (
        <div className="shrink-0 px-3 pb-1.5">
          <div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-white/40">
            More like this <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">auto-play on</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sugs.map((s) => (
              <button key={s.videoId}
                onClick={() => pushQueueItem({ qid: `q${Date.now()}-${++qSeq.current}`, kind: 'youtube', videoId: s.videoId, label: s.title.slice(0, 48) })}
                className="w-32 shrink-0 text-left active:scale-95">
                {s.thumb && <img src={s.thumb} alt="" loading="lazy" className="aspect-video w-full rounded-lg object-cover ring-1 ring-white/10" />}
                <span className="mt-0.5 line-clamp-2 text-[10px] font-semibold leading-tight text-white/80">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* chat rides along under the player (single instance — moves into
          the fullscreen sheet when that's open) */}
      {!(fs && fsChat) && chatNode}

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

// ---------- live voice / video call (WebRTC over the chat channel) ----------
export type RtcPayload = {
  t: 'offer' | 'answer' | 'ice' | 'end' | 'cam' | 'screen'
  from: string
  sdp?: RTCSessionDescriptionInit
  cand?: RTCIceCandidateInit
  // offer only: ring as a VIDEO call (camera goes on for both on accept)
  video?: boolean
  // 'cam' / 'screen' only: that source just switched on / off mid-call
  on?: boolean
}
export type CallState = 'idle' | 'incoming' | 'connecting' | 'answered' | 'live' | 'failed' | 'mic'

// ===========================================================================
// TURN / STUN relay config.
//
// Cross-carrier calls (Jio↔Airtel↔Vi) sit behind carrier-grade NAT on BOTH
// ends, so they can ONLY connect through a TURN relay. Free public relays are
// all dead (verified 2026-07-14), so a credentialed relay is REQUIRED for the
// mobile-data scenario. STUN alone covers same-WiFi and most different-WiFi.
//
// TWO ways to supply the relay — either works, no other code change needed:
//   1. Build-time env: VITE_TURN_URLS (comma-sep) + VITE_TURN_USERNAME +
//      VITE_TURN_CREDENTIAL  (best for Vercel — set in project env vars).
//   2. Hardcode below in MANAGED_TURN (simplest — paste and rebuild).
//
// Fill ONE of them with a Metered.ca free-tier relay or a self-hosted Coturn
// (see coturn/ in this repo). The relay is placed FIRST so ICE prefers it.
// ===========================================================================
// Metered.ca relay (free tier) — verified 2026-07-14 to connect a forced
// relay-only peer connection (the Jio↔Airtel path) in ~1.5s. TURN creds are
// necessarily client-visible (every WebRTC app ships them); they're scoped to
// relay use and rate-limited per account. global.* is anycast → nearest POP.
const MANAGED_TURN: RTCIceServer | null = {
  urls: [
    'turn:global.relay.metered.ca:80',
    'turn:global.relay.metered.ca:80?transport=tcp',
    'turn:global.relay.metered.ca:443',
    'turns:global.relay.metered.ca:443?transport=tcp',
  ],
  username: '6d9593a30c0b5e00da3eddae',
  credential: 'A7l6OrGcMu8xvNab',
}

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ],
    },
  ]
  const env = import.meta.env as Record<string, string | undefined>
  const urls = env.VITE_TURN_URLS?.split(',').map((s) => s.trim()).filter(Boolean)
  if (urls?.length && env.VITE_TURN_USERNAME && env.VITE_TURN_CREDENTIAL) {
    servers.unshift({ urls, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL })
  } else if (MANAGED_TURN) {
    servers.unshift(MANAGED_TURN)
  }
  return servers
}

export function useVoiceCall({ meId, sendRtc }: { meId: string | undefined; sendRtc: (p: Omit<RtcPayload, 'from'>) => void }) {
  const [state, setState] = useState<CallState>('idle')
  const [muted, setMuted] = useState(false)
  // camera: OFF by default — every call starts as voice, video is a switch
  const [camOn, setCamOn] = useState(false)
  const [remoteCamOn, setRemoteCamOn] = useState(false)
  // screen share rides the SAME single video sender as the camera (mutually
  // exclusive on the wire — you send either your face or your screen), so no
  // second m-line and no track-identification guesswork on the receiver
  const [screenOn, setScreenOn] = useState(false)
  const [remoteScreenOn, setRemoteScreenOn] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  // audio output: false = earpiece (default for voice), true = loudspeaker
  const [speakerOn, setSpeakerOn] = useState(false)
  const audioStarted = useRef(false)
  const screenStreamRef = useRef<MediaStream | null>(null)
  // true while screen share is served by native MediaProjection (Android app)
  const nativeScreenRef = useRef(false)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const videoSenderRef = useRef<RTCRtpSender | null>(null)
  const facingRef = useRef<'user' | 'environment'>('user')
  const incomingVideoRef = useRef(false)
  const remoteStream = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  // video tiles live in MORE than one place at once (floating panel, the
  // fullscreen watch player) — every mounted element gets the same stream
  const localVideoEls = useRef(new Set<HTMLVideoElement>())
  const remoteVideoEls = useRef(new Set<HTMLVideoElement>())
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

  /** Ref for MY camera preview tiles (mirrored, muted). */
  const attachLocalVideo = useCallback((el: HTMLVideoElement | null) => {
    // unmounts arrive as null — prune whatever left the DOM
    localVideoEls.current.forEach((e) => { if (!e.isConnected) localVideoEls.current.delete(e) })
    if (!el) return
    el.muted = true
    localVideoEls.current.add(el)
    if (camStreamRef.current) {
      el.srcObject = camStreamRef.current
      void el.play().catch(() => {})
    }
  }, [])

  /** Ref for the PARTNER's video tiles — muted, sound stays on the audio sink. */
  const attachRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoEls.current.forEach((e) => { if (!e.isConnected) remoteVideoEls.current.delete(e) })
    if (!el) return
    el.muted = true
    remoteVideoEls.current.add(el)
    if (remoteStream.current) {
      el.srcObject = remoteStream.current
      void el.play().catch(() => {})
    }
  }, [])

  const stopCam = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current = null
    localVideoEls.current.forEach((el) => { el.srcObject = null })
    setCamOn(false)
  }, [])

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    stopCam()
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setScreenOn(false)
    setRemoteScreenOn(false)
    setScreenError(null)
    videoSenderRef.current = null
    facingRef.current = 'user'
    incomingVideoRef.current = false
    setRemoteCamOn(false)
    // drop the dead stream too, or the next call re-attaches silence
    remoteStream.current = null
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    remoteVideoEls.current.forEach((el) => { el.srcObject = null })
    pcRef.current?.close()
    pcRef.current = null
    pendingOffer.current = null
    candBuffer.current = []
    roleRef.current = null
    restarted.current = false
    setMuted(false)
  }, [stopCam])

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
      iceServers: buildIceServers(),
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
      remoteVideoEls.current.forEach((v) => {
        v.srcObject = e.streams[0]
        void v.play().catch(() => {})
      })
      if (e.track.kind === 'video') {
        // the partner's camera: replaceTrack(null) on their side mutes the
        // track here, so mute/unmute doubles as the on/off signal even when
        // the explicit 'cam' event is lost
        setRemoteCamOn(true)
        e.track.onmute = () => setRemoteCamOn(false)
        e.track.onunmute = () => setRemoteCamOn(true)
        e.track.onended = () => setRemoteCamOn(false)
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
    // camera already rolling (video call being placed) — ship it in the
    // SAME stream so the remote side keeps one stream for audio AND video
    const camTrack = camStreamRef.current?.getVideoTracks()[0]
    if (camTrack) videoSenderRef.current = pc.addTrack(camTrack, stream)
    pcRef.current = pc
    return pc
  }, [cleanup, sendRtc])

  /** Turn the camera on and preview it locally; the caller wires it to the pc. */
  const acquireCam = useCallback(async () => {
    const cam = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingRef.current, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } },
    })
    camStreamRef.current = cam
    localVideoEls.current.forEach((el) => {
      el.srcObject = cam
      void el.play().catch(() => {})
    })
    setCamOn(true)
    return cam.getVideoTracks()[0]
  }, [])

  const failState = (e: unknown): CallState =>
    e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'SecurityError')
      ? 'mic'
      : 'failed'

  const startCall = useCallback(async (opts?: { video?: boolean }) => {
    try {
      roleRef.current = 'caller'
      if (opts?.video && !camStreamRef.current) {
        // camera blocked → still place the call, as voice
        try { await acquireCam() } catch { /* voice-only it is */ }
      }
      const pc = await makePc()
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sendRtc({ t: 'offer', sdp: offer, video: !!camStreamRef.current })
      setState('connecting')
    } catch (e) {
      setState(failState(e))
    }
  }, [acquireCam, makePc, sendRtc])

  const acceptCall = useCallback(async () => {
    const offer = pendingOffer.current
    if (!offer) return
    try {
      roleRef.current = 'callee'
      // answering a VIDEO call turns our camera on too (WhatsApp-style);
      // if the camera is blocked the call still connects with voice
      if (incomingVideoRef.current && !camStreamRef.current) {
        try { await acquireCam() } catch { /* voice-only it is */ }
      }
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
  }, [acquireCam, makePc, sendRtc])

  const toggleMute = useCallback(() => {
    const s = streamRef.current
    if (!s) return
    const next = !muted
    s.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }, [muted])

  /** Earpiece ↔ loudspeaker (native Android routing; no-op in a browser). */
  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((on) => {
      const next = !on
      callAudioSpeaker(next)
      return next
    })
  }, [])

  // Put a video track (camera OR screen) onto the ONE video sender. The first
  // time a call ever sends video this adds the m-line and renegotiates in
  // place; after that it's a zero-cost replaceTrack. replaceTrack(null) keeps
  // the sender alive and mutes the remote track — the on/off signal.
  const setVideoTrack = useCallback(async (track: MediaStreamTrack | null) => {
    const pc = pcRef.current
    if (!pc) return
    if (videoSenderRef.current) {
      await videoSenderRef.current.replaceTrack(track).catch(() => {})
      return
    }
    if (!track) return
    videoSenderRef.current = pc.addTrack(track, streamRef.current ?? new MediaStream([track]))
    // remote's offer handler answers live calls in place (no re-ring)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendRtc({ t: 'offer', sdp: offer })
  }, [sendRtc])

  /** The video switch — camera on/off any time during a call. */
  const toggleCam = useCallback(async () => {
    if (screenStreamRef.current) return // sharing screen — camera is paused
    if (camStreamRef.current) {
      await setVideoTrack(null)
      stopCam()
      sendRtc({ t: 'cam', on: false })
      return
    }
    if (!pcRef.current) return // camera is a mid-call switch — nothing to send it into
    try {
      const track = await acquireCam()
      await setVideoTrack(track)
      sendRtc({ t: 'cam', on: true })
    } catch {
      stopCam() // camera blocked / busy — the call carries on with voice
    }
  }, [acquireCam, sendRtc, setVideoTrack, stopCam])

  /** Stop screen sharing — restore the camera to the wire if it was on. */
  const stopScreen = useCallback(async () => {
    if (!screenStreamRef.current) return
    screenStreamRef.current.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    if (nativeScreenRef.current) {
      // stop native capture + unhook the frame receiver
      nativeScreenRef.current = false
      nativeScreenStop()
      const w = window as unknown as Record<string, unknown>
      delete w.__flScreenFrame
      delete w.__flScreenStopped
    }
    setScreenOn(false)
    // back to the camera if it's still on, else clear our video entirely
    const cam = camStreamRef.current?.getVideoTracks()[0] ?? null
    await setVideoTrack(cam)
    sendRtc({ t: 'screen', on: false })
    if (cam) sendRtc({ t: 'cam', on: true }) // remote relabels screen → face
  }, [sendRtc, setVideoTrack])

  /** Share this device's screen to the other side. Browser/desktop uses
   *  getDisplayMedia; the Android app has no getDisplayMedia so it uses native
   *  MediaProjection frames painted onto a canvas → canvas.captureStream(). */
  const startScreen = useCallback(async () => {
    if (!pcRef.current) return
    const gdm = navigator.mediaDevices?.getDisplayMedia

    // --- Android app: native screen capture piped through a canvas ---
    if (typeof gdm !== 'function') {
      if (!hasNativeScreen()) {
        setScreenError('Screen sharing isn’t supported on this device.')
        setTimeout(() => setScreenError(null), 4000)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const ctx = canvas.getContext('2d')
      const img = new Image()
      img.onload = () => {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
        }
        ctx?.drawImage(img, 0, 0)
      }
      const w = window as unknown as Record<string, unknown>
      w.__flScreenFrame = (b64: string) => { img.src = 'data:image/jpeg;base64,' + b64 }
      w.__flScreenStopped = () => { void stopScreen() }
      const stream = canvas.captureStream(8)
      screenStreamRef.current = stream
      nativeScreenRef.current = true
      setScreenOn(true)
      await setVideoTrack(stream.getVideoTracks()[0])
      sendRtc({ t: 'screen', on: true })
      nativeScreenStart() // fires the system "start casting?" prompt
      return
    }

    // --- browser / desktop: getDisplayMedia ---
    let disp: MediaStream
    try {
      disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    } catch {
      // user cancelled the picker, or the WebView blocks capture
      setScreenError('Couldn’t start screen sharing.')
      setTimeout(() => setScreenError(null), 4000)
      return
    }
    screenStreamRef.current = disp
    const track = disp.getVideoTracks()[0]
    // the browser's own "Stop sharing" bar ends the track — tidy up like our button
    track.onended = () => { void stopScreen() }
    setScreenOn(true)
    await setVideoTrack(track)
    sendRtc({ t: 'screen', on: true })
  }, [sendRtc, setVideoTrack, stopScreen])

  const toggleScreen = useCallback(() => {
    return screenStreamRef.current ? stopScreen() : startScreen()
  }, [startScreen, stopScreen])

  /** Front ↔ back camera; replaceTrack keeps the call untouched. */
  const flipCam = useCallback(async () => {
    if (!camStreamRef.current) return
    const old = camStreamRef.current
    facingRef.current = facingRef.current === 'user' ? 'environment' : 'user'
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingRef.current, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } },
      })
      old.getTracks().forEach((t) => t.stop())
      camStreamRef.current = cam
      localVideoEls.current.forEach((el) => {
        el.srcObject = cam
        void el.play().catch(() => {})
      })
      await videoSenderRef.current?.replaceTrack(cam.getVideoTracks()[0])
    } catch {
      // single-camera device — stay where we were
      facingRef.current = facingRef.current === 'user' ? 'environment' : 'user'
    }
  }, [])

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
      incomingVideoRef.current = !!p.video
      setState('incoming')
      navigator.vibrate?.([80, 60, 80])
    }
    if (p.t === 'cam') setRemoteCamOn(!!p.on)
    if (p.t === 'screen') setRemoteScreenOn(!!p.on)
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

  // Re-send the offer while ringing. Realtime broadcasts aren't persisted, so
  // a callee whose app was CLOSED misses the one-shot offer; the push wakes
  // them, and when they open the app (subscribing to their ring channel) they
  // catch the next re-offer within ~2.5s and the call connects. Stops the
  // moment they answer (state leaves 'connecting').
  useEffect(() => {
    if (state !== 'connecting' || roleRef.current !== 'caller') return
    const iv = setInterval(() => {
      const pc = pcRef.current
      if (pc?.localDescription) sendRtc({ t: 'offer', sdp: pc.localDescription, video: !!camStreamRef.current })
    }, 2500)
    return () => clearInterval(iv)
  }, [state, sendRtc])

  // route call audio natively: on connect, a video call starts on the
  // loudspeaker (hands-free) and a voice call on the earpiece; end restores
  // normal media routing. Browser = no-op (no earpiece concept).
  useEffect(() => {
    if (state === 'live' && !audioStarted.current) {
      audioStarted.current = true
      const speaker = camOn || remoteCamOn
      setSpeakerOn(speaker)
      callAudioStart(speaker)
    }
    if (state === 'idle' && audioStarted.current) {
      audioStarted.current = false
      callAudioEnd()
    }
  }, [state, camOn, remoteCamOn])

  // hang up if the component unmounts (leaving the conversation)
  useEffect(() => () => { cleanup(); if (audioStarted.current) { audioStarted.current = false; callAudioEnd() } }, [cleanup])

  const canScreenShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function' || hasNativeScreen()
  return { state, muted, camOn, remoteCamOn, screenOn, remoteScreenOn, screenError, canScreenShare, speakerOn, startCall, acceptCall, endCall, toggleMute, toggleCam, flipCam, toggleScreen, toggleSpeaker, handleRtc, attachEl, attachLocalVideo, attachRemoteVideo }
}

/** The in-chat call strip: incoming / connecting / live, with mute + hang up. */
export function VoiceCallBar({ call, partnerName, onExpand }: {
  call: ReturnType<typeof useVoiceCall>
  partnerName: string
  onExpand?: () => void
}) {
  // NOTE: the remote <audio> sink is owned by CallHost (always mounted) —
  // this bar is pure UI
  if (call.state === 'idle') return null
  const live = call.state === 'live'
  const kind = call.screenOn || call.remoteScreenOn ? 'Screen share' : call.camOn || call.remoteCamOn ? 'Video call' : 'Voice call'
  const StatusTag = onExpand ? 'button' : 'div'
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('mb-2 rounded-2xl border bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:bg-slate-900/95 sm:px-3.5',
        call.state === 'incoming' ? 'border-emerald-400/70' : call.state === 'failed' || call.state === 'mic' ? 'border-rose-400/60' : 'border-brand-400/50')}>
      <div className="flex items-center gap-2">
        {/* tapping the status area re-opens the full-screen call */}
        <StatusTag onClick={onExpand} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Phone size={16} className={cn('shrink-0',
            live ? 'text-emerald-500' : call.state === 'failed' || call.state === 'mic' ? 'text-rose-500' : 'animate-pulse text-brand-500')} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {call.state === 'incoming' && `${partnerName} is calling…`}
            {call.state === 'connecting' && `Calling ${partnerName}…`}
            {call.state === 'answered' && 'Connecting…'}
            {live && `${kind} · ${partnerName}`}
            {call.state === 'failed' && 'Call failed — the network blocked it.'}
            {call.state === 'mic' && 'Mic blocked — enable it in phone settings.'}
          </span>
        </StatusTag>
        {call.state === 'failed' && (
          <button onClick={() => void call.startCall()}
            className="shrink-0 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-black uppercase text-white shadow active:scale-95">
            Retry
          </button>
        )}
        {call.state === 'incoming' && (
          <button onClick={call.acceptCall}
            className="shrink-0 rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-black uppercase text-white shadow active:scale-95">
            Accept
          </button>
        )}
        {/* live controls: compact icon row, comfortably fits 360px */}
        {live && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={() => void call.toggleCam()} disabled={call.screenOn}
              aria-label={call.camOn ? 'Turn camera off' : 'Turn camera on'}
              className={cn('rounded-full p-2 transition active:scale-90 disabled:opacity-30',
                call.camOn ? 'bg-sky-500/15 text-sky-500' : 'bg-slate-500/10 text-slate-500 dark:text-slate-300')}>
              {call.camOn ? <Video size={15} /> : <VideoOff size={15} />}
            </button>
            {call.canScreenShare && (
              <button onClick={() => void call.toggleScreen()}
                aria-label={call.screenOn ? 'Stop sharing screen' : 'Share screen'}
                className={cn('rounded-full p-2 transition active:scale-90',
                  call.screenOn ? 'bg-violet-500/15 text-violet-500' : 'bg-slate-500/10 text-slate-500 dark:text-slate-300')}>
                {call.screenOn ? <MonitorOff size={15} /> : <MonitorUp size={15} />}
              </button>
            )}
            <button onClick={call.toggleSpeaker} aria-label={call.speakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
              className={cn('rounded-full p-2 transition active:scale-90',
                call.speakerOn ? 'bg-amber-500/15 text-amber-500' : 'bg-slate-500/10 text-slate-500 dark:text-slate-300')}>
              {call.speakerOn ? <Volume2 size={15} /> : <Volume1 size={15} />}
            </button>
            <button onClick={call.toggleMute} aria-label={call.muted ? 'Unmute' : 'Mute'}
              className={cn('rounded-full p-2 transition active:scale-90',
                call.muted ? 'bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-500 dark:text-slate-300')}>
              {call.muted ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button onClick={() => call.endCall(true)} aria-label="End call"
              className="rounded-full bg-rose-500 p-2 text-white shadow active:scale-90">
              <PhoneOff size={15} />
            </button>
          </div>
        )}
        {!live && call.state !== 'incoming' && call.state !== 'failed' && (
          <button onClick={() => call.endCall(true)} aria-label="End call"
            className="shrink-0 rounded-full bg-rose-500 p-2 text-white shadow active:scale-90">
            <PhoneOff size={15} />
          </button>
        )}
      </div>
      {call.screenError && (
        <div className="mt-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-500">
          {call.screenError}
        </div>
      )}
    </motion.div>
  )
}

/** A round control button for the full-screen call screen. */
function CallBtn({ onClick, on, active, danger, label, children }: {
  onClick: () => void; on?: boolean; active?: boolean; danger?: boolean; label: string; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} aria-label={label}
      className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full backdrop-blur transition active:scale-90 sm:h-14 sm:w-14',
        danger ? 'bg-rose-500 text-white shadow-lg'
          : active ? 'bg-white text-slate-900'
          : on ? 'bg-white/25 text-white' : 'bg-white/10 text-white')}>
      {children}
    </button>
  )
}

/**
 * Full-screen call screen (dialer-style), shown once a call is accepted — for
 * BOTH voice and video. Video/screen fills the screen; a voice call shows the
 * partner's avatar on a gradient. Minimizes to the floating bar so the app
 * stays usable. Mobile-first / responsive with safe-area insets.
 */
/* eslint-disable react-hooks/refs -- `call` carries callback refs (attach*Video)
   that are MEANT to be wired in render; the rule taints the whole hook return. */
export function CallScreen({ call, peerName, avatarUrl, onMinimize }: {
  call: ReturnType<typeof useVoiceCall>
  peerName: string
  avatarUrl?: string
  onMinimize: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (call.state !== 'live') return
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(iv)
  }, [call.state])

  const showRemoteVideo = call.remoteScreenOn || call.remoteCamOn
  const status = call.state === 'connecting' ? 'Calling…'
    : call.state === 'answered' ? 'Connecting…'
    : call.state === 'live' ? `${fmtTime(elapsed)}${call.remoteScreenOn ? ' · sharing screen' : ''}`
    : call.state === 'failed' ? 'Call failed — network blocked it'
    : call.state === 'mic' ? 'Microphone is blocked' : ''
  const live = call.state === 'live'

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[115] flex flex-col overflow-hidden bg-gradient-to-b from-[#131a2e] via-[#0d1120] to-black">
      {/* remote video / screen fills the screen; voice call shows the avatar */}
      {showRemoteVideo ? (
        <video ref={call.attachRemoteVideo} autoPlay playsInline muted
          className={cn('absolute inset-0 h-full w-full', call.remoteScreenOn ? 'object-contain' : 'object-cover')} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <span className={cn('absolute inset-0 -m-3 rounded-full bg-brand-400/30', !live && 'animate-ping')} />
            <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-purple-500 text-4xl font-bold text-white shadow-2xl sm:h-32 sm:w-32">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : peerName.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </div>
      )}

      {/* local camera preview — small, draggable-looking PIP, top-right */}
      {call.camOn && (
        <button onClick={() => void call.flipCam()} aria-label="Flip camera"
          className="absolute right-3 top-[calc(4rem+env(safe-area-inset-top))] z-10 active:scale-95">
          <video ref={call.attachLocalVideo} autoPlay playsInline muted
            className="aspect-[3/4] w-24 -scale-x-100 rounded-2xl bg-black object-cover shadow-xl ring-1 ring-white/25 sm:w-28" />
          <SwitchCamera size={15} className="absolute bottom-1.5 right-1.5 text-white/85" />
        </button>
      )}

      {/* top bar: minimize + name + status (over a scrim so it reads on video) */}
      <div className="relative z-10 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button onClick={onMinimize} aria-label="Minimize call"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur active:scale-90">
          <ChevronDown size={20} />
        </button>
        <div className="min-w-0 flex-1 text-white">
          <div className="truncate text-lg font-bold leading-tight">{peerName}</div>
          <div className="truncate text-sm text-white/70">{status}</div>
        </div>
      </div>

      <div className="flex-1" />

      {/* bottom controls — wrap-safe, fits 360px */}
      <div className="relative z-10 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-8">
        {call.screenError && (
          <div className="mx-auto mb-3 w-fit max-w-full rounded-lg bg-rose-500/20 px-3 py-1.5 text-center text-xs font-medium text-rose-200">
            {call.screenError}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {live && (
            <>
              <CallBtn onClick={call.toggleSpeaker} on={call.speakerOn} label={call.speakerOn ? 'Switch to earpiece' : 'Switch to speaker'}>
                {call.speakerOn ? <Volume2 size={22} /> : <Volume1 size={22} />}
              </CallBtn>
              <CallBtn onClick={call.toggleMute} active={call.muted} label={call.muted ? 'Unmute' : 'Mute'}>
                {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
              </CallBtn>
              <CallBtn onClick={() => void call.toggleCam()} on={call.camOn} label={call.camOn ? 'Turn camera off' : 'Turn camera on'}>
                {call.camOn ? <Video size={22} /> : <VideoOff size={22} />}
              </CallBtn>
              {call.canScreenShare && (
                <CallBtn onClick={() => void call.toggleScreen()} on={call.screenOn} label={call.screenOn ? 'Stop sharing screen' : 'Share screen'}>
                  {call.screenOn ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
                </CallBtn>
              )}
            </>
          )}
          {call.state === 'failed' && (
            <CallBtn onClick={() => void call.startCall()} on label="Retry"><Phone size={22} /></CallBtn>
          )}
          <CallBtn onClick={() => call.endCall(true)} danger label="End call"><PhoneOff size={24} /></CallBtn>
        </div>
      </div>
    </motion.div>
  )
}
/* eslint-enable react-hooks/refs */
