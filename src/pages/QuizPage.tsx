import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Swords, RotateCw, CheckCircle2, XCircle } from 'lucide-react'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import { explainQuizQuestion, generateQuiz, type QuizQuestion } from '../lib/ai'
import type { Note, QuizResult } from '../lib/types'
import { Button, Empty, GlassCard, Input, Page, ProgressRing, SectionTitle } from '../components/ui'
import { cn, timeAgo } from '../lib/utils'

// ----------------------------------------------------------------------------
// AI Quiz Arena — Leo builds a multiple-choice quiz on any topic (or on one of
// the user's own notes), grades it instantly with explanations, and pays out
// XP. History is saved to `quiz_results` (upgrade-27.sql).
// ----------------------------------------------------------------------------

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const
const COUNTS = [5, 10] as const

type Phase = 'setup' | 'loading' | 'playing' | 'done'

// ---- exam categories — real competitive-exam patterns Leo can imitate ----
type ExamSpec = { key: string; name: string; emoji: string; tagline: string; subjects: string[]; style: string }

const EXAMS: ExamSpec[] = [
  {
    key: 'neet', name: 'NEET', emoji: '🩺', tagline: 'Medical entrance',
    subjects: ['Biology', 'Physics', 'Chemistry', 'Mixed'],
    style: 'NEET-UG (India medical entrance) exam pattern — NCERT Class 11-12 syllabus, single-correct MCQs like the real paper',
  },
  {
    key: 'jee', name: 'JEE', emoji: '⚙️', tagline: 'Engineering entrance',
    subjects: ['Physics', 'Chemistry', 'Maths', 'Mixed'],
    style: 'JEE Main (India engineering entrance) exam pattern — Class 11-12 syllabus, conceptual and numerical single-correct MCQs',
  },
  {
    key: 'norcet', name: 'NORCET', emoji: '💉', tagline: 'AIIMS nursing officer',
    subjects: ['Medical-Surgical', 'Fundamentals', 'Pharmacology', 'Anatomy & Physio', 'OBG', 'Pediatric', 'Psychiatric', 'Mixed'],
    style: 'NORCET / AIIMS Nursing Officer exam pattern — clinical, applied nursing questions exactly like the real recruitment exam',
  },
  {
    key: 'upsc', name: 'UPSC', emoji: '🏛️', tagline: 'Civil services',
    subjects: ['Polity', 'History', 'Geography', 'Economy', 'Environment', 'Mixed'],
    style: 'UPSC Civil Services Prelims (GS Paper 1) pattern — analytical, statement-based questions where suitable',
  },
  {
    key: 'ca', name: 'Current Affairs', emoji: '📰', tagline: 'News & events GK',
    subjects: ['National', 'International', 'Sports', 'Science & Tech', 'Awards & Honours', 'Mixed'],
    style: 'competitive-exam current-affairs section — events, appointments, schemes, awards, sports and summits from recent years, plus linked static GK; only well-established facts you are sure of',
  },
  {
    key: 'banking', name: 'Banking', emoji: '🏦', tagline: 'IBPS · SBI · RBI',
    subjects: ['Quantitative Aptitude', 'Reasoning', 'Banking Awareness', 'English', 'Mixed'],
    style: 'IBPS / SBI bank exam pattern (Prelims + Mains style)',
  },
  {
    key: 'ssc', name: 'SSC', emoji: '🏢', tagline: 'CGL · CHSL · MTS · GD',
    subjects: ['General Awareness', 'Quantitative Aptitude', 'Reasoning', 'English', 'Mixed'],
    style: 'SSC (CGL / CHSL / MTS / GD) exam pattern',
  },
  {
    key: 'railways', name: 'Railways', emoji: '🚆', tagline: 'NTPC · Group D · ALP · JE',
    subjects: ['General Awareness', 'Maths', 'Reasoning', 'General Science', 'Mixed'],
    style: 'Indian Railways RRB exam pattern (NTPC, Group D, ALP, JE, RPF)',
  },
  {
    key: 'groups', name: 'Groups', emoji: '🎯', tagline: 'Group 1 · 2 · 3 · 4',
    subjects: ['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Mixed'],
    style: 'State PSC Groups services exam pattern (TSPSC / APPSC style) — General Studies, state history, culture, geography, economy, polity and current affairs, pitched at the level of the chosen Group (Group 1 toughest, Group 4 basic)',
  },
  {
    key: 'mro', name: 'MRO / VRO', emoji: '🏘️', tagline: 'Revenue dept exams',
    subjects: ['Land Revenue & Rural Admin', 'State GK & Culture', 'Polity', 'Economy', 'Current Affairs', 'Arithmetic & Reasoning', 'Mixed'],
    style: 'MRO / VRO Revenue department recruitment exam pattern (Telangana / Andhra Pradesh style) — village and mandal administration, land revenue system, rural development schemes and state-specific General Studies',
  },
  {
    key: 'statepsc', name: 'State Exams', emoji: '🗳️', tagline: 'PSC · Panchayat Secretary',
    subjects: ['State GK & Culture', 'Polity', 'History', 'Geography', 'Economy', 'Science', 'Current Affairs', 'Mixed'],
    style: 'State Public Service Commission exam pattern (Panchayat Secretary, Endowments, other state posts) — state-specific GK, history, culture and schemes where relevant',
  },
  {
    key: 'police', name: 'Police', emoji: '🚔', tagline: 'SI · Constable',
    subjects: ['General Studies', 'Reasoning', 'Maths', 'Current Affairs', 'Mixed'],
    style: 'State Police SI / Constable recruitment exam pattern',
  },
  {
    key: 'teaching', name: 'Teaching', emoji: '🧑‍🏫', tagline: 'CTET · TET · DSC',
    subjects: ['Child Development & Pedagogy', 'Maths', 'EVS', 'Science', 'Social Studies', 'Language', 'Mixed'],
    style: 'CTET / State TET / DSC teacher recruitment exam pattern',
  },
  {
    key: 'gate', name: 'GATE', emoji: '🎓', tagline: 'Engineering PG',
    subjects: ['CS & IT', 'Mechanical', 'Civil', 'Electrical', 'Electronics', 'Engineering Maths'],
    style: 'GATE exam pattern — concept-heavy, applied engineering questions',
  },
  {
    key: 'defence', name: 'Defence', emoji: '🎖️', tagline: 'NDA · CDS · AFCAT',
    subjects: ['Maths', 'General Ability', 'English', 'Mixed'],
    style: 'NDA / CDS defence entrance exam pattern',
  },
  {
    key: 'aptitude', name: 'Aptitude', emoji: '🧮', tagline: 'Placement prep',
    subjects: ['Quantitative', 'Logical Reasoning', 'Verbal', 'Data Interpretation', 'Mixed'],
    style: 'campus-placement aptitude test pattern (TCS / Infosys / accenture style)',
  },
  {
    key: 'coding', name: 'Coding', emoji: '💻', tagline: 'CS & programming',
    subjects: ['Python', 'JavaScript', 'Java', 'C', 'DSA', 'SQL', 'Mixed'],
    style: 'programming and computer-science MCQs, with short code snippets in questions where useful',
  },
  {
    key: 'english', name: 'English', emoji: '🇬🇧', tagline: 'Grammar & vocab',
    subjects: ['Grammar', 'Vocabulary', 'Idioms & Phrases', 'Comprehension', 'Mixed'],
    style: 'competitive-exam English section pattern',
  },
  {
    key: 'gk', name: 'General Knowledge', emoji: '🌍', tagline: 'Static GK',
    subjects: ['India', 'World', 'Science', 'History', 'Sports', 'Mixed'],
    style: 'static general-knowledge quiz for competitive exams',
  },
]

export function QuizPage() {
  const { addXp } = useAuth()
  const { rows: history, insert: saveResult } = useTable<QuizResult>('quiz_results', { orderBy: 'created_at' })
  const { rows: notes } = useTable<Note>('notes', { orderBy: 'updated_at' })

  const [phase, setPhase] = useState<Phase>('setup')
  const [exam, setExam] = useState<ExamSpec | null>(null)   // null = custom topic mode
  const [subject, setSubject] = useState('Mixed')
  const [qsrc, setQsrc] = useState<'pyq' | 'repeated' | 'fresh'>('pyq')
  const [stateName, setStateName] = useState('')            // for state-level exams (Groups/MRO/Police/DSC)
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>('Medium')
  const [count, setCount] = useState<(typeof COUNTS)[number]>(5)
  const [noteId, setNoteId] = useState('')
  const [error, setError] = useState('')

  const [playedTopic, setPlayedTopic] = useState('')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correct, setCorrect] = useState(0)
  const [earned, setEarned] = useState(0)

  // on-demand deep explanation for the current question
  const [detail, setDetail] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)

  /** true for exams where the user's state matters (Groups/MRO/Police/DSC) */
  const isStateExam = !!exam && ['groups', 'mro', 'statepsc', 'police', 'teaching'].includes(exam.key)

  async function start() {
    const note = exam ? undefined : notes.find((n) => n.id === noteId)
    // strip the note's rich-text HTML down to plain study material
    const source = note ? note.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
    // state-level exams get the user's state woven into the name + style
    const examName = exam ? (isStateExam && stateName.trim() ? `${stateName.trim()} ${exam.name}` : exam.name) : ''
    const examStyle = exam
      ? exam.style + (isStateExam && stateName.trim() ? ` Focus on ${stateName.trim()} state-specific GK, history, culture, rivers, schemes and current affairs where relevant.` : '')
      : undefined
    // what the AI is quizzed on vs. the short label saved to history
    const aiTopic = exam
      ? (subject === 'Mixed' ? `the full ${examName} syllabus` : `${subject} (${examName} syllabus)`)
      : (topic.trim() || note?.title.trim() || '')
    const srcTag = qsrc === 'pyq' ? ' · 📜 PYQ' : qsrc === 'repeated' ? ' · 🔁 Repeated' : ''
    const label = exam
      ? `${exam.emoji} ${examName}${subject !== 'Mixed' ? ` · ${subject}` : ''}${srcTag}`
      : (topic.trim() || note?.title.trim() || '')
    if (!aiTopic) return
    setPhase('loading')
    setError('')
    try {
      const qs = await generateQuiz({
        topic: aiTopic, difficulty, count,
        source: source || undefined, style: examStyle,
        mode: exam ? qsrc : 'fresh',
      })
      if (qs.length < 3) throw new Error('Leo could not build that quiz — try a clearer topic. 🦁')
      setPlayedTopic(label)
      setQuestions(qs)
      setI(0)
      setPicked(null)
      setCorrect(0)
      setDetail('')
      setPhase('playing')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setPhase('setup')
    }
  }

  function pick(idx: number) {
    if (picked !== null) return
    setPicked(idx)
    if (idx === questions[i].answer) setCorrect((c) => c + 1)
  }

  async function explainMore() {
    if (detailLoading || detail) return
    setDetailLoading(true)
    try {
      const text = await explainQuizQuestion({ q: q.q, options: q.options, answer: q.answer, topic: playedTopic })
      setDetail(text || 'Leo had no more to add on this one. 🦁')
    } catch (e) {
      setDetail(e instanceof Error ? e.message : 'Could not load the explanation — try again.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function next() {
    if (i + 1 < questions.length) {
      setI(i + 1)
      setPicked(null)
      setDetail('')
      return
    }
    // finished — `correct` already includes this question (picked before Next)
    const xp = correct * 2 + (correct === questions.length ? 10 : 0)
    setEarned(xp)
    setPhase('done')
    if (xp > 0) await addXp(xp, `Quiz: ${playedTopic} ${correct}/${questions.length}`)
    try {
      await saveResult({ topic: playedTopic, difficulty, score: correct, total: questions.length, xp } as Partial<QuizResult>)
    } catch { /* quiz_results table not installed yet — the quiz itself still works */ }
  }

  const q = questions[i]
  const pct = questions.length ? Math.round((correct / questions.length) * 100) : 0
  const best = history.reduce((m, r) => Math.max(m, r.total ? Math.round((r.score / r.total) * 100) : 0), 0)

  return (
    <Page title="Quiz Arena" subtitle="Pick any topic — Leo builds the quiz, you earn the XP. ⚔️">
      {phase === 'setup' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <GlassCard className="lg:col-span-2">
            <SectionTitle>Pick your exam</SectionTitle>
            <div className="space-y-4">
              {/* exam categories */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {EXAMS.map((ex) => (
                  <button key={ex.key}
                    onClick={() => {
                      setExam(ex)
                      setSubject(ex.subjects.includes('Mixed') ? 'Mixed' : ex.subjects[0])
                      setNoteId('')
                    }}
                    className={cn(
                      'rounded-2xl border p-3 text-left transition',
                      exam?.key === ex.key
                        ? 'border-brand-400/60 bg-brand-500/15 shadow-lg shadow-brand-500/20'
                        : 'glass border-transparent hover:bg-brand-500/10',
                    )}>
                    <div className="text-2xl">{ex.emoji}</div>
                    <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{ex.name}</div>
                    <div className="text-[10px] text-slate-500">{ex.tagline}</div>
                  </button>
                ))}
                <button
                  onClick={() => setExam(null)}
                  className={cn(
                    'rounded-2xl border p-3 text-left transition',
                    exam === null
                      ? 'border-brand-400/60 bg-brand-500/15 shadow-lg shadow-brand-500/20'
                      : 'glass border-transparent hover:bg-brand-500/10',
                  )}>
                  <div className="text-2xl">✏️</div>
                  <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">My topic</div>
                  <div className="text-[10px] text-slate-500">Anything, or a note</div>
                </button>
              </div>

              {/* subject pills for the chosen exam */}
              {exam && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{exam.emoji} {exam.name} — subject</div>
                  <div className="flex flex-wrap gap-2">
                    {exam.subjects.map((s) => (
                      <button key={s} onClick={() => setSubject(s)}
                        className={cn(
                          'rounded-2xl px-3.5 py-2 text-sm font-bold transition',
                          subject === s ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                        )}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* your state — for Groups/MRO/VRO, Police, DSC */}
              {isStateExam && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Your state (optional — makes GK state-specific)</div>
                  <Input placeholder="e.g. Telangana, Andhra Pradesh, UP, Maharashtra…"
                    value={stateName} onChange={(e) => setStateName(e.target.value)} />
                </div>
              )}

              {/* question source: PYQ / most repeated / fresh */}
              {exam && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Question source</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setQsrc('pyq')}
                      className={cn(
                        'flex-1 whitespace-nowrap rounded-2xl px-3 py-2.5 text-sm font-bold transition',
                        qsrc === 'pyq' ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-white shadow-lg shadow-amber-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      📜 Previous year
                    </button>
                    <button onClick={() => setQsrc('repeated')}
                      className={cn(
                        'flex-1 whitespace-nowrap rounded-2xl px-3 py-2.5 text-sm font-bold transition',
                        qsrc === 'repeated' ? 'bg-gradient-to-r from-purple-500 to-purple-400 text-white shadow-lg shadow-purple-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      🔁 Most repeated
                    </button>
                    <button onClick={() => setQsrc('fresh')}
                      className={cn(
                        'flex-1 whitespace-nowrap rounded-2xl px-3 py-2.5 text-sm font-bold transition',
                        qsrc === 'fresh' ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      ✨ Fresh
                    </button>
                  </div>
                  {qsrc === 'pyq' && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Real past-paper questions, each tagged with the exam session (month/year). Cross-check with official papers for final revision.
                    </p>
                  )}
                  {qsrc === 'repeated' && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      The high-frequency questions asked again and again across years — the ones toppers revise first, tagged with the years they appeared.
                    </p>
                  )}
                </div>
              )}

              {/* custom topic mode */}
              {!exam && (
                <>
                  <Input
                    placeholder="Topic — e.g. Photosynthesis, World War 2, Python basics…"
                    value={topic} onChange={(e) => setTopic(e.target.value)}
                  />
                  {notes.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Quiz me on one of my notes (optional)</div>
                      <select value={noteId} onChange={(e) => setNoteId(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[&>option]:bg-slate-800">
                        <option value="">No — just the topic above</option>
                        {notes.map((n) => <option key={n.id} value={n.id}>{n.title || '(untitled note)'}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Difficulty</div>
                <div className="flex gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button key={d} onClick={() => setDifficulty(d)}
                      className={cn(
                        'flex-1 rounded-2xl px-4 py-2.5 text-sm font-bold transition',
                        difficulty === d ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Questions</div>
                <div className="flex gap-2">
                  {COUNTS.map((c) => (
                    <button key={c} onClick={() => setCount(c)}
                      className={cn(
                        'flex-1 rounded-2xl px-4 py-2.5 text-sm font-bold transition',
                        count === c ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-500">{error}</p>}
              <Button className="w-full" size="lg" onClick={start} disabled={!exam && !topic.trim() && !noteId}>
                <Swords size={17} /> Start {exam ? `${exam.name} quiz` : 'quiz'}
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <SectionTitle>Your record</SectionTitle>
            {history.length === 0 ? (
              <Empty emoji="⚔️" text={'No quizzes yet.\nYour scores and streaks will show here.'} />
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-3">
                    <div className="text-xl font-extrabold text-slate-900 dark:text-white">{history.length}</div>
                    <div className="text-[11px] text-slate-500">quizzes taken</div>
                  </div>
                  <div className="rounded-2xl bg-amber-400/15 px-3 py-3">
                    <div className="text-xl font-extrabold text-amber-500">{best}%</div>
                    <div className="text-[11px] text-slate-500">best score</div>
                  </div>
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {history.slice(0, 12).map((r) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{r.topic}</div>
                        <div className="text-[11px] text-slate-500">{r.difficulty} · {timeAgo(r.created_at)}</div>
                      </div>
                      <div className={cn(
                        'text-sm font-extrabold',
                        r.total && r.score / r.total >= 0.8 ? 'text-emerald-500' : r.total && r.score / r.total >= 0.5 ? 'text-amber-500' : 'text-rose-500',
                      )}>
                        {r.score}/{r.total}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </GlassCard>
        </div>
      )}

      {phase === 'loading' && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="animate-bounce text-6xl">🦁</div>
            <p className="mt-4 font-bold text-slate-900 dark:text-white">Leo is writing your {exam ? `${exam.name} ` : ''}quiz…</p>
            <p className="mt-1 text-sm text-slate-500">
              {count} {difficulty.toLowerCase()} questions{exam && subject !== 'Mixed' ? ` on ${subject}` : ''} — real exam pattern.
            </p>
          </div>
        </GlassCard>
      )}

      {phase === 'playing' && q && (
        <div className="mx-auto max-w-2xl">
          {/* progress */}
          <div className="mb-4">
            <div className="mb-1.5 flex justify-between text-xs font-bold text-slate-500">
              <span>Question {i + 1} of {questions.length}</span>
              <span className="text-emerald-500">{correct} correct</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-purple-500"
                animate={{ width: `${((i + (picked !== null ? 1 : 0)) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          <GlassCard>
            {q.asked && (
              <div className={cn(
                'mb-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
                qsrc === 'repeated'
                  ? 'bg-purple-400/15 text-purple-600 dark:text-purple-300'
                  : 'bg-amber-400/15 text-amber-600 dark:text-amber-300',
              )}>
                {qsrc === 'repeated'
                  ? (q.asked === 'Frequently asked' ? '🔁 Frequently asked (years not on record)' : `🔁 Repeated in ${q.asked}`)
                  : q.asked === 'PYQ-style' ? '📜 PYQ-style question' : `📜 Asked in ${q.asked}`}
              </div>
            )}
            <div className="mb-4 text-lg font-bold text-slate-900 dark:text-white">{q.q}</div>
            <div className="space-y-2.5">
              {q.options.map((opt, idx) => {
                const isAnswer = idx === q.answer
                const isPicked = idx === picked
                return (
                  <button key={idx} onClick={() => pick(idx)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-sm font-semibold transition',
                      picked === null
                        ? 'border-slate-200/60 dark:border-white/10 bg-white/50 dark:bg-white/5 text-slate-800 dark:text-slate-100 hover:bg-brand-500/10 hover:border-brand-400/50'
                        : isAnswer
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : isPicked
                            ? 'border-rose-400/60 bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : 'border-slate-200/40 dark:border-white/5 bg-white/30 dark:bg-white/[0.03] text-slate-400 dark:text-slate-500',
                    )}>
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold',
                      picked === null ? 'bg-slate-500/10 text-slate-500' :
                        isAnswer ? 'bg-emerald-500 text-white' :
                          isPicked ? 'bg-rose-500 text-white' : 'bg-slate-500/10 text-slate-400',
                    )}>
                      {picked !== null && isAnswer ? <CheckCircle2 size={15} /> : picked !== null && isPicked ? <XCircle size={15} /> : String.fromCharCode(65 + idx)}
                    </span>
                    {opt}
                  </button>
                )
              })}
            </div>

            {picked !== null && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                {q.explain && (
                  <p className={cn(
                    'rounded-2xl px-4 py-3 text-sm',
                    picked === q.answer ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-400/10 text-amber-700 dark:text-amber-300',
                  )}>
                    {picked === q.answer ? '✅ ' : '💡 '}{q.explain}
                  </p>
                )}

                {/* on-demand deep-dive from Leo */}
                {detail ? (
                  <div className="mt-2.5 rounded-2xl bg-brand-500/10 px-4 py-3">
                    <div className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-500">🦁 Leo explains</div>
                    <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{detail}</p>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" className="mt-2.5 w-full" onClick={explainMore} disabled={detailLoading}>
                    {detailLoading ? '🦁 Leo is thinking…' : '🔍 Explain this in detail'}
                  </Button>
                )}

                <Button className="mt-3 w-full" size="lg" onClick={next}>
                  {i + 1 < questions.length ? 'Next question' : 'See my score'}
                </Button>
              </motion.div>
            )}
          </GlassCard>
        </div>
      )}

      {phase === 'done' && (
        <div className="mx-auto max-w-md">
          <GlassCard className="text-center">
            <div className="text-5xl">{pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '📚'}</div>
            <div className="mt-3 flex justify-center">
              <ProgressRing size={120} stroke={12} progress={pct / 100}
                color={pct >= 80 ? '#10b981' : pct >= 50 ? '#FFB454' : '#f43f5e'}
                label={`${pct}%`} sub={`${correct}/${questions.length}`} />
            </div>
            <h2 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">
              {pct === 100 ? 'Perfect score! Absolute lion. 🦁' : pct >= 80 ? 'Roaring good! 🦁' : pct >= 50 ? 'Solid effort — keep going!' : 'Every wrong answer teaches you one thing.'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{playedTopic} · {difficulty}</p>
            {earned > 0 && (
              <div className="mx-auto mt-3 inline-block rounded-full bg-amber-400/15 px-4 py-1.5 text-sm font-bold text-amber-500">
                ⭐ +{earned} XP earned
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <Button variant="soft" className="flex-1" onClick={() => { setPhase('setup'); setTopic('') }}>
                <Sparkles size={15} /> New quiz
              </Button>
              <Button className="flex-1" onClick={start}>
                <RotateCw size={15} /> Retry topic
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </Page>
  )
}
