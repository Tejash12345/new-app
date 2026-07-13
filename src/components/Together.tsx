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
import { Clapperboard, Mic, MicOff, Music, Phone, PhoneOff, X } from 'lucide-react'
import { cn } from '../lib/utils'

export type TogetherSession =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'media'; msgId: string; name?: string; isVideo?: boolean }
  | { kind: 'drive'; fileId: string; name?: string }

export type TgPayload = {
  a: 'open' | 'state' | 'close' | 'emote' | 'join'
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
  // content-based echo detection: after applying the partner's play/pause we
  // EXPECT our own player to emit that same event — swallow it whenever it
  // arrives (mobile buffering can delay it 5s+, far past any time window)
  const expectedEcho = useRef<{ playing: boolean; until: number } | null>(null)
  const expectEcho = (playing: boolean) => {
    expectedEcho.current = { playing, until: Date.now() + 8000 }
  }
  const DRIFT_S = 5 // mobile buffering makes small gaps normal — don't chase them
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
  // our own YouTube transport (native controls are hidden): phones' players
  // pause/resume by themselves, and taps inside the iframe are invisible to
  // us — with our controls, ONLY real button presses ever broadcast
  const [uiPlaying, setUiPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
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

  const broadcastState = useCallback((playing: boolean, t: number) => {
    const exp = expectedEcho.current
    if (exp && Date.now() < exp.until && exp.playing === playing) {
      // that's our player confirming the state we applied — not the user
      expectedEcho.current = null
      return
    }
    if (Date.now() < applyingRemote.current) return
    expectedEcho.current = null
    iDrive.current = true
    sendTg({ a: 'state', playing, t, at: Date.now() })
  }, [sendTg])

  // apply the partner's play/pause/seek, with drift correction
  useEffect(() => {
    registerTgHandler((p) => {
      if (p.from === meId) return
      if (p.a === 'emote' && p.e) {
        pushEmote(p.e)
        return
      }
      if (p.a === 'join') {
        setPartnerHere(true)
        pushNotice(`🎉 ${partnerName} joined the room`)
        navigator.vibrate?.(15)
        // greet the newcomer with our position so they sync instantly
        if (iDrive.current) {
          const yt = ytRef.current
          const el = mediaRef.current
          if (yt && window.YT && yt.getPlayerState() === window.YT.PlayerState.PLAYING) {
            sendTgRef.current({ a: 'state', playing: true, t: yt.getCurrentTime(), at: Date.now() })
          } else if (el && !el.paused) {
            sendTgRef.current({ a: 'state', playing: true, t: el.currentTime, at: Date.now() })
          }
        }
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
        const yt2 = ytRef.current
        const el2 = mediaRef.current
        if (p.playing && (yt2 || el2)) {
          iDrive.current = false
          applyingRemote.current = Date.now() + ECHO_MS
          expectEcho(true)
          const exp = p.t + (Date.now() - p.at) / 1000
          if (yt2) {
            yt2.mute()
            if (exp > 1) yt2.seekTo(exp, true)
            yt2.playVideo()
          }
          if (el2) {
            el2.muted = true
            if (exp > 1) el2.currentTime = exp
            void el2.play().catch(() => {})
          }
          setNeedsTap(false)
          setSoundGate(true)
        }
        return
      }
      // the partner acted — they drive now, we follow silently
      iDrive.current = false
      const expected = p.playing ? p.t + (Date.now() - p.at) / 1000 : p.t
      const yt = ytRef.current
      const el = mediaRef.current
      const localT = yt ? yt.getCurrentTime() : el ? el.currentTime : 0
      const localPlaying = yt
        ? (window.YT ? yt.getPlayerState() === window.YT.PlayerState.PLAYING : false)
        : el ? !el.paused : false
      // already aligned → touch nothing (re-applying is what caused the
      // stop/resume stutter: every apply kicked off buffering + echo events)
      if (localPlaying === !!p.playing && Math.abs(localT - expected) < DRIFT_S) return
      applyingRemote.current = Date.now() + ECHO_MS
      if (localPlaying !== !!p.playing) expectEcho(!!p.playing)
      // when catching up mid-playback, land slightly AHEAD so our own
      // buffering doesn't leave us behind again (the "chasing" stutter)
      const target = expected + (p.playing ? 1 : 0)
      if (yt) {
        if (Math.abs(localT - expected) >= DRIFT_S) yt.seekTo(target, true)
        if (p.playing) yt.playVideo()
        else yt.pauseVideo()
      }
      if (el) {
        if (Math.abs(localT - expected) >= DRIFT_S) el.currentTime = target
        if (p.playing) void el.play().catch(() => {})
        else el.pause()
      }
    })
    return () => registerTgHandler(() => {})
  }, [registerTgHandler, meId, pushEmote, pushNotice, partnerName])

  // youtube player
  useEffect(() => {
    if (session.kind !== 'youtube') return
    let dead = false
    void loadYouTubeApi().then(() => {
      if (dead || !window.YT) return
      ytRef.current = new window.YT.Player('tg-yt', {
        videoId: session.videoId,
        width: '100%',
        height: '100%',
        // controls: 0 — the iframe swallows taps and phone players stop and
        // start on their own; with YouTube's UI hidden, the only events that
        // sync are the ones from OUR transport bar below
        playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, origin: window.location.origin },
        events: {
          onStateChange: (e: { data: number }) => {
            if (!window.YT) return
            setUiPlaying(e.data === window.YT.PlayerState.PLAYING)
          },
        },
      })
    })
    return () => {
      dead = true
      ytRef.current?.destroy()
      ytRef.current = null
    }
  }, [session.kind, session.kind === 'youtube' ? session.videoId : '', broadcastState])

  // chat-attachment player (from the device vault)
  useEffect(() => {
    if (session.kind !== 'media') return
    let dead = false
    void resolveMediaUrl(session.msgId).then((url) => {
      if (dead) return
      if (url) setMediaUrl(url)
      else setMediaGone(true)
    })
    return () => { dead = true }
  }, [session.kind, session.kind === 'media' ? session.msgId : '', resolveMediaUrl])

  // gentle heartbeat so a missed event can't leave the two sides apart —
  // only the driving side speaks, so heartbeats can't ping-pong
  useEffect(() => {
    const iv = setInterval(() => {
      if (!iDrive.current) return
      const yt = ytRef.current
      const el = mediaRef.current
      if (yt && window.YT && yt.getPlayerState() === window.YT.PlayerState.PLAYING) {
        broadcastState(true, yt.getCurrentTime())
      } else if (el && !el.paused) {
        broadcastState(true, el.currentTime)
      }
    }, 7000)
    return () => clearInterval(iv)
  }, [broadcastState])

  const isVideo = session.kind === 'youtube' || session.kind === 'drive' || (session.kind === 'media' && session.isVideo)
  const title = ('name' in session && session.name) ? session.name : 'Watching together'

  /** First real tap on this device — unblocks playback and catches up to the partner. */
  function tapStart() {
    setNeedsTap(false)
    const pend = pendingState.current
    const expected = pend ? (pend.playing ? pend.t + (Date.now() - pend.at) / 1000 : pend.t) : 0
    if (pend) {
      // catching up to the partner — we're the follower, stay quiet
      iDrive.current = false
      applyingRemote.current = Date.now() + ECHO_MS
      expectEcho(pend.playing)
    }
    const yt = ytRef.current
    if (yt) {
      if (expected > 1) yt.seekTo(expected, true)
      yt.playVideo()
    }
    const el = mediaRef.current
    if (el) {
      if (expected > 1) el.currentTime = expected
      void el.play().catch(() => {})
    }
    // the starter's kick-off is a real user action — tell the partner
    // (player events no longer broadcast, so this must be explicit)
    if (!pend) userAction(true, expected)
  }

  // transport-bar position poll (UI only)
  useEffect(() => {
    if (session.kind !== 'youtube') return
    const iv = setInterval(() => {
      const yt = ytRef.current
      if (!yt) return
      try {
        setCur(yt.getCurrentTime() || 0)
        setDur(yt.getDuration() || 0)
      } catch { /* player still booting */ }
    }, 500)
    return () => clearInterval(iv)
  }, [session.kind])

  /** A REAL user action on our transport — always broadcasts, no echo guards. */
  function userAction(playing: boolean, t: number) {
    expectedEcho.current = null
    applyingRemote.current = 0
    iDrive.current = true
    sendTg({ a: 'state', playing, t, at: Date.now() })
  }
  function togglePlay() {
    const yt = ytRef.current
    if (!yt) return
    const t = yt.getCurrentTime()
    if (uiPlaying) {
      yt.pauseVideo()
      userAction(false, t)
    } else {
      yt.playVideo()
      userAction(true, t)
    }
  }
  function seekYt(v: number) {
    const yt = ytRef.current
    if (!yt) return
    yt.seekTo(v, true)
    setCur(v)
    userAction(uiPlaying, v)
  }

  /** The tap that turns sound on after a muted autoplay start. */
  function tapSound() {
    setSoundGate(false)
    applyingRemote.current = Date.now() + ECHO_MS
    const yt = ytRef.current
    if (yt) {
      yt.unMute()
      yt.playVideo()
    }
    const el = mediaRef.current
    if (el) {
      el.muted = false
      void el.play().catch(() => {})
    }
  }
  const mediaEvents = {
    onPlay: (e: React.SyntheticEvent<HTMLVideoElement>) => broadcastState(true, e.currentTarget.currentTime),
    onPause: (e: React.SyntheticEvent<HTMLVideoElement>) => broadcastState(false, e.currentTarget.currentTime),
    onSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => broadcastState(!e.currentTarget.paused, e.currentTarget.currentTime),
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[85] flex flex-col bg-[#06050d]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-white">
          {session.kind === 'media' && !session.isVideo
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

      <div className={cn('relative mx-3 shrink-0 overflow-hidden rounded-3xl ring-1 ring-white/15', isVideo ? 'aspect-video' : 'p-3 sm:p-4')}>
        {session.kind === 'youtube' && (
          <>
            <div id="tg-yt" className="h-full w-full" />
            {/* tap shield: the iframe eats taps — this makes tap = play/pause */}
            {!needsTap && <div className="absolute inset-0 z-[5]" onClick={togglePlay} />}
            {/* our transport bar — the ONLY thing that syncs */}
            {!needsTap && (
              <div className="absolute inset-x-0 bottom-0 z-[8] flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-2 pt-7">
                <button onClick={togglePlay} aria-label={uiPlaying ? 'Pause for both' : 'Play for both'}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow active:scale-90">
                  {uiPlaying ? '❚❚' : '▶'}
                </button>
                <span className="shrink-0 font-mono text-[10px] font-bold text-white/85">{fmtTime(cur)}</span>
                <input
                  type="range" min={0} max={Math.max(1, dur)} step={1} value={Math.min(cur, dur || cur)}
                  onChange={(e) => seekYt(Number(e.target.value))}
                  aria-label="Seek for both"
                  className="h-1.5 min-w-0 flex-1 cursor-pointer accent-amber-400"
                />
                <span className="shrink-0 font-mono text-[10px] font-bold text-white/60">{fmtTime(dur)}</span>
              </div>
            )}
          </>
        )}
        {session.kind === 'drive' && (
          driveFallback ? (
            // Drive refused direct playback — its own player still works for
            // both, just without automatic sync
            <iframe
              src={`https://drive.google.com/file/d/${session.fileId}/preview`}
              className="h-full w-full"
              allow="autoplay"
              title="Google Drive player"
            />
          ) : (
            <video
              ref={mediaRef}
              src={`https://drive.google.com/uc?export=download&id=${session.fileId}`}
              controls
              playsInline
              className="h-full w-full object-contain"
              onError={() => setDriveFallback(true)}
              {...mediaEvents}
            />
          )
        )}
        {session.kind === 'media' && (
          mediaGone ? (
            <p className="py-8 text-center text-sm text-white/60">
              This file isn't on your device anymore — media lives on the phones that exchanged it.
            </p>
          ) : mediaUrl ? (
            <video
              ref={mediaRef}
              src={mediaUrl}
              controls
              playsInline
              className={cn('w-full', session.isVideo ? 'h-full object-contain' : 'h-14')}
              {...mediaEvents}
            />
          ) : (
            <div className="h-14 w-full animate-pulse rounded-xl bg-white/10" />
          )
        )}
        {/* one real tap unblocks playback on this device */}
        {needsTap && !(session.kind === 'drive' && driveFallback) && !(session.kind === 'media' && mediaGone) && (
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
            className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-black text-slate-900 shadow-xl active:scale-95">
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
        {session.kind === 'drive' && driveFallback
          ? 'Drive player mode — press play on both phones.'
          : partnerHere
            ? `In sync with ${partnerName} 🎧`
            : `Waiting for ${partnerName} to join…`}
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
export type CallState = 'idle' | 'incoming' | 'connecting' | 'live' | 'failed' | 'mic'

export function useVoiceCall({ meId, sendRtc }: { meId: string | undefined; sendRtc: (p: Omit<RtcPayload, 'from'>) => void }) {
  const [state, setState] = useState<CallState>('idle')
  const [muted, setMuted] = useState(false)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const remoteStream = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null)
  const candBuffer = useRef<RTCIceCandidateInit[]>([])

  // callback ref: the <audio> element moves between the chat and the
  // Together overlay, so re-attach the remote stream on every mount
  const attachEl = useCallback((el: HTMLAudioElement | null) => {
    remoteAudioRef.current = el
    if (el && remoteStream.current) el.srcObject = remoteStream.current
  }, [])

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    pendingOffer.current = null
    candBuffer.current = []
    setMuted(false)
  }, [])

  const endCall = useCallback((notify = true) => {
    if (notify) sendRtc({ t: 'end' })
    cleanup()
    setState('idle')
  }, [cleanup, sendRtc])

  const makePc = useCallback(async () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // free public TURN relay — mobile carriers usually block direct
        // peer-to-peer, so calls ride this relay when punching through fails
        {
          urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    })
    pc.onicecandidate = (e) => { if (e.candidate) sendRtc({ t: 'ice', cand: e.candidate.toJSON() }) }
    pc.ontrack = (e) => {
      remoteStream.current = e.streams[0]
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0]
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setState('live')
      if (pc.connectionState === 'failed') { cleanup(); setState('failed') }
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') { cleanup(); setState('idle') }
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
      const pc = await makePc()
      await pc.setRemoteDescription(offer)
      for (const c of candBuffer.current) await pc.addIceCandidate(c).catch(() => {})
      candBuffer.current = []
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendRtc({ t: 'answer', sdp: answer })
      setState('connecting')
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
      pendingOffer.current = p.sdp
      setState('incoming')
      navigator.vibrate?.([80, 60, 80])
    }
    if (p.t === 'answer' && p.sdp) void pcRef.current?.setRemoteDescription(p.sdp).catch(() => {})
    if (p.t === 'ice' && p.cand) {
      if (pcRef.current?.remoteDescription) void pcRef.current.addIceCandidate(p.cand).catch(() => {})
      else candBuffer.current.push(p.cand)
    }
    if (p.t === 'end') { cleanup(); setState('idle') }
  }, [meId, cleanup])

  // hang up if the component unmounts (leaving the conversation)
  useEffect(() => () => { cleanup() }, [cleanup])

  return { state, muted, startCall, acceptCall, endCall, toggleMute, handleRtc, attachEl }
}

/** The in-chat call strip: incoming / connecting / live, with mute + hang up. */
export function VoiceCallBar({ call, partnerName }: {
  call: ReturnType<typeof useVoiceCall>
  partnerName: string
}) {
  if (call.state === 'idle') return <audio ref={call.attachEl} autoPlay className="hidden" />
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('mb-2 flex items-center gap-2 rounded-2xl border bg-white px-3 py-2.5 shadow-md dark:bg-slate-900 sm:gap-2.5 sm:px-3.5',
        call.state === 'incoming' ? 'border-emerald-400/70' : call.state === 'failed' || call.state === 'mic' ? 'border-rose-400/60' : 'border-brand-400/50')}>
      <audio ref={call.attachEl} autoPlay className="hidden" />
      <Phone size={16} className={cn(
        call.state === 'live' ? 'text-emerald-500' : call.state === 'failed' || call.state === 'mic' ? 'text-rose-500' : 'animate-pulse text-brand-500')} />
      <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
        {call.state === 'incoming' && `${partnerName} is calling…`}
        {call.state === 'connecting' && `Calling ${partnerName}… (can take ~10s on mobile data)`}
        {call.state === 'live' && `Voice call with ${partnerName}`}
        {call.state === 'failed' && 'Call couldn’t connect — check you’re both online and try again.'}
        {call.state === 'mic' && 'Microphone is blocked — allow mic access for FocusLion in your phone settings, then try again.'}
      </span>
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
