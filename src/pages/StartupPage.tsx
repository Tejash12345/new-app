import { useState } from 'react'
import { motion } from 'framer-motion'
import { Rocket, Sparkles, Trash2, TrendingUp, DollarSign, Swords, Layers, Users, Map } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { StartupPlan, StartupPlanRow } from '../lib/types'
import { Button, Empty, GlassCard, Page, SectionTitle, TextArea } from '../components/ui'
import { startupPlan } from '../lib/ai'
import { confirmDialog } from '../store/app'

export function StartupPage() {
  const { user } = useAuth()
  // write through the useTable mutations so the cached list refreshes
  // instantly — direct supabase writes left new/deleted plans invisible
  // until you left and re-entered the page
  const { rows: plans, insert: addPlan, remove: removePlan } = useTable<StartupPlanRow>('startup_plans', { orderBy: 'created_at' })

  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    if (!idea.trim() || !user || busy) return
    setBusy(true); setError('')
    try {
      const plan = await startupPlan(idea.trim())
      await addPlan({ idea: idea.trim(), plan } as Partial<StartupPlanRow>)
      setIdea('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the AI service.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!(await confirmDialog('Delete this plan?', { yesLabel: 'Delete' }))) return
    await removePlan(id)
  }

  return (
    <Page title="AI Startup Co-Founder" subtitle="Describe your idea — Leo drafts the market, MVP, revenue, competitors, team and launch roadmap. 🦁">
      <GlassCard className="mb-6 !border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent">
        <SectionTitle><span className="flex items-center gap-2"><Rocket size={18} className="text-amber-500" /> Pitch your idea</span></SectionTitle>
        <TextArea rows={4} value={idea} onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. An app that pairs medical students with AI-generated case studies and peer study groups…" maxLength={2000} />
        <div className="mt-3 flex justify-end">
          <Button onClick={generate} disabled={busy || !idea.trim()}>
            {busy ? 'Building plan…' : <><Sparkles size={15} /> Build my plan</>}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-rose-500">{error}</p>}
      </GlassCard>

      {plans.length === 0 ? (
        <GlassCard><Empty emoji="🚀" text={'No plans yet.\nPitch an idea above and Leo will co-found it with you.'} /></GlassCard>
      ) : (
        <div className="space-y-5">
          {plans.map((p) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <PlanCard row={p} onDelete={() => remove(p.id)} />
            </motion.div>
          ))}
        </div>
      )}
    </Page>
  )
}

function PlanCard({ row, onDelete }: { row: StartupPlanRow; onDelete: () => void }) {
  const p: StartupPlan = row.plan ?? ({} as StartupPlan)
  return (
    <GlassCard>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-xl">🚀</div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-extrabold text-slate-900 dark:text-white">{row.idea}</h3>
          {p.summary && <p className="break-words text-sm text-slate-500">{p.summary}</p>}
        </div>
        <button onClick={onDelete} className="rounded-full p-1.5 text-slate-300 hover:bg-rose-500/10 hover:text-rose-500"><Trash2 size={15} /></button>
      </div>

      {p.market && (
        <div className="mt-4 rounded-2xl bg-white/40 p-3 dark:bg-white/5">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-500"><TrendingUp size={14} /> Market</div>
          <p className="break-words text-sm text-slate-700 dark:text-slate-200">{p.market}</p>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Section icon={<Layers size={14} />} tint="text-brand-500" title="MVP features" items={p.mvpFeatures} />
        <Section icon={<DollarSign size={14} />} tint="text-emerald-500" title="Revenue model" items={p.revenueModel} />
        <Section icon={<Swords size={14} />} tint="text-rose-500" title="Competitors" items={p.competitors} />
        <Section icon={<Users size={14} />} tint="text-purple-500" title="Team you'll need" items={p.team} />
      </div>

      {p.roadmap?.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-500"><Map size={14} /> Launch roadmap</div>
          <div className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-0.5 before:bg-amber-400/40">
            {p.roadmap.map((step, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[1.15rem] top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-4 ring-white dark:ring-slate-900" />
                <div className="break-words text-sm font-bold text-slate-900 dark:text-white">{step.phase}</div>
                <div className="break-words text-xs text-slate-500">{step.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

function Section({ icon, tint, title, items }: { icon: React.ReactNode; tint: string; title: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
      <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${tint}`}>{icon} {title}</div>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="break-words text-sm text-slate-700 dark:text-slate-200">• {it}</li>)}
      </ul>
    </div>
  )
}
