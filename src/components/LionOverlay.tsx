import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Timer } from 'lucide-react'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { Button } from './ui'

/** Synthesized lion roar using the Web Audio API (no audio file needed). */
function playRoar() {
  try {
    const ctx = new AudioContext()
    const dur = 1.6
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, ctx.currentTime)
    master.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.12)
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
    master.connect(ctx.destination)

    // low growl oscillators
    for (const [freq, type] of [[72, 'sawtooth'], [55, 'square'], [96, 'sawtooth']] as const) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, ctx.currentTime + dur)
      const g = ctx.createGain()
      g.gain.value = 0.25
      // vibrato for the growl texture
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 28
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 14
      lfo.connect(lfoGain).connect(osc.frequency)
      lfo.start()
      osc.connect(g).connect(master)
      osc.start()
      osc.stop(ctx.currentTime + dur)
      lfo.stop(ctx.currentTime + dur)
    }

    // breathy noise layer
    const noiseLen = ctx.sampleRate * dur
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * 0.5
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + dur)
    const ng = ctx.createGain()
    ng.gain.value = 0.35
    noise.connect(filter).connect(ng).connect(master)
    noise.start()

    setTimeout(() => ctx.close(), (dur + 0.3) * 1000)
  } catch {
    // audio not available — stay silent
  }
}

export function LionOverlay() {
  const { lion, hideLion, stopScroll } = useApp()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const played = useRef(false)

  useEffect(() => {
    if (lion.open && !played.current) {
      played.current = true
      if (profile?.settings?.sound !== false) {
        playRoar()
        setTimeout(playRoar, 2200)
      }
    }
    if (!lion.open) played.current = false
  }, [lion.open])

  function closeAnd(path?: string) {
    stopScroll()
    hideLion()
    if (path) navigate(path)
  }

  return (
    <AnimatePresence>
      {lion.open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
        >
          {/* cinematic backdrop */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#1a0e02] via-[#2d1503] to-[#0b0d14]" />
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }} animate={{ opacity: [0, 0.6, 0.25] }}
            transition={{ duration: 2 }}
            style={{ background: 'radial-gradient(40rem 30rem at 50% 45%, rgba(255,150,40,0.35), transparent 70%)' }}
          />

          {/* roar sound waves */}
          <div className="absolute flex items-center justify-center">
            {[0, 0.35, 0.7].map((d) => (
              <div key={d} className="sound-wave absolute h-64 w-64 rounded-full border-2 border-amber-400/40" style={{ animationDelay: `${d}s` }} />
            ))}
          </div>

          <div className="relative z-10 mx-4 flex max-w-lg flex-col items-center text-center">
            {/* lion entrance */}
            <motion.div
              initial={{ scale: 0.2, y: 160, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', damping: 14, stiffness: 120, delay: 0.15 }}
              className="lion-shake select-none text-[9rem] leading-none drop-shadow-[0_0_60px_rgba(255,160,50,0.6)]"
            >
              🦁
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="mt-6 text-3xl sm:text-4xl font-extrabold text-amber-50"
            >
              ROAAAR! Time's up.
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.0 }}
              className="mt-4 space-y-1.5 text-amber-100/90"
            >
              {lion.reason === 'schedule' ? (
                <>
                  <p className="text-lg font-semibold">{lion.appName || 'This app'} is not allowed right now.</p>
                  <p>Your allowed time is {lion.windowLabel ?? 'later'}. Come back then!</p>
                  <p className="text-amber-200/70">Right now belongs to your goals. 🌅</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold">You have reached today's {lion.appName || 'social media'} limit.</p>
                  <p>It's time to relax and return to your goals.</p>
                  <p className="text-amber-200/70">Take a break and focus on your future. 🌅</p>
                </>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.35 }}
              className="mt-8 flex flex-col sm:flex-row gap-3"
            >
              <Button
                size="lg"
                className="!bg-gradient-to-r !from-amber-400 !to-orange-400 !text-[#241a05] !border-transparent !shadow-lg !shadow-orange-500/40 hover:!brightness-105"
                onClick={() => closeAnd('/focus')}
              >
                <Timer size={18} /> Start Focus Session
              </Button>
              <Button
                size="lg"
                className="!bg-white/15 !text-amber-50 !border-white/30 !shadow-none hover:!bg-white/25"
                onClick={() => closeAnd('/planner')}
              >
                <BookOpen size={18} /> Continue Studying
              </Button>
            </motion.div>

            <motion.button
              initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ delay: 2 }}
              onClick={() => closeAnd()}
              className="mt-6 text-sm text-amber-100/60 underline-offset-4 hover:underline"
            >
              Dismiss
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
