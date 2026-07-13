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
  a: 'open' | 'state' | 'close' | 'emote'
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
  getPlayerState: () => number
  destroy: () => void
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
  session, meId, partnerName, sendTg, registerTgHandler, resolveMediaUrl, onClose, callNode,
}: {
  session: TogetherSession
  meId: string
  partnerName: string
  sendTg: (p: Omit<TgPayload, 'from'>) => void
  registerTgHandler: (fn: (p: TgPayload) => void) => void
  resolveMediaUrl: (msgId: string) => Promise<string | null>
  onClose: () => void
  callNode?: React.ReactNode
}) {
  const ytRef = useRef<YTPlayer | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  const applyingRemote = useRef(0) // ignore our own player events briefly after applying theirs
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaGone, setMediaGone] = useState(false)
  const [partnerHere, setPartnerHere] = useState(false)
  // Drive files that refuse direct playback drop to Drive's own player iframe
  const [driveFallback, setDriveFallback] = useState(false)
  // floating emoji reactions, mirrored on both screens
  const [emotes, setEmotes] = useState<{ id: number; e: string; x: number }[]>([])
  const emoteSeq = useRef(0)
  const pushEmote = useCallback((e: string) => {
    const id = ++emoteSeq.current
    setEmotes((list) => [...list.slice(-14), { id, e, x: 8 + Math.random() * 84 }])
    setTimeout(() => setEmotes((list) => list.filter((x) => x.id !== id)), 2600)
  }, [])

  const broadcastState = useCallback((playing: boolean, t: number) => {
    if (Date.now() < applyingRemote.current) return
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
      if (p.a !== 'state' || p.t == null || p.at == null) return
      setPartnerHere(true)
      const expected = p.playing ? p.t + (Date.now() - p.at) / 1000 : p.t
      applyingRemote.current = Date.now() + 900
      const yt = ytRef.current
      if (yt) {
        if (Math.abs(yt.getCurrentTime() - expected) > 1.5) yt.seekTo(expected, true)
        if (p.playing) yt.playVideo()
        else yt.pauseVideo()
      }
      const el = mediaRef.current
      if (el) {
        if (Math.abs(el.currentTime - expected) > 1.5) el.currentTime = expected
        if (p.playing) void el.play().catch(() => {})
        else el.pause()
      }
    })
    return () => registerTgHandler(() => {})
  }, [registerTgHandler, meId, pushEmote])

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
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onStateChange: (e: { data: number }) => {
            const yt = ytRef.current
            if (!yt || !window.YT) return
            if (e.data === window.YT.PlayerState.PLAYING) broadcastState(true, yt.getCurrentTime())
            if (e.data === window.YT.PlayerState.PAUSED) broadcastState(false, yt.getCurrentTime())
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

  // gentle heartbeat so a missed event can't leave the two sides apart
  useEffect(() => {
    const iv = setInterval(() => {
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
  const mediaEvents = {
    onPlay: (e: React.SyntheticEvent<HTMLVideoElement>) => broadcastState(true, e.currentTarget.currentTime),
    onPause: (e: React.SyntheticEvent<HTMLVideoElement>) => broadcastState(false, e.currentTarget.currentTime),
    onSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => broadcastState(!e.currentTarget.paused, e.currentTarget.currentTime),
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[85] flex flex-col overflow-y-auto bg-[#06050d]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-white">
          {session.kind === 'media' && !session.isVideo
            ? <Music size={18} className="shrink-0 text-amber-400" />
            : <Clapperboard size={18} className="shrink-0 text-red-400" />}
          <span className="truncate text-sm font-bold">{title} · with {partnerName}</span>
        </div>
        <button onClick={() => { sendTg({ a: 'close' }); onClose() }} aria-label="Leave together session"
          className="shrink-0 rounded-full p-2 text-white/70 hover:bg-white/10">
          <X size={18} />
        </button>
      </div>

      <div className={cn('relative mx-3 shrink-0 overflow-hidden rounded-3xl ring-1 ring-white/15', isVideo ? 'aspect-video' : 'p-3 sm:p-4')}>
        {session.kind === 'youtube' && <div id="tg-yt" className="h-full w-full" />}
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
        {/* floating live reactions from both sides */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
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

      <div className="px-4 py-2 text-center text-xs text-white/50">
        {session.kind === 'drive' && driveFallback
          ? 'Drive player mode — press play on both phones.'
          : partnerHere
            ? `In sync with ${partnerName} — play, pause and seek together. 🎧`
            : `Waiting for ${partnerName} to join…`}
      </div>

      {/* live emote bar */}
      <div className="flex flex-wrap items-center justify-center gap-1 px-4 pb-2">
        {['❤️', '😂', '🔥', '😮', '👏', '💯'].map((e) => (
          <button key={e} onClick={() => { pushEmote(e); sendTg({ a: 'emote', e }) }}
            className="rounded-full bg-white/10 px-2.5 py-1.5 text-lg transition hover:bg-white/20 active:scale-90">
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
      className={cn('mb-2 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5',
        call.state === 'incoming' ? 'bg-emerald-500/15' : call.state === 'failed' ? 'bg-rose-500/10' : 'bg-brand-500/10')}>
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
