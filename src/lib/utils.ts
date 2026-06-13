export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function minutesToLabel(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function timeLabel(startMin: number) {
  const h = Math.floor(startMin / 60)
  const m = startMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`
}

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ---- gamification ----
export function levelForXp(xp: number) {
  return Math.floor(Math.sqrt(xp / 50)) + 1
}
export function xpForLevel(level: number) {
  return (level - 1) * (level - 1) * 50
}
export function levelProgress(xp: number) {
  const lvl = levelForXp(xp)
  const cur = xpForLevel(lvl)
  const next = xpForLevel(lvl + 1)
  return (xp - cur) / Math.max(1, next - cur)
}

export const LEVEL_TITLES = [
  'Cub', 'Explorer', 'Apprentice', 'Scholar', 'Achiever',
  'Strategist', 'Master', 'Sage', 'Champion', 'Lion King',
]
export function levelTitle(level: number) {
  return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, level - 1)]
}

export const QUOTES = [
  ['Success is the sum of small efforts repeated day in and day out.', 'Robert Collier'],
  ['The future depends on what you do today.', 'Mahatma Gandhi'],
  ["Don't watch the clock; do what it does. Keep going.", 'Sam Levenson'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['The expert in anything was once a beginner.', 'Helen Hayes'],
  ['Discipline is choosing between what you want now and what you want most.', 'Abraham Lincoln'],
  ['Study while others are sleeping; work while others are loafing.', 'William A. Ward'],
  ['Your limitation — it is only your imagination.', 'Unknown'],
  ['Small progress is still progress.', 'Unknown'],
  ['Focus on being productive instead of busy.', 'Tim Ferriss'],
  ['A year from now you may wish you had started today.', 'Karen Lamb'],
  ['Push yourself, because no one else is going to do it for you.', 'Unknown'],
  ['Dream big. Start small. Act now.', 'Robin Sharma'],
  ['You don’t have to be great to start, but you have to start to be great.', 'Zig Ziglar'],
] as const

export function quoteOfTheDay() {
  const day = Math.floor(Date.now() / 86_400_000)
  return QUOTES[day % QUOTES.length]
}

export const SOCIAL_APPS = [
  { name: 'Instagram', emoji: '📸', color: '#E1306C' },
  { name: 'YouTube', emoji: '▶️', color: '#FF0000' },
  { name: 'Facebook', emoji: '👥', color: '#1877F2' },
  { name: 'X (Twitter)', emoji: '🐦', color: '#1DA1F2' },
  { name: 'TikTok', emoji: '🎵', color: '#00F2EA' },
  { name: 'Snapchat', emoji: '👻', color: '#FFFC00' },
  { name: 'Other', emoji: '📱', color: '#8E8E93' },
] as const

export const SUBJECT_COLORS = [
  '#6C8CFF', '#FF6584', '#00BFA6', '#FFB454', '#A76CFF', '#42C7F5',
]
