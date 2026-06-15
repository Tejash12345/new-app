import type {
  Capsule, CapsuleGoal, CapsuleSnapshot, GrowthReport, Habit, Profile, StudySession, Task,
} from './types'

// ----------------------------------------------------------------------------
// Future Me Capsule — the "AI Growth Coach" brain.
//
// This app's coach is a deterministic, data-driven engine (same approach as the
// Coach page): it captures a snapshot of your real activity when a capsule is
// sealed, then compares it to a fresh snapshot when the capsule opens to produce
// a growth report, a Lion Growth Score, and motivational insights.
// ----------------------------------------------------------------------------

/** Capture the user's current stats from their live data. */
export function captureSnapshot(data: {
  profile?: Profile | null
  tasks: Task[]
  sessions: StudySession[]
  habits: Habit[]
  feedPosts: { id: string }[]
}): CapsuleSnapshot {
  const studyMin = data.sessions.reduce((a, s) => a + (s.duration_min || 0), 0)
  return {
    capturedAt: new Date().toISOString(),
    xp: data.profile?.xp ?? 0,
    streak: data.profile?.study_streak ?? 0,
    tasksTotal: data.tasks.length,
    tasksDone: data.tasks.filter((t) => t.done).length,
    studyMin,
    feedPosts: data.feedPosts.length,
    habits: data.habits.length,
  }
}

/**
 * Lion Growth Score (0–100) from a snapshot. Four pillars per the spec:
 * learning activity, community engagement, goal completion, consistency.
 * goalsRatio (0–1) is optional and lifts the score when goals are completed.
 */
export function lionGrowthScore(s: CapsuleSnapshot, goalsRatio?: number): number {
  const learning = Math.min(40, s.studyMin / 30)        // ~20h study = full marks
  const community = Math.min(15, s.feedPosts * 3)        // 5 posts = full marks
  const consistency = Math.min(20, s.streak * 1.5)       // ~13-day streak = full marks
  const goals = Math.min(15, (goalsRatio ?? 0) * 15)     // all goals done = full marks
  const tasks = Math.min(10, s.tasksDone * 1)            // 10 tasks done = full marks
  return Math.round(Math.min(100, learning + community + consistency + goals + tasks))
}

export const GUARDIAN_STAGES = [
  { level: 1, name: 'Cub Guardian', emoji: '🐱', aura: '#94a3b8', blurb: 'A sleepy cub watches over your capsule.' },
  { level: 2, name: 'Young Lion', emoji: '🦁', aura: '#fbbf24', blurb: 'Your lion is waking up — keep going.' },
  { level: 3, name: 'Brave Lion', emoji: '🦁', aura: '#f59e0b', blurb: 'A brave lion guards your future self.' },
  { level: 4, name: 'Golden Lion', emoji: '🦁', aura: '#f97316', blurb: 'A golden mane — your discipline shows.' },
  { level: 5, name: 'Lion King', emoji: '👑', aura: '#facc15', blurb: 'The Lion King protects your legacy. 🦁' },
] as const

export function guardianLevelForScore(score: number): number {
  if (score >= 80) return 5
  if (score >= 60) return 4
  if (score >= 40) return 3
  if (score >= 20) return 2
  return 1
}

export function guardianStage(score: number) {
  return GUARDIAN_STAGES[guardianLevelForScore(score) - 1]
}

/** Build the growth report when a capsule unlocks: past snapshot vs now. */
export function buildGrowthReport(capsule: Capsule, now: CapsuleSnapshot): GrowthReport {
  const past: CapsuleSnapshot = {
    capturedAt: capsule.snapshot?.capturedAt ?? capsule.created_at,
    xp: capsule.snapshot?.xp ?? 0,
    streak: capsule.snapshot?.streak ?? 0,
    tasksTotal: capsule.snapshot?.tasksTotal ?? 0,
    tasksDone: capsule.snapshot?.tasksDone ?? 0,
    studyMin: capsule.snapshot?.studyMin ?? 0,
    feedPosts: capsule.snapshot?.feedPosts ?? 0,
    habits: capsule.snapshot?.habits ?? 0,
  }
  const goals: CapsuleGoal[] = Array.isArray(capsule.goals) ? capsule.goals : []
  const goalsTotal = goals.length
  const goalsAchieved = goals.filter((g) => g.done).length
  const goalsRatio = goalsTotal ? goalsAchieved / goalsTotal : undefined

  const deltas = {
    xp: now.xp - past.xp,
    streak: now.streak - past.streak,
    studyMin: now.studyMin - past.studyMin,
    tasksDone: now.tasksDone - past.tasksDone,
    feedPosts: now.feedPosts - past.feedPosts,
  }
  const days = Math.max(
    0,
    Math.round((Date.parse(now.capturedAt) - Date.parse(past.capturedAt)) / 86_400_000),
  )

  const score = lionGrowthScore(now, goalsRatio)
  const pastScore = lionGrowthScore(past)

  const insights = buildInsights({ deltas, days, goalsAchieved, goalsTotal, score, pastScore })

  return {
    generatedAt: new Date().toISOString(),
    days,
    score,
    pastScore,
    guardianLevel: guardianLevelForScore(score),
    goalsAchieved,
    goalsTotal,
    deltas,
    insights,
  }
}

function buildInsights(d: {
  deltas: GrowthReport['deltas']
  days: number
  goalsAchieved: number
  goalsTotal: number
  score: number
  pastScore: number
}): string[] {
  const out: string[] = []
  const hours = Math.round(d.deltas.studyMin / 6) / 10 // 1 decimal place

  if (d.goalsTotal > 0) {
    if (d.goalsAchieved === d.goalsTotal) {
      out.push(`🏆 You kept every promise — ${d.goalsAchieved}/${d.goalsTotal} goals achieved. Future you is proud.`)
    } else if (d.goalsAchieved > 0) {
      out.push(`🎯 You completed ${d.goalsAchieved} of ${d.goalsTotal} goals. The other ${d.goalsTotal - d.goalsAchieved} are still waiting — carry them into your next capsule.`)
    } else {
      out.push(`🌱 None of your ${d.goalsTotal} goals got ticked off yet. That's data, not failure — pick the easiest one and start today.`)
    }
  }

  if (d.deltas.studyMin > 0) {
    out.push(`📚 You studied ${hours}h more since you sealed this — roughly ${Math.round(d.deltas.studyMin / Math.max(1, d.days))} min a day. That's how futures get built.`)
  } else {
    out.push(`📚 No new focus time was logged in this window. A single 25-minute pomodoro tomorrow restarts the momentum.`)
  }

  if (d.deltas.streak > 0) out.push(`🔥 Your study streak grew by ${d.deltas.streak} day(s). Consistency is the quiet superpower.`)
  if (d.deltas.tasksDone > 0) out.push(`✅ You finished ${d.deltas.tasksDone} more task(s) than the day you wrote this.`)
  if (d.deltas.feedPosts > 0) out.push(`🤝 You contributed ${d.deltas.feedPosts} post(s) to the community — sharing is growth too.`)
  if (d.deltas.xp > 0) out.push(`⭐ +${d.deltas.xp} XP earned along the way.`)

  const scoreDelta = d.score - d.pastScore
  if (scoreDelta > 0) out.push(`📈 Your Lion Growth Score climbed from ${d.pastScore} to ${d.score}. Keep feeding the lion.`)
  else if (scoreDelta < 0) out.push(`📉 Your score dipped from ${d.pastScore} to ${d.score}. Future you is rooting for a comeback — one small win at a time.`)
  else out.push(`➖ Your score held steady at ${d.score}. Steady is underrated — now nudge it upward.`)

  return out
}

// ---- unlock-date presets ----
export const UNLOCK_PRESETS: { key: string; label: string; months?: number }[] = [
  { key: '1m', label: '1 month', months: 1 },
  { key: '3m', label: '3 months', months: 3 },
  { key: '6m', label: '6 months', months: 6 },
  { key: '1y', label: '1 year', months: 12 },
  { key: 'custom', label: 'Custom date' },
]

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

/** Human countdown to a future ISO date, e.g. "3 months", "12 days", "5h". */
export function countdownLabel(iso: string): string {
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return 'ready to open'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 60) return `${Math.round(days / 30)} months`
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h`
  const mins = Math.max(1, Math.floor(ms / 60_000))
  return `${mins}m`
}

export function isUnlockable(c: Capsule): boolean {
  return !c.opened_at && Date.parse(c.unlock_at) <= Date.now()
}

export function isSealed(c: Capsule): boolean {
  return !c.opened_at && Date.parse(c.unlock_at) > Date.now()
}
