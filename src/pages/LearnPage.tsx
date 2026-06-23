import { useState } from 'react'
import { motion } from 'framer-motion'
import { GraduationCap, Sparkles, Trash2, Check, BookOpen, ExternalLink } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { LearningPath, LearningStep } from '../lib/types'
import { Button, Empty, GlassCard, Input, Page, ProgressRing, SectionTitle } from '../components/ui'
import { generateLearningPath } from '../lib/ai'
import { cn } from '../lib/utils'

const TOPICS = ['Flutter', 'React', 'Java', 'AI & ML', 'Python', 'Cybersecurity', 'Anatomy', 'Pharmacology']
const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const newId = () => (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`)

export function LearnPage() {
  const { user } = useAuth()
  const { rows: paths, insert, update, remove } = useTable<LearningPath>('learning_paths', { orderBy: 'created_at' })

  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState('Beginner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    const t = topic.trim()
    if (!t || !user || busy) return
    setBusy(true); setError('')
    try {
      const { summary, steps, resources } = await generateLearningPath(t, level)
      if (!steps.length) { setError('Could not generate a roadmap — try again or rephrase the topic.'); return }
      const withIds: LearningStep[] = steps.map((s) => ({ id: newId(), title: s.title, detail: s.detail, done: false }))
      // route through the useTable mutation so the query cache is invalidated on
      // success — the new roadmap shows up instantly instead of only after you
      // leave the page and come back (a plain supabase insert doesn't refresh it)
      await insert({ topic: t, level, summary, steps: withIds, resources } as Partial<LearningPath>)
      setTopic('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the AI service.')
    } finally {
      setBusy(false)
    }
  }

  // route both through the useTable mutations so the query cache is invalidated
  // — the toggle/delete reflects in the UI instantly instead of only after a
  // page refresh (a plain supabase call doesn't refresh the cached list)
  async function toggleStep(p: LearningPath, stepId: string) {
    const steps = (p.steps ?? []).map((s) => (s.id === stepId ? { ...s, done: !s.done } : s))
    await update({ id: p.id, steps, updated_at: new Date().toISOString() } as Partial<LearningPath> & { id: string })
  }

  async function removePath(id: string) {
    if (!confirm('Delete this learning path?')) return
    await remove(id)
  }

  return (
    <Page title="AI Learning Paths" subtitle="Pick a skill — Leo builds you a step-by-step roadmap and tracks your progress. 🦁">
      {/* generator */}
      <GlassCard className="mb-6 !border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent">
        <SectionTitle><span className="flex items-center gap-2"><GraduationCap size={18} className="text-amber-500" /> Generate a roadmap</span></SectionTitle>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => (
            <button key={t} onClick={() => setTopic(t)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                topic === t ? 'bg-brand-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
              {t}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Or type any skill or subject…"
            onKeyDown={(e) => e.key === 'Enter' && generate()} />
          <select value={level} onChange={(e) => setLevel(e.target.value)}
            className="w-full rounded-2xl border border-slate-200/60 bg-white/70 px-3 py-2.5 text-sm text-slate-900 outline-none sm:w-auto dark:border-white/10 dark:bg-white/5 dark:text-white dark:[&>option]:bg-slate-800">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Button onClick={generate} disabled={busy || !topic.trim()} className="w-full sm:w-auto">
            {busy ? 'Generating…' : <><Sparkles size={15} /> Generate</>}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-rose-500">{error}</p>}
      </GlassCard>

      {paths.length === 0 ? (
        <GlassCard>
          <Empty emoji="📚" text={'No learning paths yet.\nPick a skill above and let Leo build your roadmap.'} />
        </GlassCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {paths.map((p) => {
            const steps = Array.isArray(p.steps) ? p.steps : []
            const resources = Array.isArray(p.resources) ? p.resources : []
            const done = steps.filter((s) => s.done).length
            const pct = steps.length ? done / steps.length : 0
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <GlassCard float>
                  <div className="flex items-start gap-3 sm:gap-4">
                    <ProgressRing progress={pct} size={56} stroke={6} color="#FFB454" label={`${Math.round(pct * 100)}%`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="min-w-0 break-words font-bold text-slate-900 dark:text-white">{p.topic}</h3>
                        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">{p.level}</span>
                      </div>
                      <p className="break-words text-xs text-slate-500">{p.summary}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{done}/{steps.length} steps complete</p>
                    </div>
                    <button onClick={() => removePath(p.id)} aria-label="Delete this learning path"
                      className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-rose-500/10 hover:text-rose-500">
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* steps — completion is a deliberate action: only the checkbox or the
                      "Mark done" button toggles a step, so tapping/reading the step text
                      never flips it by accident. "Undo" lets you clear a mistaken one. */}
                  <div className="mt-3 space-y-1">
                    {steps.map((s, i) => (
                      <div key={s.id} className={cn('flex items-start gap-2.5 rounded-xl px-2 py-1.5 transition', s.done && 'bg-emerald-500/[0.06]')}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={s.done}
                          aria-label={s.done ? `Mark "${s.title}" as not done` : `Mark "${s.title}" as done`}
                          onClick={() => toggleStep(p, s.id)}
                          className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-white transition active:scale-90',
                            s.done ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 hover:border-emerald-400 dark:border-white/20 dark:hover:border-emerald-400')}>
                          {s.done ? <Check size={14} /> : <span className="text-[10px] font-bold text-slate-400">{i + 1}</span>}
                        </button>
                        <div className="min-w-0 flex-1">
                          <span className={cn('block break-words text-sm font-semibold', s.done ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100')}>{s.title}</span>
                          {s.detail && <span className="block break-words text-xs text-slate-500">{s.detail}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleStep(p, s.id)}
                          className={cn('mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition active:scale-95',
                            s.done
                              ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400'
                              : 'bg-slate-500/10 text-slate-500 hover:bg-emerald-500/15 hover:text-emerald-600')}>
                          {s.done ? 'Undo' : 'Mark done'}
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* reference links — real resources (docs/courses/videos) the
                      AI recommends for this topic. They open in a new tab on the
                      web; inside the Android app the native WebView hands off-site
                      links to the system browser (see focuslion_app main.dart). */}
                  {resources.length > 0 && (
                    <div className="mt-4 border-t border-slate-200/60 pt-3 dark:border-white/10">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                        <BookOpen size={13} className="text-amber-500" /> Reference links
                      </p>
                      <div className="space-y-1">
                        {resources.map((r, i) => (
                          <a
                            key={`${r.url}-${i}`}
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-amber-400/10"
                          >
                            {r.kind && (
                              <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                                {r.kind}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 group-hover:text-amber-600 dark:text-slate-200 dark:group-hover:text-amber-300">
                              {r.title}
                            </span>
                            <ExternalLink size={13} className="shrink-0 text-slate-400 group-hover:text-amber-500" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
