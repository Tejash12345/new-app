import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, CalendarDays, CheckCircle2, Timer, Shield, NotebookPen,
  BarChart3, Trophy, Bot, FileText, Settings, Search, CornerDownLeft,
} from 'lucide-react'
import { useTable } from '../hooks/db'
import type { Note, Task } from '../lib/types'
import { cn } from '../lib/utils'

type Item = {
  id: string
  label: string
  hint: string
  icon: React.ReactNode
  action: () => void
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: notes } = useTable<Note>('notes')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setActive(0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { id: 'p-dash', label: 'Dashboard', hint: 'Page', icon: <LayoutDashboard size={16} />, action: () => go('/') },
      { id: 'p-plan', label: 'Planner', hint: 'Page', icon: <CalendarDays size={16} />, action: () => go('/planner') },
      { id: 'p-tasks', label: 'Tasks & Goals', hint: 'Page', icon: <CheckCircle2 size={16} />, action: () => go('/tasks') },
      { id: 'p-focus', label: 'Start a Focus session', hint: 'Action', icon: <Timer size={16} />, action: () => go('/focus') },
      { id: 'p-well', label: 'Digital Wellbeing', hint: 'Page', icon: <Shield size={16} />, action: () => go('/wellbeing') },
      { id: 'p-notes', label: 'Notes & Flashcards', hint: 'Page', icon: <NotebookPen size={16} />, action: () => go('/notes') },
      { id: 'p-ana', label: 'Analytics', hint: 'Page', icon: <BarChart3 size={16} />, action: () => go('/analytics') },
      { id: 'p-arena', label: 'Arena — XP & badges', hint: 'Page', icon: <Trophy size={16} />, action: () => go('/arena') },
      { id: 'p-coach', label: 'Ask Coach Leo', hint: 'Page', icon: <Bot size={16} />, action: () => go('/coach') },
      { id: 'p-report', label: 'Parent Report', hint: 'Page', icon: <FileText size={16} />, action: () => go('/report') },
      { id: 'p-set', label: 'Settings', hint: 'Page', icon: <Settings size={16} />, action: () => go('/settings') },
    ]
    const q = query.trim().toLowerCase()
    const taskItems: Item[] = q.length < 2 ? [] : tasks
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 5)
      .map((t) => ({
        id: `t-${t.id}`,
        label: t.title,
        hint: t.done ? 'Task · done' : `Task · ${t.kind}`,
        icon: <CheckCircle2 size={16} />,
        action: () => go('/tasks'),
      }))
    const noteItems: Item[] = q.length < 2 ? [] : notes
      .filter((n) => (n.title + ' ' + n.body).toLowerCase().includes(q))
      .slice(0, 4)
      .map((n) => ({
        id: `n-${n.id}`,
        label: n.title || '(untitled note)',
        hint: 'Note',
        icon: <NotebookPen size={16} />,
        action: () => go('/notes'),
      }))
    const filteredPages = q
      ? pages.filter((p) => p.label.toLowerCase().includes(q))
      : pages
    return [...filteredPages, ...taskItems, ...noteItems]
  }, [query, tasks, notes])

  useEffect(() => setActive(0), [query])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    if (e.key === 'Enter' && items[active]) items[active].action()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 p-4 pt-[14vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.97, y: -12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: -12, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="glass-strong w-full max-w-lg overflow-hidden rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 px-5 py-3.5">
              <Search size={18} className="text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search pages, tasks, notes…"
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400"
              />
              <kbd className="rounded-md bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">ESC</kbd>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {items.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">No results for "{query}"</p>
              )}
              {items.map((item, i) => (
                <button
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm',
                    i === active ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200' : 'text-slate-700 dark:text-slate-200',
                  )}
                >
                  <span className={cn(i === active ? 'text-brand-500' : 'text-slate-400')}>{item.icon}</span>
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.hint}</span>
                  {i === active && <CornerDownLeft size={13} className="text-slate-400" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
