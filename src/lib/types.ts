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
