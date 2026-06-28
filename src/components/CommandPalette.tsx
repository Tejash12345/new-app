import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, CalendarDays, CheckCircle2, Timer, Shield, NotebookPen,
  BarChart3, Trophy, Bot, FileText, Settings, Search, CornerDownLeft,
  Clapperboard, Hourglass, GraduationCap, BookOpen, Salad, Briefcase, Rocket,
  MessageCircle, Users, Download, Moon, Sun, LogOut, Crown, ArrowRight, Clock,
} from 'lucide-react'
import { useTable } from '../hooks/db'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { SEARCH_EVENT } from '../lib/search'
import type { Note, Task } from '../lib/types'
import { cn } from '../lib/utils'

// ----------------------------------------------------------------------------
// FocusLion universal search ("Spotlight"). Opens with Ctrl/⌘+K, the "/" key,
// or the on-screen search button (which fires the `focuslion:open-search`
// window event — the only entry point that works in the Android WebView, where
// there is no keyboard shortcut). Fuzzy-ranks pages, quick actions, the user's
// tasks & notes, and people (other students) and jumps straight to the result.
// ----------------------------------------------------------------------------

type Cat = 'recent' | 'page' | 'action' | 'task' | 'note' | 'person'

type Item = {
  id: string
  label: string
  sub?: string          // secondary line / hint
  cat: Cat
  icon: React.ReactNode
  keywords?: string[]   // synonyms so "pomodoro" finds Focus, etc.
  score?: number
  action: () => void
}

const CAT_LABEL: Record<Cat, string> = {
  recent: 'Recent', page: 'Pages', action: 'Quick actions',
  task: 'Your tasks', note: 'Your notes', person: 'People',
}
const CAT_ORDER: Cat[] = ['recent', 'action', 'page', 'task', 'note', 'person']
const CAT_CAP: Record<Cat, number> = { recent: 6, page: 9, action: 6, task: 6, note: 5, person: 8 }

const RECENT_KEY = 'fl:search:recent'
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
function pushRecent(path: string) {
  const next = [path, ...loadRecent().filter((p) => p !== path)].slice(0, 6)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

// --- fuzzy scoring: higher = better, 0 = no match ---
function scoreText(q: string, textRaw: string): number {
  if (!q) return 0
  const text = textRaw.toLowerCase()
  if (text === q) return 1000
  if (text.startsWith(q)) return 850
  const words = text.split(/[\s&·,/+()-]+/).filter(Boolean)
  if (words.some((w) => w.startsWith(q))) return 680
  const idx = text.indexOf(q)
  if (idx >= 0) return 520 - Math.min(120, idx) // earlier hit ranks higher
  // subsequence fuzzy match (e.g. "wlbn" -> "wellbeing")
  let cursor = 0, gaps = 0, last = -1
  for (const ch of q) {
    const found = text.indexOf(ch, cursor)
    if (found < 0) return 0
    if (last >= 0) gaps += found - last - 1
    last = found
    cursor = found + 1
  }
  return Math.max(40, 220 - gaps * 6)
}
function scoreItem(q: string, label: string, keywords?: string[]): number {
  const base = scoreText(q, label)
  const kw = (keywords ?? []).reduce((m, k) => Math.max(m, scoreText(q, k) * 0.72), 0)
  return Math.max(base, kw)
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-brand-600 dark:text-brand-300">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

type PageDef = { to: string; label: string; icon: React.ReactNode; keywords: string[] }

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [people, setPeople] = useState<Item[]>([])
  const [searchingPeople, setSearchingPeople] = useState(false)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { dark, toggleDark } = useApp()
  const { profile, signOut } = useAuth()
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: notes } = useTable<Note>('notes')

  const close = () => setOpen(false)
  const go = (path: string) => { pushRecent(path); setOpen(false); navigate(path) }

  // ---- open/close triggers: ⌘K, "/", on-screen button event, Esc ----
  useEffect(() => {
    const openNow = () => { setOpen(true); setQuery(''); setActive(0) }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpen((o) => !o); setQuery(''); setActive(0); return
      }
      if (e.key === 'Escape') { setOpen(false); return }
      // "/" opens search when not already typing somewhere
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        if (!typing) { e.preventDefault(); openNow() }
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(SEARCH_EVENT, openNow as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(SEARCH_EVENT, openNow as EventListener)
    }
  }, [])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60) }, [open])
  // active row is reset to 0 wherever `query` is set (typing / clear / open)

  const pages = useMemo<PageDef[]>(() => {
    const list: PageDef[] = [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={17} />, keywords: ['home', 'overview', 'today', 'start'] },
      { to: '/feed', label: 'Feed', icon: <Clapperboard size={17} />, keywords: ['posts', 'reels', 'social', 'explore', 'instagram', 'linkedin', 'stories'] },
      { to: '/planner', label: 'Planner', icon: <CalendarDays size={17} />, keywords: ['timetable', 'schedule', 'calendar', 'classes', 'blocks', 'routine'] },
      { to: '/tasks', label: 'Tasks & Goals', icon: <CheckCircle2 size={17} />, keywords: ['todo', 'to-do', 'assignment', 'exam', 'homework', 'goal', 'deadline', 'due'] },
      { to: '/focus', label: 'Focus', icon: <Timer size={17} />, keywords: ['pomodoro', 'study session', 'timer', 'deep work', 'concentrate'] },
      { to: '/wellbeing', label: 'Digital Wellbeing', icon: <Shield size={17} />, keywords: ['screen time', 'app limit', 'app blocker', 'social', 'guard', 'detox', 'instagram limit'] },
      { to: '/capsule', label: 'Future Me', icon: <Hourglass size={17} />, keywords: ['time capsule', 'future', 'letter', 'growth', 'goals'] },
      { to: '/learn', label: 'Learn', icon: <GraduationCap size={17} />, keywords: ['roadmap', 'learning path', 'course', 'study plan', 'skills', 'topic'] },
      { to: '/vocab', label: 'Word of the Day', icon: <BookOpen size={17} />, keywords: ['vocabulary', 'english', 'word', 'dictionary', 'meaning'] },
      { to: '/diet', label: 'Diet', icon: <Salad size={17} />, keywords: ['meal', 'food', 'nutrition', 'calories', 'protein', 'recipe', 'indian', 'plan'] },
      { to: '/career', label: 'Career Coach', icon: <Briefcase size={17} />, keywords: ['job', 'resume', 'cv', 'interview', 'readiness', 'role'] },
      { to: '/startup', label: 'Startup Co-Founder', icon: <Rocket size={17} />, keywords: ['business', 'idea', 'plan', 'founder', 'mvp', 'pitch'] },
      { to: '/notes', label: 'Notes & Flashcards', icon: <NotebookPen size={17} />, keywords: ['note', 'flashcard', 'memo', 'revision', 'write'] },
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={17} />, keywords: ['stats', 'charts', 'progress', 'insights', 'reports', 'graphs'] },
      { to: '/arena', label: 'Arena', icon: <Trophy size={17} />, keywords: ['xp', 'badges', 'leaderboard', 'rank', 'level', 'streak', 'points'] },
      { to: '/coach', label: 'Coach Leo (AI)', icon: <Bot size={17} />, keywords: ['ai', 'assistant', 'chat', 'help', 'lion ai', 'ask', 'leo'] },
      { to: '/chat', label: 'Messages', icon: <MessageCircle size={17} />, keywords: ['dm', 'direct message', 'chat', 'inbox', 'texts'] },
      { to: '/community', label: 'Community', icon: <Users size={17} />, keywords: ['rooms', 'group', 'public chat', 'people'] },
      { to: '/friends', label: 'Friends', icon: <Users size={17} />, keywords: ['followers', 'add friend', 'requests', 'find students', 'connections'] },
      { to: '/report', label: 'Parent Report', icon: <FileText size={17} />, keywords: ['parent', 'summary', 'progress report', 'share'] },
      { to: '/install', label: 'Get App', icon: <Download size={17} />, keywords: ['download', 'apk', 'android', 'pwa', 'install'] },
      { to: '/settings', label: 'Settings', icon: <Settings size={17} />, keywords: ['preferences', 'account', 'privacy', 'theme', 'profile', 'private'] },
    ]
    if (profile?.role === 'admin') list.push({ to: '/admin', label: 'Admin', icon: <Crown size={17} />, keywords: ['announcements', 'users', 'manage'] })
    return list
  }, [profile?.role])

  // ---- debounced people search (other students) ----
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) { setPeople([]); setSearchingPeople(false); return }
    setSearchingPeople(true)
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_users', { q })
      const rows = (data as { id: string; full_name: string; email: string; avatar_url?: string }[]) ?? []
      setPeople(rows.slice(0, 8).map((r) => {
        const name = (r.full_name || '').trim() || (r.email || '').split('@')[0] || 'Student'
        return {
          id: `person-${r.id}`,
          label: name,
          sub: 'Open chat',
          cat: 'person' as const,
          score: 600,
          icon: r.avatar_url
            ? <img src={r.avatar_url} alt="" className="h-[26px] w-[26px] rounded-full object-cover" />
            : <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[11px] font-bold text-white">{name.slice(0, 1).toUpperCase()}</span>,
          action: () => go(`/chat?dm=${r.id}&n=${encodeURIComponent(name)}`),
        }
      }))
      setSearchingPeople(false)
    }, 240)
    return () => clearTimeout(t)
  }, [query, open])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()

    const actionDefs: Item[] = [
      { id: 'a-focus', cat: 'action', label: 'Start a Focus session', sub: 'Pomodoro / deep work', icon: <Timer size={17} />, keywords: ['pomodoro', 'timer', 'study now', 'concentrate'], action: () => go('/focus') },
      { id: 'a-task', cat: 'action', label: 'Add a task', sub: 'Tasks & Goals', icon: <CheckCircle2 size={17} />, keywords: ['new task', 'create', 'todo', 'assignment'], action: () => go('/tasks') },
      { id: 'a-note', cat: 'action', label: 'New note', sub: 'Notes & Flashcards', icon: <NotebookPen size={17} />, keywords: ['create note', 'write', 'memo'], action: () => go('/notes') },
      { id: 'a-coach', cat: 'action', label: 'Ask Coach Leo', sub: 'AI assistant', icon: <Bot size={17} />, keywords: ['ai', 'question', 'help', 'leo'], action: () => go('/coach') },
      { id: 'a-theme', cat: 'action', label: dark ? 'Switch to light mode' : 'Switch to dark mode', sub: 'Appearance', icon: dark ? <Sun size={17} /> : <Moon size={17} />, keywords: ['theme', 'dark', 'light', 'appearance', 'mode'], action: () => { toggleDark() } },
      { id: 'a-signout', cat: 'action', label: 'Sign out', sub: 'Log out of FocusLion', icon: <LogOut size={17} />, keywords: ['log out', 'logout', 'exit', 'quit'], action: () => { setOpen(false); signOut() } },
    ]

    // empty query → recent pages + a few quick actions
    if (!q) {
      const recents: Item[] = loadRecent()
        .map((path) => pages.find((p) => p.to === path))
        .filter((p): p is PageDef => !!p)
        .map((p) => ({ id: `recent-${p.to}`, cat: 'recent' as const, label: p.label, sub: 'Recent', icon: p.icon, action: () => go(p.to) }))
      const suggestedActions = actionDefs.filter((a) => a.id !== 'a-signout')
      const suggestedPages = pages.slice(0, 6).map<Item>((p) => ({ id: `page-${p.to}`, cat: 'page', label: p.label, icon: p.icon, action: () => go(p.to) }))
      return [...recents, ...suggestedActions, ...suggestedPages]
    }

    const scored: Item[] = []
    for (const p of pages) {
      const s = scoreItem(q, p.label, p.keywords)
      if (s > 0) scored.push({ id: `page-${p.to}`, cat: 'page', label: p.label, icon: p.icon, score: s, action: () => go(p.to) })
    }
    for (const a of actionDefs) {
      const s = scoreItem(q, a.label, a.keywords)
      if (s > 0) scored.push({ ...a, score: s })
    }
    if (q.length >= 2) {
      for (const t of tasks) {
        const s = scoreItem(q, t.title, [t.subject, t.kind])
        if (s > 0) scored.push({
          id: `task-${t.id}`, cat: 'task', label: t.title || '(untitled task)',
          sub: t.done ? 'Done' : `${t.kind}${t.subject ? ' · ' + t.subject : ''}`,
          icon: <CheckCircle2 size={17} className={t.done ? 'text-emerald-500' : ''} />, score: s, action: () => go('/tasks'),
        })
      }
      for (const n of notes) {
        const s = scoreItem(q, `${n.title} ${n.body}`)
        if (s > 0) scored.push({
          id: `note-${n.id}`, cat: 'note', label: n.title || '(untitled note)',
          sub: n.body ? n.body.slice(0, 48) : 'Note', icon: <NotebookPen size={17} />, score: s, action: () => go('/notes'),
        })
      }
    }
    scored.push(...people)

    // group → cap → flatten in a stable, predictable order
    const out: Item[] = []
    for (const cat of CAT_ORDER) {
      const group = scored.filter((i) => i.cat === cat).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, CAT_CAP[cat])
      out.push(...group)
    }
    return out
  }, [query, tasks, notes, people, pages, dark]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the active row scrolled into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].action() }
  }

  const q = query.trim()
  // where each group's header should render (first index of each category)
  const headerAt = new Map<number, Cat>()
  let prev: Cat | null = null
  items.forEach((it, i) => { if (it.cat !== prev) { headerAt.set(i, it.cat); prev = it.cat } })

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 p-3 pt-[10vh] backdrop-blur-sm sm:p-4 sm:pt-[12vh]"
          onClick={close}
        >
          <motion.div
            initial={{ scale: 0.97, y: -12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: -12, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="glass-strong flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* search input */}
            <div className="flex items-center gap-3 border-b border-slate-200/50 px-5 py-3.5 dark:border-white/10">
              <Search size={18} className="shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                onKeyDown={onKeyDown}
                placeholder="Search pages, tasks, notes, people…"
                className="flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-white sm:text-sm"
                autoComplete="off" autoCorrect="off" spellCheck={false}
              />
              {query && (
                <button onClick={() => { setQuery(''); setActive(0); inputRef.current?.focus() }} className="text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Clear</button>
              )}
              <kbd className="hidden rounded-md bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 sm:inline">ESC</kbd>
            </div>

            {/* results */}
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
              {items.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-300">No results for “{q}”</p>
                  {searchingPeople && <p className="mt-1 text-xs text-slate-400">Searching people…</p>}
                </div>
              )}
              {items.map((item, i) => (
                <div key={item.id}>
                  {headerAt.has(i) && (
                    <div className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {item.cat === 'recent' && <Clock size={11} />}
                      {CAT_LABEL[headerAt.get(i)!]}
                    </div>
                  )}
                  <button
                    data-idx={i}
                    onClick={item.action}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left',
                      i === active ? 'bg-brand-500/15' : 'hover:bg-slate-500/5',
                    )}
                  >
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center', i === active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400')}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm font-semibold', i === active ? 'text-brand-700 dark:text-brand-200' : 'text-slate-800 dark:text-slate-100')}>
                        <Highlight text={item.label} q={q} />
                      </span>
                      {item.sub && <span className="block truncate text-xs text-slate-400">{item.sub}</span>}
                    </span>
                    {item.cat === 'person'
                      ? <ArrowRight size={14} className="shrink-0 text-slate-300" />
                      : <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-300 dark:text-slate-500">{item.cat === 'recent' ? 'page' : item.cat}</span>}
                    {i === active && <CornerDownLeft size={13} className="hidden shrink-0 text-slate-400 sm:block" />}
                  </button>
                </div>
              ))}
            </div>

            {/* footer hint (desktop) */}
            <div className="hidden items-center justify-between border-t border-slate-200/50 px-4 py-2 text-[10px] text-slate-400 dark:border-white/10 sm:flex">
              <span className="flex items-center gap-3">
                <span><kbd className="font-sans font-bold">↑↓</kbd> navigate</span>
                <span><kbd className="font-sans font-bold">↵</kbd> open</span>
                <span><kbd className="font-sans font-bold">esc</kbd> close</span>
              </span>
              <span>{items.length} result{items.length === 1 ? '' : 's'}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
