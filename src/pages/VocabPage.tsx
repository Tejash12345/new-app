import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Volume2, RefreshCw, Bookmark, BookmarkCheck, BookMarked, Trash2 } from 'lucide-react'
import { Page, GlassCard, Button, Empty, SectionTitle } from '../components/ui'
import { wordOfTheDay, AiError, type VocabWord } from '../lib/ai'
import { todayKey } from '../lib/utils'

const TODAY = 'vocab-today'   // { date, word } — keeps the same word all day
const SEEN = 'vocab-seen'     // string[] — words already shown, to avoid repeats
const SAVED = 'vocab-saved'   // VocabWord[] — the user's saved vocabulary list

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
function save(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}

// read the word aloud (Web Speech API — works in the browser and the WebView)
function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.9
    window.speechSynthesis.speak(u)
  } catch { /* ignore */ }
}

function LoadingCard() {
  return (
    <GlassCard className="!border-brand-400/20">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-28 rounded-full bg-slate-500/15" />
        <div className="h-10 w-44 rounded-xl bg-slate-500/20" />
        <div className="h-4 w-full rounded bg-slate-500/10" />
        <div className="h-4 w-3/4 rounded bg-slate-500/10" />
        <div className="h-16 w-full rounded-2xl bg-slate-500/10" />
      </div>
    </GlassCard>
  )
}

export function VocabPage() {
  const [word, setWord] = useState<VocabWord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<VocabWord[]>(() => load<VocabWord[]>(SAVED, []))

  async function fetchWord() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const seen = load<string[]>(SEEN, [])
      const w = await wordOfTheDay(seen)
      if (!w.word) { setError('Could not load a word — please try again.'); return }
      setWord(w)
      save(TODAY, { date: todayKey(), word: w })
      save(SEEN, [w.word, ...seen.filter((x) => x.toLowerCase() !== w.word.toLowerCase())].slice(0, 60))
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Could not reach the AI service. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  // show today's cached word; only call the AI once a day (or on "New word")
  useEffect(() => {
    const cached = load<{ date?: string; word?: VocabWord } | null>(TODAY, null)
    if (cached?.date === todayKey() && cached.word?.word) setWord(cached.word)
    else void fetchWord()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isSaved = !!word && saved.some((s) => s.word.toLowerCase() === word.word.toLowerCase())

  function toggleSave() {
    if (!word) return
    setSaved((prev) => {
      const exists = prev.some((s) => s.word.toLowerCase() === word.word.toLowerCase())
      const next = exists
        ? prev.filter((s) => s.word.toLowerCase() !== word.word.toLowerCase())
        : [word, ...prev]
      save(SAVED, next)
      return next
    })
  }

  function removeSaved(w: string) {
    setSaved((prev) => {
      const next = prev.filter((s) => s.word.toLowerCase() !== w.toLowerCase())
      save(SAVED, next)
      return next
    })
  }

  return (
    <Page title="Word of the Day" subtitle="Grow your vocabulary — Leo teaches you a new word with examples, every day. 🦁">
      <div className="mx-auto max-w-2xl space-y-5">
        <AnimatePresence mode="wait">
          {busy && !word ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LoadingCard />
            </motion.div>
          ) : word ? (
            <motion.div key={word.word} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <GlassCard float className="!border-brand-400/30 bg-gradient-to-br from-brand-500/10 via-purple-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300">
                    <Sparkles size={13} /> Word of the day
                  </span>
                  <button onClick={() => speak(word.word)} aria-label="Pronounce word"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-brand-500/10 hover:text-brand-500">
                    <Volume2 size={18} />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <h2 className="break-words bg-gradient-to-r from-brand-500 to-purple-500 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
                    {word.word}
                  </h2>
                  {word.phonetic && <span className="pb-1 text-sm text-slate-400">{word.phonetic}</span>}
                </div>
                {word.partOfSpeech && (
                  <span className="mt-2 inline-block rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-semibold italic text-amber-600 dark:text-amber-300">
                    {word.partOfSpeech}
                  </span>
                )}

                {word.meaning && (
                  <p className="mt-3 break-words text-base leading-relaxed text-slate-700 dark:text-slate-200">{word.meaning}</p>
                )}

                {word.examples.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {word.examples.map((ex, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-2xl border-l-2 border-brand-400/60 bg-slate-500/5 px-3 py-2">
                        <p className="min-w-0 flex-1 break-words text-sm italic text-slate-600 dark:text-slate-300">“{ex}”</p>
                        <button onClick={() => speak(ex)} aria-label="Pronounce example"
                          className="shrink-0 text-slate-300 transition hover:text-brand-500">
                          <Volume2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {word.synonyms.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Synonyms</div>
                    <div className="flex flex-wrap gap-1.5">
                      {word.synonyms.map((s) => (
                        <span key={s} className="rounded-full bg-slate-500/10 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={fetchWord} disabled={busy} className="w-full sm:w-auto">
                    {busy ? 'Loading…' : <><RefreshCw size={15} /> New word</>}
                  </Button>
                  <Button variant={isSaved ? 'soft' : 'ghost'} onClick={toggleSave} className="w-full sm:w-auto">
                    {isSaved ? <><BookmarkCheck size={15} /> Saved</> : <><Bookmark size={15} /> Save word</>}
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          ) : (
            <GlassCard key="empty">
              <Empty emoji="📖" text={error || 'Loading your first word…'} />
              {error && <div className="mt-3 flex justify-center"><Button onClick={fetchWord}><RefreshCw size={15} /> Try again</Button></div>}
            </GlassCard>
          )}
        </AnimatePresence>

        {error && word && <p className="text-center text-sm font-semibold text-rose-500">{error}</p>}

        {saved.length > 0 && (
          <GlassCard>
            <SectionTitle>
              <span className="flex items-center gap-2"><BookMarked size={18} className="text-brand-500" /> Saved words · {saved.length}</span>
            </SectionTitle>
            <div className="space-y-2">
              {saved.map((s) => (
                <div key={s.word} className="flex items-start gap-3 rounded-2xl bg-slate-500/5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold text-slate-900 dark:text-white">{s.word}</span>
                      {s.partOfSpeech && <span className="text-[11px] italic text-slate-400">{s.partOfSpeech}</span>}
                    </div>
                    {s.meaning && <p className="break-words text-xs text-slate-500">{s.meaning}</p>}
                  </div>
                  <button onClick={() => speak(s.word)} aria-label="Pronounce" className="shrink-0 text-slate-300 transition hover:text-brand-500"><Volume2 size={15} /></button>
                  <button onClick={() => removeSaved(s.word)} aria-label="Remove" className="shrink-0 text-slate-300 transition hover:text-rose-500"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </GlassCard>
        )}
      </div>
    </Page>
  )
}
