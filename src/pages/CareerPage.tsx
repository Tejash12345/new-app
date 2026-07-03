import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Briefcase, Sparkles, Trash2, GraduationCap, MessageSquareText, ThumbsUp, AlertTriangle, Wrench } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import { supabase } from '../lib/supabase'
import type { CareerReport, CareerReportRow } from '../lib/types'
import { Button, Empty, GlassCard, Input, Page, ProgressRing, SectionTitle, TextArea } from '../components/ui'
import { careerReport } from '../lib/ai'
import { cn } from '../lib/utils'
import { confirmDialog } from '../store/app'

export function CareerPage() {
  const { user } = useAuth()
  const { rows: reports } = useTable<CareerReportRow>('career_reports', { orderBy: 'created_at' })

  const [role, setRole] = useState('')
  const [resume, setResume] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function analyze() {
    if (!role.trim() || !resume.trim() || !user || busy) return
    setBusy(true); setError('')
    try {
      const report = await careerReport(role.trim(), resume.trim())
      const { error: insErr } = await supabase.from('career_reports').insert({
        user_id: user.id, role: role.trim(), report,
      })
      if (insErr) setError(insErr.message)
      else { setResume('') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the AI service.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!(await confirmDialog('Delete this report?', { yesLabel: 'Delete' }))) return
    await supabase.from('career_reports').delete().eq('id', id)
  }

  return (
    <Page title="AI Career Coach" subtitle="Paste your resume or skills + a target role — Leo scores your readiness and shows the path. 🦁">
      <GlassCard className="mb-6 !border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent">
        <SectionTitle><span className="flex items-center gap-2"><Briefcase size={18} className="text-amber-500" /> Analyze my readiness</span></SectionTitle>
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Target role — e.g. Junior Flutter Developer" className="mb-2" />
        <TextArea rows={5} value={resume} onChange={(e) => setResume(e.target.value)}
          placeholder="Paste your resume, or list your skills, projects and experience…" maxLength={6000} />
        <div className="mt-3 flex justify-end">
          <Button onClick={analyze} disabled={busy || !role.trim() || !resume.trim()}>
            {busy ? 'Analyzing…' : <><Sparkles size={15} /> Analyze</>}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-rose-500">{error}</p>}
      </GlassCard>

      {reports.length === 0 ? (
        <GlassCard><Empty emoji="💼" text={'No reports yet.\nEnter a target role and your skills above to get your job-readiness score.'} /></GlassCard>
      ) : (
        <div className="space-y-5">
          {reports.map((r) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <ReportCard row={r} onDelete={() => remove(r.id)} />
            </motion.div>
          ))}
        </div>
      )}
    </Page>
  )
}

function ReportCard({ row, onDelete }: { row: CareerReportRow; onDelete: () => void }) {
  const r: CareerReport = row.report ?? ({} as CareerReport)
  const score = r.readiness ?? 0
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#FFB454' : '#f43f5e'
  return (
    <GlassCard>
      <div className="flex items-start gap-4">
        <ProgressRing progress={score / 100} size={84} stroke={9} color={color} label={`${score}`} sub="readiness" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-extrabold text-slate-900 dark:text-white">{row.role}</h3>
          <p className="break-words text-sm text-slate-500">{r.verdict}</p>
        </div>
        <button onClick={onDelete} className="rounded-full p-1.5 text-slate-300 hover:bg-rose-500/10 hover:text-rose-500"><Trash2 size={15} /></button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <List icon={<ThumbsUp size={14} />} tint="text-emerald-500" title="Strengths" items={r.strengths} />
        <List icon={<AlertTriangle size={14} />} tint="text-rose-500" title="Gaps" items={r.gaps} />
        <List icon={<Wrench size={14} />} tint="text-brand-500" title="Resume tips" items={r.improvements} />
        <List icon={<GraduationCap size={14} />} tint="text-amber-500" title="Skills to learn" items={r.skillsToLearn} />
      </div>

      {r.interviewQuestions?.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
            <MessageSquareText size={14} /> Practice interview questions
          </div>
          <ol className="space-y-1.5">
            {r.interviewQuestions.map((q, i) => (
              <li key={i} className="break-words rounded-xl bg-white/50 px-3 py-2 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-200">
                <span className="font-bold text-amber-500">{i + 1}.</span> {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      {r.skillsToLearn?.length > 0 && (
        <Link to="/learn" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-400/25 dark:text-amber-300">
          <GraduationCap size={14} /> Turn these into a learning path →
        </Link>
      )}
    </GlassCard>
  )
}

function List({ icon, tint, title, items }: { icon: React.ReactNode; tint: string; title: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
      <div className={cn('mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide', tint)}>{icon} {title}</div>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="break-words text-sm text-slate-700 dark:text-slate-200">• {it}</li>)}
      </ul>
    </div>
  )
}
