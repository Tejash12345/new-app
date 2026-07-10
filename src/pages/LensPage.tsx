import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Camera, Copy, Check, Image as ImageIcon, RotateCcw, Send, Volume2 } from 'lucide-react'
import { AiError, LENS_MODES, lensAsk, parseLensScore, prepareLensImage, type LensMode } from '../lib/ai'
import { speak } from '../lib/speak'
import { AiLion, AiLoader, Button, GlassCard, Input, Page } from '../components/ui'
import { cn } from '../lib/utils'

/**
 * Leo Lens — the photo doubt-solver. Snap a textbook question, equation,
 * diagram or page of notes; the vision model reads it and teaches it:
 * solve step-by-step, explain simply, or extract revision points. Follow-up
 * questions reuse the same photo.
 */
export function LensPage() {
  const [image, setImage] = useState<string | null>(null)
  const [mode, setMode] = useState<LensMode>('solve')
  const [question, setQuestion] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose a photo.'); return }
    setError(null)
    setAnswer('')
    try {
      setImage(await prepareLensImage(file))
    } catch {
      setError('Could not read that photo — try another one.')
    }
  }

  async function ask(instruction: string) {
    if (!image || busy) return
    setBusy(true)
    setError(null)
    try {
      const text = await lensAsk(image, instruction)
      setAnswer(text)
      setFollowUp('')
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Leo could not read the photo. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function askMain() {
    const base = LENS_MODES.find((m) => m.key === mode)!.prompt
    const extra = question.trim() ? ` Also, the student asks: "${question.trim()}".` : ''
    ask(base + extra)
  }

  function reset() {
    setImage(null)
    setAnswer('')
    setQuestion('')
    setFollowUp('')
    setError(null)
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <Page title="Leo Lens" subtitle="Snap any question, diagram or notes — Leo reads the photo and teaches you.">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GlassCard>
          {!image ? (
            <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-brand-400/40 px-4 py-10 text-center">
              <AiLion className="h-20" />
              <p className="mt-3 font-bold text-slate-900 dark:text-white">Show Leo your doubt</p>
              <p className="mt-1 max-w-xs text-sm text-slate-500">
                A textbook question, a formula, a diagram, even messy handwritten notes — Leo reads it all.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button onClick={() => cameraRef.current?.click()}>
                  <Camera size={17} /> Take photo
                </Button>
                <Button variant="soft" onClick={() => galleryRef.current?.click()}>
                  <ImageIcon size={17} /> From gallery
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-2xl bg-slate-900/5 dark:bg-white/5">
                <img src={image} alt="Your photo" className="mx-auto max-h-64 object-contain" />
                <button
                  onClick={reset}
                  className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900/80"
                >
                  <RotateCcw size={13} /> Retake
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {LENS_MODES.map((m) => (
                  <button key={m.key} onClick={() => setMode(m.key)}
                    className={cn(
                      'rounded-full px-3.5 py-2 text-sm font-semibold transition',
                      mode === m.key
                        ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30'
                        : 'bg-slate-500/10 text-slate-600 hover:bg-slate-500/20 dark:bg-white/10 dark:text-slate-300',
                    )}>
                    {m.emoji} {m.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex min-w-0 gap-2">
                <Input placeholder="Ask anything…" value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && askMain()} maxLength={200} />
                <Button className="whitespace-nowrap" onClick={askMain} disabled={busy}>
                  {busy ? 'Reading…' : 'Ask Leo'}
                </Button>
              </div>
            </>
          )}
          {error && <p className="mt-3 text-sm font-semibold text-rose-500">{error}</p>}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onPick} />
        </GlassCard>

        <GlassCard className={cn(!image && !answer && !busy && 'hidden lg:block')}>
          {busy ? (
            <AiLoader title="Leo is reading your photo…" hint="Working out the answer step by step" />
          ) : answer ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {(() => {
                const score = parseLensScore(answer)
                return score === null ? null : (
                  <div className="mb-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-400/20 to-orange-400/10 px-4 py-3">
                    <div className="text-3xl font-extrabold text-amber-500">{score}<span className="text-base text-amber-500/70">/10</span></div>
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {score >= 9 ? 'Outstanding — exam ready! 🏆' : score >= 7 ? 'Strong answer — a few marks left on the table. 💪' : score >= 5 ? 'Good base — the fixes below get you to full marks. 📈' : 'Keep going — Leo shows exactly what to fix. 🦁'}
                    </div>
                  </div>
                )
              })()}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-brand-500">
                  <AiLion className="h-6" /> Leo&rsquo;s answer
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => speak(answer)} title="Listen"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-500/10 hover:text-brand-500">
                    <Volume2 size={17} />
                  </button>
                  <button onClick={copyAnswer} title="Copy"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-500/10 hover:text-brand-500">
                    {copied ? <Check size={17} className="text-emerald-500" /> : <Copy size={17} />}
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
                {answer}
              </p>
              <div className="mt-4 flex min-w-0 gap-2 border-t border-slate-200/60 pt-3 dark:border-white/10">
                <Input placeholder="Follow-up…" value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && followUp.trim() && ask(`About the same photo, the student asks: "${followUp.trim()}". Answer simply.`)} maxLength={200} />
                <Button variant="soft" disabled={!followUp.trim()}
                  onClick={() => ask(`About the same photo, the student asks: "${followUp.trim()}". Answer simply.`)}>
                  <Send size={15} />
                </Button>
              </div>
            </motion.div>
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center text-sm text-slate-400">
              <Camera size={32} className="mb-2 opacity-50" />
              Leo&rsquo;s explanation will appear here.
            </div>
          )}
        </GlassCard>
      </div>
      <p className="mt-4 text-center text-[11px] text-slate-400">
        Tip: fill the frame with the question and keep the page flat — sharper photo, sharper answer. 🦁
      </p>
    </Page>
  )
}
