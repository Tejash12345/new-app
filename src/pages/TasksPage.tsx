import { useState } from 'react'
import { Plus, Trash2, CalendarClock } from 'lucide-react'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import type { Task, TaskKind } from '../lib/types'
import { Button, Empty, GlassCard, Input, Modal, Page, TextArea } from '../components/ui'
import { cn } from '../lib/utils'

const KINDS: { key: TaskKind; label: string; emoji: string; xp: number }[] = [
  { key: 'task', label: 'Tasks', emoji: '✅', xp: 10 },
  { key: 'assignment', label: 'Assignments', emoji: '📄', xp: 25 },
  { key: 'exam', label: 'Exams', emoji: '🎓', xp: 40 },
  { key: 'goal', label: 'Goals', emoji: '🎯', xp: 50 },
]

export function TasksPage() {
  const { rows, insert, update, remove } = useTable<Task>('tasks', { orderBy: 'created_at' })
  const { addXp } = useAuth()
  const [kind, setKind] = useState<TaskKind>('task')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [subject, setSubject] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState(1)

  const kindMeta = KINDS.find((k) => k.key === kind)!
  const list = rows
    .filter((t) => t.kind === kind)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due_at ?? '9').localeCompare(b.due_at ?? '9'))

  async function add() {
    if (!title.trim()) return
    await insert({
      title: title.trim(), notes, subject, kind, priority,
      due_at: due ? new Date(due).toISOString() : null,
    } as Partial<Task>)
    setOpen(false)
    setTitle(''); setNotes(''); setSubject(''); setDue('')
  }

  async function toggle(t: Task) {
    const done = !t.done
    await update({ id: t.id, done, progress: done ? 100 : t.progress } as Partial<Task> & { id: string })
    if (done) await addXp(kindMeta.xp, `Completed ${t.kind}: ${t.title}`)
  }

  return (
    <Page
      title="Tasks & Goals"
      subtitle="Tasks, assignments, exam prep and long-term goals — all in one place."
      actions={<Button onClick={() => setOpen(true)}><Plus size={16} /> New {kind}</Button>}
    >
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {KINDS.map((k) => {
          const count = rows.filter((t) => t.kind === k.key && !t.done).length
          return (
            <button key={k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-bold transition',
                kind === k.key ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
              )}
            >
              {k.emoji} {k.label}
              {count > 0 && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10px]', kind === k.key ? 'bg-white/25' : 'bg-brand-500/15 text-brand-500')}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <GlassCard>
        {list.length === 0 ? (
          <Empty emoji={kindMeta.emoji} text={`No ${kindMeta.label.toLowerCase()} yet.\nAdd one and earn +${kindMeta.xp} XP when you complete it!`} />
        ) : (
          <div className="space-y-2">
            {list.map((t) => {
              const overdue = t.due_at && !t.done && new Date(t.due_at) < new Date()
              return (
                <div key={t.id} className="group flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                  <input type="checkbox" checked={t.done} onChange={() => toggle(t)} className="h-5 w-5 shrink-0 accent-brand-500" />
                  <div className="min-w-0 flex-1">
                    <div className={cn('font-semibold text-slate-900 dark:text-white', t.done && 'line-through opacity-50')}>{t.title}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {t.subject && <span>{t.subject}</span>}
                      {t.due_at && (
                        <span className={cn('flex items-center gap-1', overdue && 'font-bold text-rose-500')}>
                          <CalendarClock size={12} />
                          {new Date(t.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                          {overdue && ' · overdue'}
                        </span>
                      )}
                      {t.notes && <span className="truncate max-w-48">{t.notes}</span>}
                    </div>
                    {(kind === 'goal' || kind === 'exam') && !t.done && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="range" min={0} max={100} value={t.progress}
                          onChange={(e) => update({ id: t.id, progress: Number(e.target.value) } as Partial<Task> & { id: string })}
                          className="h-1.5 flex-1 accent-brand-500"
                        />
                        <span className="w-9 text-right text-xs font-bold text-brand-500">{t.progress}%</span>
                      </div>
                    )}
                  </div>
                  <div className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ['bg-emerald-400', 'bg-amber-400', 'bg-rose-500'][t.priority])} />
                  <button onClick={() => remove(t.id)} className="rounded-full p-2 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </GlassCard>

      <Modal open={open} onClose={() => setOpen(false)} title={`New ${kind}`}>
        <div className="space-y-3">
          <Input placeholder={kind === 'goal' ? 'e.g. Score 90% in finals' : 'What needs to be done?'} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Input placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextArea placeholder="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="flex gap-2">
            {['Low', 'Medium', 'High'].map((p, i) => (
              <button key={p} onClick={() => setPriority(i)}
                className={cn(
                  'flex-1 rounded-2xl py-2 text-sm font-bold transition',
                  priority === i
                    ? ['bg-emerald-500 text-white', 'bg-amber-500 text-white', 'bg-rose-500 text-white'][i]
                    : 'bg-slate-500/10 text-slate-500',
                )}>
                {p}
              </button>
            ))}
          </div>
          <Button className="w-full" size="lg" onClick={add}>Add {kind} (+{kindMeta.xp} XP on completion)</Button>
        </div>
      </Modal>
    </Page>
  )
}
