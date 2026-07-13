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
import { Phone, PhoneOff } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useApp } from '../store/app'
import { useAvatars } from '../hooks/useAvatars'
import { useVoiceCall, VoiceCallBar, type RtcPayload } from './Together'

export function CallHost() {
  const { user, profile } = useAuth()
  const avatarFor = useAvatars()
  const setCallApi = useApp((s) => s.setCallApi)
  const [peer, setPeer] = useState<{ id: string; name: string } | null>(null)
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
        if (p.t === 'offer') setPeer({ id: p.from, name: p.fromName || 'A friend' })
        callRef.current.handleRtc(p)
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user?.id])

  // let any page start a call (chat menu, future profile buttons…)
  useEffect(() => {
    setCallApi({
      start: (peerId, peerName) => {
        setPeer({ id: peerId, name: peerName.split(' ')[0] })
        // peerRef must be set before the offer goes out
        peerRef.current = { id: peerId, name: peerName.split(' ')[0] }
        void callRef.current.startCall()
      },
    })
    return () => setCallApi(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // tidy the send channel when a call fully ends
  useEffect(() => {
    if (call.state === 'idle' && sendChannel.current) {
      void supabase.removeChannel(sendChannel.current.ch)
      sendChannel.current = null
    }
  }, [call.state])

  if (!user) return null

  // fullscreen ring for incoming calls — impossible to miss
  if (call.state === 'incoming' && peer) {
    return (
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
          <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">FocusLion voice call…</div>
          <div className="mt-7 flex items-center gap-6">
            <button onClick={() => call.endCall(true)} aria-label="Decline call"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg active:scale-90">
              <PhoneOff size={22} />
            </button>
            <button onClick={() => void call.acceptCall()} aria-label="Accept call"
              className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg active:scale-90">
              <Phone size={26} />
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  // connecting / live / failed / mic — floating strip on every page
  if (call.state !== 'idle' && peer) {
    return (
      <div className="fixed inset-x-3 top-[calc(0.5rem+env(safe-area-inset-top))] z-[110]">
        <VoiceCallBar call={call} partnerName={peer.name} />
      </div>
    )
  }
  // keep the hidden audio element mounted so remote audio always has a sink
  return <VoiceCallBar call={call} partnerName="" />
}
