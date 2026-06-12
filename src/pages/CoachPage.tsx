import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Sparkles, Trash2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTable } from '../hooks/db'
import type { SocialSession, StudySession, Task } from '../lib/types'
import { Button, GlassCard, Input, Page, SectionTitle } from '../components/ui'
import { addDays, minutesToLabel, quoteOfTheDay, todayKey } from '../lib/utils'

type Msg = { role: 'user' | 'coach'; text: string }

export function CoachPage() {
  const { profile, user } = useAuth()
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: usage } = useTable<SocialSession>('social_sessions')

  const firstName = (profile?.full_name || 'friend').split(' ')[0]
  const chatKey = `fl-chat-${user?.id ?? 'anon'}`
  const welcome: Msg = {
    role: 'coach',
    text: `Hey ${firstName}! 🦁 I'm Leo, your study coach. Ask me about planning, exams, focus, stress, time management — or tap a suggestion below.`,
  }

  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(chatKey) ?? 'null')
      return Array.isArray(saved) && saved.length > 0 ? saved : [welcome]
    } catch {
      return [welcome]
    }
  })
  const [typing, setTyping] = useState(false)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(chatKey, JSON.stringify(msgs.slice(-60)))
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, typing])

  // ---------- live data for personalized answers ----------
  const today = todayKey()
  const weekStart = todayKey(addDays(new Date(), -6))
  const weekStudy = sessions.filter((s) => s.started_at.slice(0, 10) >= weekStart).reduce((a, s) => a + s.duration_min, 0)
  const weekSocial = usage.filter((u) => u.used_on >= weekStart).reduce((a, u) => a + u.used_min, 0)
  const overdue = tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) < new Date())
  const upcomingExams = tasks.filter((t) => t.kind === 'exam' && !t.done && t.due_at)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
  const subjects = [...new Set(sessions.map((s) => s.subject).filter(Boolean))]
  const studiedToday = sessions.some((s) => s.started_at.slice(0, 10) === today)

  const recommendations = useMemo(() => {
    const recs: string[] = []
    if (overdue.length > 0) recs.push(`⚠️ You have ${overdue.length} overdue item(s). Clear "${overdue[0].title}" first — overdue tasks drain motivation the longest.`)
    if (upcomingExams.length > 0) {
      const ex = upcomingExams[0]
      const daysLeft = Math.ceil((new Date(ex.due_at!).getTime() - Date.now()) / 86_400_000)
      recs.push(`🎓 "${ex.title}" is in ${daysLeft} day(s). Revise in 25-min pomodoros with flashcards, and do one past-paper ${daysLeft > 7 ? 'this weekend' : 'tomorrow'}.`)
    }
    if (!studiedToday) recs.push(`⏱️ No focus session yet today. Even 15 minutes keeps your ${profile?.study_streak ?? 0}-day streak alive.`)
    if (weekSocial > weekStudy && weekSocial > 60) recs.push(`📱 This week: ${minutesToLabel(weekSocial)} scrolled vs ${minutesToLabel(weekStudy)} studied. Cut one app's limit by 15 minutes.`)
    if (subjects.length > 1) {
      const counts = subjects.map((s) => [s, sessions.filter((x) => x.subject === s).reduce((a, x) => a + x.duration_min, 0)] as const)
      const least = [...counts].sort((a, b) => a[1] - b[1])[0]
      recs.push(`📖 "${least[0]}" got the least attention recently — schedule a revision block for it this week.`)
    }
    if (recs.length === 0) recs.push('🌟 Everything looks balanced! Add tasks, exams and focus sessions, and I\'ll spot patterns for you.')
    return recs
  }, [tasks, sessions, usage])

  // ---------- the coach brain ----------
  function coachReply(q: string): string {
    const s = q.toLowerCase()
    const [quote, author] = quoteOfTheDay()

    if (/(stress|anxiet|anxious|worried|panic|nervous|scared|fear|overwhelm)/.test(s)) {
      return `Take a breath, ${firstName}. 🫁 Stress means you care — let's channel it:\n\n1. Box breathing: in 4s → hold 4s → out 4s → hold 4s. Do 4 rounds right now.\n2. Write down the ONE thing worrying you most, then do just 10 minutes on it. Action shrinks anxiety.\n3. Stuck thoughts at night? Brain-dump them in your Journal (Notes → Journal).\n\nIf the heaviness doesn't lift for weeks, please talk to a parent, teacher or counselor — that's strength, not weakness. 💛`
    }
    if (/(time management|no time|too busy|so much to do|how to manage|balance)/.test(s)) {
      return `Time management, lion-style 🦁:\n\n1. Sunday night: list everything for the week in Tasks.\n2. Big rocks first: put your 2 hardest subjects into the Planner at your peak-energy hours.\n3. Use the 1-3-5 rule daily: 1 big thing, 3 medium, 5 small.\n4. Protect study blocks with Deep Focus mode — one block done beats five blocks planned.\n\nYou don't need more time, you need fewer decisions. The timetable decides for you.`
    }
    if (/(parent|mom|dad|mother|father|family|pressure from)/.test(s)) {
      return `Family pressure is heavy, I know. Here's what helps:\n\n1. Show, don't argue: share your weekly Parent Report (Report page) — real numbers calm worried parents better than promises.\n2. Agree on a deal: fixed study hours + guilt-free free time. The Wellbeing limits make it official.\n3. Remember: their pressure is usually fear in disguise — fear for your future. The report shows them you've got this. 🦁`
    }
    if (/(plan|schedule|timetable|organize|organise)/.test(s)) {
      return `Here's a planning method that works, ${firstName}:\n\n1. List everything due this week (Tasks page).\n2. Put the 2 hardest subjects in your peak-energy hours in the Planner.\n3. 25-min pomodoros with 5-min breaks — 3 to 4 rounds per subject.\n4. Friday: review what slipped and move it to the weekend.\n\nCheck my Smart Suggestions on the right — they're based on your real activity.`
    }
    if (/(exam|test|revision|revise|marks|score)/.test(s)) {
      const ex = upcomingExams[0]
      return `Exam strategy 🎯\n\n• Active recall beats re-reading: make flashcards (Notes → Flashcards) and test yourself.\n• Space it: 3 short sessions beat 1 marathon.\n• Past papers under timed conditions in the final week.\n• Teach the topic to an imaginary student — gaps reveal themselves instantly.\n• Sleep 7–8h before the exam — memory consolidates during sleep.${ex ? `\n\nYour next exam is "${ex.title}" — start today with one 25-minute pomodoro on its weakest topic.` : ''}`
    }
    if (/(focus|concentrate|distract|procrastinat|lazy|phone)/.test(s)) {
      return `Focus fixes that actually work:\n\n1. Phone in another room — or set a FocusLion limit and I'll roar. 🦁\n2. Deep Focus mode (Focus page) — full-screen, no escape.\n3. The 2-minute rule: just start for 2 minutes; momentum does the rest.\n4. One task on screen, everything else closed.\n\nThis week: ${minutesToLabel(weekStudy)} studied vs ${minutesToLabel(weekSocial)} scrolled. You know what to do.`
    }
    if (/(motivat|tired|give up|can't|cant|hard|fail|hopeless)/.test(s)) {
      return `${firstName}, listen 🦁\n\nMotivation follows action — not the other way around. You don't need to feel ready, you need 15 minutes of starting.\n\nYou're on a ${profile?.study_streak ?? 0}-day streak with ${profile?.xp ?? 0} XP. That's proof you can do this.\n\n"${quote}" — ${author}\n\nNow: one pomodoro. Just one. Go. 💪`
    }
    if (/(sleep|rest|break|burnout|exhaust)/.test(s)) {
      return `Rest is part of studying — your brain files memories while you sleep. 🌙\n\n• 7–9 hours, consistent times (set the sleep reminder in Settings).\n• A 5-min break every 25–50 min.\n• One full off-day per week prevents burnout.\n\nStudying tired is like scrolling — it feels like work but nothing sticks.`
    }
    if (/(math|physics|chemistry|biology|science|english|history)/.test(s)) {
      return `Subject tactics 📚\n\n• Maths/Physics: problems > notes. Solve 5 problems, check, redo the wrong ones tomorrow.\n• Chemistry/Biology: flashcards for reactions/terms + draw diagrams from memory.\n• English/History: summarize each chapter in 5 bullet points, then explain it aloud.\n\nWhatever the subject — test yourself before the exam does. Track it with a subject name in your Focus sessions so I can see the balance.`
    }
    if (/(what should i study|what to study|what now|where to start)/.test(s)) {
      return `Based on your actual data:\n\n${recommendations.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nPick #1 and start a pomodoro on it right now. I'll be watching. 🦁`
    }
    if (/(report|parent report|share)/.test(s)) {
      return `Open the Report page (sidebar) — it builds an automatic weekly report card: study hours, tasks, screen time, grade, and my note. Copy it for WhatsApp or print it as PDF. Honest numbers, no editing possible. Parents love it. 👨‍👩‍👧`
    }
    if (/(hello|hi|hey|good morning|good evening)/.test(s)) {
      return `Hey ${firstName}! 🦁 Ready to make today count? Ask me about study plans, exam prep, focus, stress, or time management.`
    }
    return `Good question! My general rule:\n\nBreak it into the smallest possible next step, schedule it in the Planner, and protect the time with a focus session.\n\nFor specifics, try: "plan my week", "exam tips", "I'm stressed", "time management", "what should I study?" 🦁`
  }

  function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || typing) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      setMsgs((m) => [...m, { role: 'coach', text: coachReply(q) }])
    }, 700 + Math.min(800, q.length * 12))
  }

  function clearChat() {
    setMsgs([welcome])
  }

  const SUGGESTIONS = ['Plan my week', 'Exam tips', "I'm stressed", 'Time management', 'What should I study?', 'I need motivation']

  return (
    <Page title="Coach Leo" subtitle="Your personal study coach — planning, focus, stress and motivation.">
      <div className="grid gap-5 lg:grid-cols-3">
        {/* chat */}
        <GlassCard className="flex h-[34rem] flex-col lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              Leo is online
            </div>
            <button onClick={clearChat} className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500">
              <Trash2 size={13} /> Clear chat
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div className={
                  m.role === 'user'
                    ? 'max-w-[80%] rounded-3xl rounded-br-lg bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-sm text-white'
                    : 'max-w-[85%] whitespace-pre-line rounded-3xl rounded-bl-lg bg-white/60 dark:bg-white/10 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100'
                }>
                  {m.role === 'coach' && <span className="mr-1">🦁</span>}{m.text}
                </div>
              </motion.div>
            ))}
            {typing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg bg-white/60 dark:bg-white/10 px-4 py-3">
                  <span className="mr-1">🦁</span>
                  {[0, 1, 2].map((d) => (
                    <motion.span
                      key={d}
                      animate={{ y: [0, -4, 0] }}
                      transition={{ repeat: Infinity, duration: 0.7, delay: d * 0.15 }}
                      className="h-1.5 w-1.5 rounded-full bg-slate-400"
                    />
                  ))}
                </div>
              </motion.div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="rounded-full bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:bg-brand-500/20">
                {s}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input placeholder="Ask Leo anything…" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()} />
            <Button onClick={() => send()}><Send size={16} /></Button>
          </div>
        </GlassCard>

        {/* recommendations */}
        <div className="space-y-5">
          <GlassCard>
            <SectionTitle><span className="flex items-center gap-2"><Sparkles size={18} className="text-amber-500" /> Smart suggestions</span></SectionTitle>
            <div className="space-y-2.5">
              {recommendations.map((r, i) => (
                <motion.p key={i}
                  initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                  className="rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  {r}
                </motion.p>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="bg-gradient-to-br from-amber-400/15 to-orange-400/10">
            <div className="text-3xl">💬</div>
            <p className="mt-2 font-semibold italic text-slate-800 dark:text-slate-100">"{quoteOfTheDay()[0]}"</p>
            <p className="mt-1 text-xs text-slate-500">— {quoteOfTheDay()[1]}</p>
          </GlassCard>
        </div>
      </div>
    </Page>
  )
}
