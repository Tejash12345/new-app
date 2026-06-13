import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTable } from '../hooks/db'
import type { TimetableBlock } from '../lib/types'
import { Button, Empty, GlassCard, Input, Modal, Page } from '../components/ui'
import { SUBJECT_COLORS, cn, timeLabel } from '../lib/utils'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function PlannerPage() {
  const { rows, insert, remove } = useTable<TimetableBlock>('timetable_blocks')
  const [day, setDay] = useState((new Date().getDay() + 6) % 7)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [color, setColor] = useState(SUBJECT_COLORS[0])
  const [view, setView] = useState<'day' | 'week'>('day')

  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  async function add() {
    if (!title.trim() || toMin(end) <= toMin(start)) return
    await insert({
      title: title.trim(), subject: subject.trim(),
      day_of_week: day, start_min: toMin(start), end_min: toMin(end), color,
    } as Partial<TimetableBlock>)
    setOpen(false)
    setTitle('')
    setSubject('')
  }

  const dayBlocks = (d: number) =>
    rows.filter((b) => b.day_of_week === d).sort((a, b) => a.start_min - b.start_min)

  return (
    <Page
      title="Planner"
      subtitle="Your daily timetable and weekly study plan."
      actions={
        <div className="flex gap-2">
          <div className="glass flex rounded-2xl p-1">
            {(['day', 'week'] as const).map((v) => (
              <button key={v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded-xl px-4 py-1.5 text-sm font-semibold capitalize transition',
                  view === v ? 'bg-brand-500 text-white shadow' : 'text-slate-500',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <Button onClick={() => setOpen(true)}><Plus size={16} /> Add block</Button>
        </div>
      }
    >
      {view === 'day' ? (
        <>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {DAYS.map((d, i) => (
              <button key={d}
                onClick={() => setDay(i)}
                className={cn(
                  'min-w-16 rounded-2xl px-4 py-2.5 text-sm font-bold transition',
                  day === i ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <GlassCard>
            {dayBlocks(day).length === 0 ? (
              <Empty emoji="🗓️" text={'No blocks on this day yet.\nTap "Add block" to plan it.'} />
            ) : (
              <div className="space-y-2">
                {dayBlocks(day).map((b) => (
                  <div key={b.id} className="group flex items-center gap-4 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3.5">
                    <div className="h-12 w-1.5 rounded-full" style={{ background: b.color }} />
                    <div className="w-28 text-sm font-semibold text-slate-500">{timeLabel(b.start_min)}<br /><span className="text-xs font-normal">to {timeLabel(b.end_min)}</span></div>
                    <div className="flex-1">
                      <div className="font-bold text-slate-900 dark:text-white">{b.title}</div>
                      {b.subject && <div className="text-xs text-slate-500">{b.subject}</div>}
                    </div>
                    <button onClick={() => remove(b.id)} className="rounded-full p-2 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {DAYS.map((d, i) => (
            <GlassCard key={d} className="!p-3">
              <div className="mb-2 text-center text-sm font-extrabold text-slate-700 dark:text-slate-200">{d}</div>
              <div className="space-y-1.5">
                {dayBlocks(i).length === 0 && <div className="py-4 text-center text-xs text-slate-400">—</div>}
                {dayBlocks(i).map((b) => (
                  <div key={b.id} className="rounded-xl px-2.5 py-2 text-xs font-semibold text-white" style={{ background: b.color }}>
                    <div className="truncate">{b.title}</div>
                    <div className="opacity-80">{timeLabel(b.start_min)}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add timetable block">
        <div className="space-y-3">
          <Input placeholder="Title (e.g. Maths revision)" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Input placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <div className="flex gap-2">
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}
              className="flex-1 rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[&>option]:bg-slate-800">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="flex-1" />
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="flex-1" />
          </div>
          <div className="flex gap-2">
            {SUBJECT_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={cn('h-8 w-8 rounded-full transition', color === c && 'ring-2 ring-offset-2 ring-slate-400')}
                style={{ background: c }} />
            ))}
          </div>
          <Button className="w-full" size="lg" onClick={add}>Add to timetable</Button>
        </div>
      </Modal>
    </Page>
  )
}
