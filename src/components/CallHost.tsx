/**
 * CallHost — app-wide voice calling, WhatsApp-style.
 *
 * Every signed-in user listens on their own realtime channel
 * (`ring-<uid>`); callers send WebRTC signaling there. Because CallHost
 * mounts in the Layout, an incoming call RINGS ON EVERY PAGE — the old
 * design signaled over the conversation's channel, so calls only arrived
 * if you already had that exact chat open (why calls "never came" on
 * phones).
 *
 * Incoming calls show a fullscreen ring screen (Accept / Decline); active
 * calls show a floating strip that survives navigation anywhere in the app.
 */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Phone, PhoneOff, SwitchCamera, Video } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useAuth } from '../hooks/useAuth'
import { useApp } from '../store/app'
import { useAvatars } from '../hooks/useAvatars'
import { useVoiceCall, VoiceCallBar, type RtcPayload } from './Together'

export function CallHost() {
  const { user, profile } = useAuth()
  const avatarFor = useAvatars()
  const setCallApi = useApp((s) => s.setCallApi)
  const tgOpen = useApp((s) => s.tgOpen)
  const [peer, setPeer] = useState<{ id: string; name: string; video?: boolean } | null>(null)
  const peerRef = useRef(peer)
  useEffect(() => { peerRef.current = peer })

  // one send-channel per peer, created lazily and awaited before first use
  const sendChannel = useRef<{ peerId: string; ch: RealtimeChannel; ready: Promise<void> } | null>(null)
  function channelFor(peerId: string) {
    if (sendChannel.current?.peerId === peerId) return sendChannel.current
    if (sendChannel.current) void supabase.removeChannel(sendChannel.current.ch)
    const ch = supabase.channel(`ring-${peerId}`)
    const ready = new Promise<void>((resolve) => {
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') resolve() })
    })
    sendChannel.current = { peerId, ch, ready }
    return sendChannel.current
  }

  const call = useVoiceCall({
    meId: user?.id,
    sendRtc: (p) => {
      const target = peerRef.current
      if (!user || !target) return
      const entry = channelFor(target.id)
      void entry.ready.then(() => {
        void entry.ch.send({
          type: 'broadcast',
          event: 'rtc',
          payload: { ...p, from: user.id, fromName: profile?.full_name?.trim() ? profile.full_name.split(' ')[0] : 'A friend' },
        })
      })
    },
  })
  const callRef = useRef(call)
  useEffect(() => { callRef.current = call })

  // my personal ring channel — mounted once, rings on any page
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel(`ring-${user.id}`)
      .on('broadcast', { event: 'rtc' }, ({ payload }) => {
        const p = payload as RtcPayload & { fromName?: string }
        if (p.from === user.id) return
        // a fresh offer while idle/ringing IS the ring — but offers that
        // arrive mid-call are renegotiation (camera on, ICE restart) and
        // must not touch who/what the ring screen shows
        if (p.t === 'offer') {
          const s = callRef.current.state
          if (s === 'idle' || s === 'incoming' || s === 'failed' || s === 'mic') {
            setPeer({ id: p.from, name: p.fromName || 'A friend', video: p.video })
          }
        }
        callRef.current.handleRtc(p)
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user?.id])

  // let any page start AND control the call (chat menu, fullscreen player…);
  // re-registered on every state change so embedded UIs stay live
  useEffect(() => {
    setCallApi({
      start: (peerId, peerName, video) => {
        setPeer({ id: peerId, name: peerName.split(' ')[0], video })
        // peerRef must be set before the offer goes out
        peerRef.current = { id: peerId, name: peerName.split(' ')[0] }
        void callRef.current.startCall(video ? { video: true } : undefined)
      },
      end: () => callRef.current.endCall(true),
      toggleMute: () => callRef.current.toggleMute(),
      toggleCam: () => void callRef.current.toggleCam(),
      flipCam: () => void callRef.current.flipCam(),
      toggleScreen: () => void callRef.current.toggleScreen(),
      attachLocalVideo: callRef.current.attachLocalVideo,
      attachRemoteVideo: callRef.current.attachRemoteVideo,
      state: call.state,
      muted: call.muted,
      camOn: call.camOn,
      remoteCamOn: call.remoteCamOn,
      screenOn: call.screenOn,
      remoteScreenOn: call.remoteScreenOn,
      canScreenShare: call.canScreenShare,
      screenError: call.screenError,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state, call.muted, call.camOn, call.remoteCamOn, call.screenOn, call.remoteScreenOn, call.screenError])
  useEffect(() => () => setCallApi(null), [setCallApi])

  // tidy the send channel when a call fully ends
  useEffect(() => {
    if (call.state === 'idle' && sendChannel.current) {
      void supabase.removeChannel(sendChannel.current.ch)
      sendChannel.current = null
    }
  }, [call.state])

  // call sounds: ringtone while it rings, soft ringback while dialing, a
  // short chime when connected — a silent ring was easy to miss, and a
  // quiet-but-working call was indistinguishable from a broken one
  useEffect(() => {
    if (call.state !== 'incoming' && call.state !== 'connecting' && call.state !== 'live') return
    let ctx: AudioContext | null = null
    try { ctx = new AudioContext() } catch { return }
    void ctx.resume().catch(() => {})
    let interval: ReturnType<typeof setInterval> | null = null
    const beep = (freq: number, dur: number, when = 0, vol = 0.18) => {
      if (!ctx) return
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(vol, ctx.currentTime + when)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(ctx.currentTime + when)
      o.stop(ctx.currentTime + when + dur + 0.05)
    }
    if (call.state === 'incoming') {
      const ring = () => {
        beep(880, 0.3, 0)
        beep(880, 0.3, 0.45)
        navigator.vibrate?.([250, 150, 250])
      }
      ring()
      interval = setInterval(ring, 2600)
    } else if (call.state === 'connecting') {
      const tone = () => beep(440, 0.9, 0, 0.07)
      tone()
      interval = setInterval(tone, 3000)
    } else {
      beep(660, 0.12, 0)
      beep(990, 0.12, 0.16)
    }
    return () => {
      if (interval) clearInterval(interval)
      void ctx?.close().catch(() => {})
    }
  }, [call.state])

  if (!user) return null
  // the remote-audio sink stays mounted through EVERY state (ring included),
  // so no early audio is ever dropped between re-renders
  const sink = <audio ref={call.attachEl} autoPlay className="hidden" />

  // fullscreen ring for incoming calls — impossible to miss
  if (call.state === 'incoming' && peer) {
    return (
      <>
      {sink}
      <div className="aurora fixed inset-0 z-[120] flex flex-col items-center justify-center px-8">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="flex w-full max-w-xs flex-col items-center rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-2xl dark:border-white/10 dark:bg-slate-900">
          <div className="relative">
            <span className="absolute inset-0 -m-2 animate-ping rounded-full bg-emerald-400/40" />
            <div className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-2xl font-bold text-white">
              {avatarFor(peer.id)
                ? <img src={avatarFor(peer.id)} alt="" className="h-full w-full object-cover" />
                : peer.name.slice(0, 1).toUpperCase()}
            </div>
          </div>
          <div className="mt-4 text-lg font-extrabold text-slate-900 dark:text-white">{peer.name}</div>
          <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {peer.video ? 'FocusLion video call…' : 'FocusLion voice call…'}
          </div>
          <div className="mt-7 flex items-center gap-6">
            <button onClick={() => call.endCall(true)} aria-label="Decline call"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg active:scale-90">
              <PhoneOff size={22} />
            </button>
            <button onClick={() => void call.acceptCall()} aria-label="Accept call"
              className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg active:scale-90">
              {peer.video ? <Video size={26} /> : <Phone size={26} />}
            </button>
          </div>
        </motion.div>
      </div>
      </>
    )
  }

  // connecting / live / failed / mic — floating strip on every page
  if (call.state !== 'idle' && peer) {
    return (
      <>
        {sink}
        <div className="fixed inset-x-3 top-[calc(0.5rem+env(safe-area-inset-top))] z-[110]">
          <VoiceCallBar call={call} partnerName={peer.name} />
        </div>
        {/* Media floats on every page. The watch-together overlay owns the
            tiles while it's open (tgOpen); native fullscreen renders its own.
            eslint-disable react-hooks/refs — callback refs ARE the render-time
            attach point; the rule taints the whole hook return through them. */}
        {/* eslint-disable react-hooks/refs */}
        {!tgOpen && call.remoteScreenOn && (
          // partner is sharing their screen → show it BIG (contain), not a tile
          <div className="fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))] z-[105] overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/25">
            <video ref={call.attachRemoteVideo} autoPlay playsInline muted
              className="max-h-[46vh] w-full object-contain" />
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white/90">
              🖥 {peer.name}’s screen
            </span>
          </div>
        )}
        {!tgOpen && (call.camOn || call.screenOn || (call.remoteCamOn && !call.remoteScreenOn)) && (
          <div className={cn('fixed right-3 z-[105] flex flex-col items-end gap-2',
            call.remoteScreenOn ? 'bottom-24' : 'top-[calc(4.5rem+env(safe-area-inset-top))]')}>
            {call.remoteCamOn && !call.remoteScreenOn && (
              <video ref={call.attachRemoteVideo} autoPlay playsInline muted
                className="aspect-[3/4] w-28 rounded-2xl bg-black object-cover shadow-xl ring-1 ring-white/25 sm:w-36" />
            )}
            {call.screenOn && (
              <span className="rounded-full bg-violet-500/90 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg">
                🖥 You’re sharing your screen
              </span>
            )}
            {call.camOn && (
              <button onClick={() => void call.flipCam()} aria-label="Flip camera" className="relative active:scale-95">
                <video ref={call.attachLocalVideo} autoPlay playsInline muted
                  className="aspect-[3/4] w-16 -scale-x-100 rounded-2xl bg-black object-cover shadow-xl ring-1 ring-white/25 sm:w-24" />
                <SwitchCamera size={14} className="absolute bottom-1.5 right-1.5 text-white/85" />
              </button>
            )}
          </div>
        )}
        {/* eslint-enable react-hooks/refs */}
      </>
    )
  }
  // idle: keep only the audio sink mounted, ready for the next call
  return sink
}
