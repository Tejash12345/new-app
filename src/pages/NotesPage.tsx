import { useRef, useState } from 'react'
import { Bold, Italic, List, Plus, Trash2, RotateCw } from 'lucide-react'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import type { Flashcard, Habit, JournalEntry, Note } from '../lib/types'
import { Button, Empty, GlassCard, Input, Modal, Page, TextArea } from '../components/ui'
import { SUBJECT_COLORS, cn, todayKey } from '../lib/utils'

const NOTE_COLORS = ['#FFF59D', '#B2EBF2', '#FFCCBC', '#C8E6C9', '#E1BEE7', '#FFE0E6']
const TABS = ['Notes', 'Flashcards', 'Habits', 'Journal'] as const

export function NotesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Notes')

  return (
    <Page title="Notes & More" subtitle="Notes, flashcards, habits and your daily journal.">
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-bold transition',
              tab === t ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
            )}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Notes' && <NotesTab />}
      {tab === 'Flashcards' && <FlashcardsTab />}
      {tab === 'Habits' && <HabitsTab />}
      {tab === 'Journal' && <JournalTab />}
    </Page>
  )
}

// ---------------- Notes (rich text) ----------------
function NotesTab() {
  const { rows, insert, update, remove } = useTable<Note>('notes', { orderBy: 'updated_at' })
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  function openEditor(n: Note | 'new') {
    setEditing(n)
    setTitle(n === 'new' ? '' : n.title)
    setColor(n === 'new' ? 0 : n.color)
    setTimeout(() => {
      if (bodyRef.current) bodyRef.current.innerHTML = n === 'new' ? '' : n.body
    }, 50)
  }

  async function save() {
    const body = bodyRef.current?.innerHTML ?? ''
    if (!title.trim() && !body.trim()) { setEditing(null); return }
    if (editing === 'new') {
      await insert({ title: title.trim(), body, color } as Partial<Note>)
    } else if (editing) {
      await update({ id: editing.id, title: title.trim(), body, color, updated_at: new Date().toISOString() } as Partial<Note> & { id: string })
    }
    setEditing(null)
  }

  const cmd = (c: string) => document.execCommand(c)

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => openEditor('new')}><Plus size={16} /> New note</Button>
      </div>
      {rows.length === 0 ? (
        <GlassCard><Empty emoji="📝" text="No notes yet. Capture ideas, summaries and class notes here." /></GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((n) => (
            <GlassCard key={n.id} float onClick={() => openEditor(n)} className="relative !p-4" >
              <div className="absolute left-0 top-0 h-1.5 w-full rounded-t-3xl" style={{ background: NOTE_COLORS[n.color % NOTE_COLORS.length] }} />
              <div className="mt-1 font-bold text-slate-900 dark:text-white">{n.title || '(untitled)'}</div>
              <div className="rte mt-1 line-clamp-4 text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: n.body }} />
              <div className="mt-2 text-[10px] text-slate-400">{new Date(n.updated_at).toLocaleDateString()}</div>
            </GlassCard>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={save} title={editing === 'new' ? 'New note' : 'Edit note'} wide>
        <div className="space-y-3">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => cmd('bold')}><Bold size={15} /></Button>
            <Button variant="ghost" size="sm" onClick={() => cmd('italic')}><Italic size={15} /></Button>
            <Button variant="ghost" size="sm" onClick={() => cmd('insertUnorderedList')}><List size={15} /></Button>
            <div className="ml-auto flex items-center gap-1.5">
              {NOTE_COLORS.map((c, i) => (
                <button key={c} onClick={() => setColor(i)}
                  className={cn('h-6 w-6 rounded-full', color === i && 'ring-2 ring-slate-400 ring-offset-1')}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div
            ref={bodyRef} contentEditable suppressContentEditableWarning
            className="rte min-h-44 rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-3 text-sm"
          />
          <div className="flex justify-between">
            {editing !== 'new' && editing && (
              <Button variant="danger" onClick={async () => { await remove(editing.id); setEditing(null) }}>
                <Trash2 size={15} /> Delete
              </Button>
            )}
            <Button className="ml-auto" onClick={save}>Save note</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// ---------------- Flashcards ----------------
function FlashcardsTab() {
  const { rows, insert, update, remove } = useTable<Flashcard>('flashcards')
  const { addXp } = useAuth()
  const [open, setOpen] = useState(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [deck, setDeck] = useState('General')
  const [study, setStudy] = useState<{ i: number; flipped: boolean } | null>(null)

  const decks = [...new Set(rows.map((c) => c.deck))]
  const [activeDeck, setActiveDeck] = useState<string | null>(null)
  const cards = activeDeck ? rows.filter((c) => c.deck === activeDeck) : rows

  async function add() {
    if (!front.trim() || !back.trim()) return
    await insert({ front: front.trim(), back: back.trim(), deck: deck.trim() || 'General' } as Partial<Flashcard>)
    setFront(''); setBack('')
  }

  async function grade(know: boolean) {
    if (!study) return
    const card = cards[study.i]
    await update({ id: card.id, ease: Math.max(0, Math.min(5, card.ease + (know ? 1 : -1))) } as Partial<Flashcard> & { id: string })
    if (know) await addXp(2, 'Flashcard recalled')
    if (study.i + 1 < cards.length) setStudy({ i: study.i + 1, flipped: false })
    else { setStudy(null); await addXp(10, 'Deck review complete') }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setActiveDeck(null)}
          className={cn('rounded-2xl px-3 py-1.5 text-sm font-bold', !activeDeck ? 'bg-brand-500 text-white' : 'glass text-slate-500')}>
          All ({rows.length})
        </button>
        {decks.map((d) => (
          <button key={d} onClick={() => setActiveDeck(d)}
            className={cn('rounded-2xl px-3 py-1.5 text-sm font-bold', activeDeck === d ? 'bg-brand-500 text-white' : 'glass text-slate-500')}>
            {d}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {cards.length > 0 && <Button variant="soft" onClick={() => setStudy({ i: 0, flipped: false })}><RotateCw size={15} /> Study {cards.length}</Button>}
          <Button onClick={() => setOpen(true)}><Plus size={16} /> Add card</Button>
        </div>
      </div>

      {cards.length === 0 ? (
        <GlassCard><Empty emoji="🃏" text={'No flashcards yet.\nGreat for formulas, vocabulary and definitions!'} /></GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <GlassCard key={c.id} className="group relative !p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-brand-500">{c.deck}</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-white">{c.front}</div>
              <div className="mt-1 text-sm text-slate-500">{c.back}</div>
              <div className="mt-2 text-[10px] text-slate-400">mastery {'★'.repeat(c.ease)}{'☆'.repeat(5 - c.ease)}</div>
              <button onClick={() => remove(c.id)} className="absolute right-3 top-3 rounded-full p-1.5 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500">
                <Trash2 size={14} />
              </button>
            </GlassCard>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add flashcard">
        <div className="space-y-3">
          <Input placeholder="Deck (e.g. Physics)" value={deck} onChange={(e) => setDeck(e.target.value)} />
          <TextArea placeholder="Front — the question" rows={2} value={front} onChange={(e) => setFront(e.target.value)} />
          <TextArea placeholder="Back — the answer" rows={2} value={back} onChange={(e) => setBack(e.target.value)} />
          <Button className="w-full" onClick={add}>Add (and keep adding)</Button>
        </div>
      </Modal>

      <Modal open={!!study} onClose={() => setStudy(null)} title={`Card ${(study?.i ?? 0) + 1} of ${cards.length}`}>
        {study && cards[study.i] && (
          <div className="space-y-4">
            <button
              onClick={() => setStudy({ ...study, flipped: !study.flipped })}
              className="glass w-full rounded-3xl px-6 py-12 text-center"
            >
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">{study.flipped ? 'Answer' : 'Question — tap to flip'}</div>
              <div className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                {study.flipped ? cards[study.i].back : cards[study.i].front}
              </div>
            </button>
            {study.flipped && (
              <div className="flex gap-3">
                <Button variant="danger" className="flex-1" onClick={() => grade(false)}>Didn't know</Button>
                <Button className="flex-1" onClick={() => grade(true)}>Knew it! +2 XP</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

// ---------------- Habits ----------------
function HabitsTab() {
  const { rows, insert, update, remove } = useTable<Habit>('habits')
  const { addXp } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🌟')
  const [color, setColor] = useState(SUBJECT_COLORS[0])
  const today = todayKey()
  const last7 = Array.from({ length: 7 }, (_, i) => todayKey(new Date(Date.now() - (6 - i) * 86_400_000)))

  async function toggle(h: Habit, day: string) {
    const has = h.checks.includes(day)
    await update({ id: h.id, checks: has ? h.checks.filter((c) => c !== day) : [...h.checks, day] } as Partial<Habit> & { id: string })
    if (!has && day === today) await addXp(5, `Habit done: ${h.name}`)
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> New habit</Button>
      </div>
      {rows.length === 0 ? (
        <GlassCard><Empty emoji="🔥" text={'Build streaks that build you.\nDrink water, revise daily, sleep early…'} /></GlassCard>
      ) : (
        <div className="space-y-3">
          {rows.map((h) => {
            let streak = 0
            for (let i = 0; ; i++) {
              const k = todayKey(new Date(Date.now() - i * 86_400_000))
              if (h.checks.includes(k)) streak++
              else if (i === 0) continue
              else break
            }
            return (
              <GlassCard key={h.id} className="group">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl" style={{ background: `${h.color}1e` }}>{h.emoji}</div>
                  <div className="min-w-32 flex-1">
                    <div className="font-bold text-slate-900 dark:text-white">{h.name}</div>
                    <div className="text-xs text-slate-500">🔥 {streak} day streak</div>
                  </div>
                  <div className="flex gap-1.5">
                    {last7.map((d) => {
                      const done = h.checks.includes(d)
                      return (
                        <button key={d} onClick={() => toggle(h, d)}
                          className={cn('h-8 w-8 rounded-xl text-xs font-bold transition', d === today && 'ring-2 ring-offset-1 ring-slate-300 dark:ring-slate-600')}
                          style={done ? { background: h.color, color: '#fff' } : { background: `${h.color}1a`, color: h.color }}>
                          {done ? '✓' : new Date(d).getDate()}
                        </button>
                      )
                    })}
                  </div>
                  <button onClick={() => remove(h.id)} className="rounded-full p-2 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500">
                    <Trash2 size={15} />
                  </button>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New habit">
        <div className="space-y-3">
          <Input placeholder="e.g. Revise 30 minutes" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="flex flex-wrap gap-2">
            {['🌟', '💧', '🏃', '📖', '🧘', '💪', '🥗', '😴', '✍️', '🧠'].map((e) => (
              <button key={e} onClick={() => setEmoji(e)}
                className={cn('rounded-xl p-2 text-xl', emoji === e ? 'bg-brand-500/20 ring-2 ring-brand-400' : 'bg-slate-500/10')}>
                {e}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {SUBJECT_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={cn('h-8 w-8 rounded-full', color === c && 'ring-2 ring-offset-2 ring-slate-400')}
                style={{ background: c }} />
            ))}
          </div>
          <Button className="w-full" onClick={async () => {
            if (!name.trim()) return
            await insert({ name: name.trim(), emoji, color, checks: [] } as Partial<Habit>)
            setOpen(false); setName('')
          }}>Create habit</Button>
        </div>
      </Modal>
    </>
  )
}

// ---------------- Journal & Mood ----------------
function JournalTab() {
  const { rows, insert, update } = useTable<JournalEntry>('journal_entries', { orderBy: 'entry_date' })
  const today = todayKey()
  const todayEntry = rows.find((r) => r.entry_date === today)
  const [body, setBody] = useState(todayEntry?.body ?? '')
  const [savedFlash, setSavedFlash] = useState(false)
  const MOODS = ['😞', '😕', '😐', '🙂', '😄']

  async function setMood(m: number) {
    if (todayEntry) await update({ id: todayEntry.id, mood: m } as Partial<JournalEntry> & { id: string })
    else await insert({ entry_date: today, mood: m, body } as Partial<JournalEntry>)
  }

  async function saveBody() {
    if (todayEntry) await update({ id: todayEntry.id, body } as Partial<JournalEntry> & { id: string })
    else await insert({ entry_date: today, mood: 0, body } as Partial<JournalEntry>)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard>
        <h3 className="mb-3 font-bold text-slate-900 dark:text-white">How do you feel today?</h3>
        <div className="mb-5 flex justify-around">
          {MOODS.map((m, i) => (
            <button key={m} onClick={() => setMood(i + 1)}
              className={cn('rounded-2xl p-2 text-3xl transition hover:scale-110', todayEntry?.mood === i + 1 && 'bg-brand-500/15 ring-2 ring-brand-400')}>
              {m}
            </button>
          ))}
        </div>
        <TextArea
          rows={6} placeholder="Write about your day, wins, struggles…"
          value={body} onChange={(e) => setBody(e.target.value)}
        />
        <Button className="mt-3 w-full" onClick={saveBody}>{savedFlash ? 'Saved ✓' : 'Save journal'}</Button>
      </GlassCard>

      <GlassCard>
        <h3 className="mb-3 font-bold text-slate-900 dark:text-white">Past entries</h3>
        {rows.length === 0 ? (
          <Empty emoji="📔" text="Your journal history will appear here." />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{new Date(r.entry_date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="text-base">{r.mood ? MOODS[r.mood - 1] : ''}</span>
                </div>
                {r.body && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">{r.body}</p>}
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  )
}
