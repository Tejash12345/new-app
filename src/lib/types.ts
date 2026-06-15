export type Profile = {
  id: string
  email: string | null
  full_name: string
  avatar_url: string
  role: 'student' | 'admin'
  xp: number
  study_streak: number
  last_study_date: string | null
  is_private: boolean
  settings: Settings
  created_at: string
}

export type Settings = {
  leaderboard?: boolean
  sound?: boolean
  notifications?: {
    study?: boolean
    deadlines?: boolean
    breaks?: boolean
    hydration?: boolean
    sleep?: boolean
  }
  sleepReminderHour?: number // 22 = 10pm
}

export type TaskKind = 'task' | 'assignment' | 'exam' | 'goal'

export type Task = {
  id: string
  user_id: string
  title: string
  notes: string
  kind: TaskKind
  subject: string
  priority: number
  due_at: string | null
  done: boolean
  progress: number
  created_at: string
}

export type TimetableBlock = {
  id: string
  user_id: string
  day_of_week: number
  start_min: number
  end_min: number
  title: string
  subject: string
  color: string
  created_at: string
}

export type StudySession = {
  id: string
  user_id: string
  started_at: string
  duration_min: number
  subject: string
  mode: 'pomodoro' | 'focus'
  created_at: string
}

export type Habit = {
  id: string
  user_id: string
  name: string
  emoji: string
  color: string
  checks: string[]
  created_at: string
}

export type Note = {
  id: string
  user_id: string
  title: string
  body: string
  color: number
  updated_at: string
  created_at: string
}

export type Flashcard = {
  id: string
  user_id: string
  deck: string
  front: string
  back: string
  ease: number
  created_at: string
}

export type JournalEntry = {
  id: string
  user_id: string
  entry_date: string
  mood: number
  body: string
  created_at: string
}

export type SocialLimit = {
  id: string
  user_id: string
  app_name: string
  daily_limit_min: number
  enabled: boolean
  schedule_enabled: boolean
  allowed_from_min: number   // minutes from midnight, e.g. 1080 = 6:00 PM
  allowed_until_min: number
  created_at: string
}

export type SocialSession = {
  id: string
  user_id: string
  app_name: string
  used_min: number
  used_on: string
  created_at: string
}

export type LeaderboardRow = {
  id: string
  full_name: string
  avatar_url: string
  xp: number
  study_streak: number
}

// ---------- Feed ----------
export type FeedType = 'post' | 'reel' | 'instagram' | 'linkedin'

/** Allowed feed categories — technology, biology and medical topics. */
export const FEED_CATEGORIES = [
  // technology
  'AI & ML',
  'Web Dev',
  'Mobile',
  'Cloud & DevOps',
  'Cybersecurity',
  'Data',
  'Programming',
  'Gadgets',
  'Blockchain',
  // biology
  'Biology',
  'Genetics',
  'Neuroscience',
  'Biotech',
  // medical
  'Medicine',
  'Healthcare',
  // misc
  'Startups',
] as const
export type FeedCategory = (typeof FEED_CATEGORIES)[number]

export type FeedPost = {
  id: string
  user_id: string
  author_name: string
  author_avatar_url: string
  type: FeedType
  category: FeedCategory
  title: string
  body: string
  media_url: string | null
  embed_url: string | null
  tags: string[]
  views: number
  repost_of?: string | null
  original_user_id?: string | null
  reposter_name?: string | null
  created_at: string
}

export type FeedComment = {
  id: string
  post_id: string
  user_id: string
  author_name: string
  author_avatar_url: string
  body: string
  created_at: string
}

// ---------- Future Me Capsule ----------
export type CapsuleGoal = { id: string; text: string; done: boolean }

export type CapsuleVisibility = 'private' | 'friends' | 'feed'

/** A snapshot of the user's stats, captured when a capsule is sealed and again
 *  when it opens, so the Growth Coach can compare past vs present. */
export type CapsuleSnapshot = {
  capturedAt: string
  xp: number
  streak: number
  tasksTotal: number
  tasksDone: number
  studyMin: number
  feedPosts: number
  habits: number
}

/** The Growth Coach report, computed once when a capsule unlocks. */
export type GrowthReport = {
  generatedAt: string
  days: number
  score: number          // current Lion Growth Score 0–100
  pastScore: number
  guardianLevel: number  // 1–5, the strength of the Lion Guardian
  goalsAchieved: number
  goalsTotal: number
  deltas: {
    xp: number
    streak: number
    studyMin: number
    tasksDone: number
    feedPosts: number
  }
  insights: string[]
}

export type Capsule = {
  id: string
  user_id: string
  author_name: string
  author_avatar_url: string
  title: string
  message: string
  goals: CapsuleGoal[]
  unlock_at: string
  visibility: CapsuleVisibility
  opened_at: string | null
  snapshot: CapsuleSnapshot
  growth: GrowthReport | null
  shared_post_id: string | null
  created_at: string
}

export type CapsuleMedia = {
  id: string
  capsule_id: string
  user_id: string
  kind: 'image' | 'video' | 'voice'
  url: string
  created_at: string
}

// ---------- Lion AI Assistant (Gemini) ----------
export type AiMessage = {
  id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  task: string
  created_at: string
}

export type AiMission = {
  id: string
  user_id: string
  mission_date: string
  title: string
  detail: string
  xp: number
  done: boolean
  created_at: string
}

export type AiUsage = {
  id: string
  user_id: string
  used_on: string
  calls: number
  last_task: string | null
  updated_at: string
}
