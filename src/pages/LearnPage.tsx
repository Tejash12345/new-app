import { useState } from 'react'
import { motion } from 'framer-motion'
import { GraduationCap, Sparkles, Trash2, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import { supabase } from '../lib/supabase'
import type { LearningPath, LearningStep } from '../lib/types'
import { Button, Empty, GlassCard, Input, Page, ProgressRing, SectionTitle } from '../components/ui'
import { generateLearningPath } from '../lib/ai'
import { cn } from '../lib/utils'

const TOPICS = ['Flutter', 'React', 'Java', 'AI & ML', 'Python', 'Cybersecurity', 'Anatomy', 'Pharmacology']
const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const newId = () => (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`)

export function LearnPage() {
  const { user } = useAuth()
  const { rows: paths } = useTable<LearningPath>('learning_paths', { orderBy: 'created_at' })

  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState('Beginner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    const t = topic.trim()
    if (!t || !user || busy) return
    setBusy(true); setError('')
    try {
      const { summary, steps } = await generateLearningPath(t, level)
      if (!steps.length) { setError('Could not generate a roadmap — try again or rephrase the topic.'); return }
      const withIds: LearningStep[] = steps.map((s) => ({ id: newId(), title: s.title, detail: s.detail, done: false }))
      const { error: insErr } = await supabase.from('learning_paths').insert({
        user_id: user.id, topic: t, level, summary, steps: withIds,
      })
      if (insErr) setError(insErr.message)
      else setTopic('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the AI service.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStep(p: LearningPath, stepId: string) {
    const steps = (p.steps ?? []).map((s) => (s.id === stepId ? { ...s, done: !s.done } : s))
    await supabase.from('learning_paths').update({ steps, updated_at: new Date().toISOString() }).eq('id', p.id)
  }

  async function removePath(id: string) {
    if (!confirm('Delete this learning path?')) return
    await supabase.from('learning_paths').delete().eq('id', id)
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
            className="rounded-2xl border border-slate-200/60 bg-white/70 px-3 py-2.5 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:[&>option]:bg-slate-800">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Button onClick={generate} disabled={busy || !topic.trim()}>
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
            const done = steps.filter((s) => s.done).length
            const pct = steps.length ? done / steps.length : 0
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <GlassCard float>
                  <div className="flex items-start gap-3">
                    <ProgressRing progress={pct} size={64} stroke={7} color="#FFB454" label={`${Math.round(pct * 100)}%`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-bold text-slate-900 dark:text-white">{p.topic}</h3>
                        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">{p.level}</span>
                      </div>
                      <p className="break-words text-xs text-slate-500">{p.summary}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{done}/{steps.length} steps complete</p>
                    </div>
                    <button onClick={() => removePath(p.id)} className="rounded-full p-1.5 text-slate-300 hover:bg-rose-500/10 hover:text-rose-500">
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {steps.map((s, i) => (
                      <button key={s.id} onClick={() => toggleStep(p, s.id)} className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-500/5">
                        <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-white transition',
                          s.done ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 dark:border-white/20')}>
                          {s.done ? <Check size={13} /> : <span className="text-[10px] font-bold text-slate-400">{i + 1}</span>}
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block break-words text-sm font-semibold', s.done ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100')}>{s.title}</span>
                          {s.detail && <span className="block break-words text-xs text-slate-500">{s.detail}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
