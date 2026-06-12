import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, CalendarDays, CheckCircle2, Timer, Shield,
  BarChart3, NotebookPen, Trophy, Bot, Settings, Moon, Sun, LogOut, Crown, FileText,
} from 'lucide-react'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { LionOverlay } from './LionOverlay'
import { ScrollWatcher } from './ScrollWatcher'
import { CommandPalette } from './CommandPalette'
import { Onboarding } from './Onboarding'
import { useNotificationEngine } from '../hooks/useNotifications'
import { cn, levelForXp } from '../lib/utils'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/planner', label: 'Planner', icon: CalendarDays },
  { to: '/tasks', label: 'Tasks', icon: CheckCircle2 },
  { to: '/focus', label: 'Focus', icon: Timer },
  { to: '/wellbeing', label: 'Wellbeing', icon: Shield },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/arena', label: 'Arena', icon: Trophy },
  { to: '/coach', label: 'Coach', icon: Bot },
  { to: '/report', label: 'Report', icon: FileText },
]

export function Layout() {
  const { dark, toggleDark } = useApp()
  const { profile, signOut } = useAuth()
  const location = useLocation()
  useNotificationEngine()

  const level = levelForXp(profile?.xp ?? 0)

  return (
    <div className="aurora min-h-screen">
      <ScrollWatcher />
      <LionOverlay />
      <CommandPalette />
      <Onboarding />

      {/* ---- desktop sidebar ---- */}
      <aside className="fixed left-4 top-4 bottom-4 z-40 hidden w-60 flex-col lg:flex">
        <div className="glass flex h-full flex-col rounded-3xl p-4">
          <div className="mb-6 flex items-center gap-2.5 px-2 pt-1">
            <span className="text-2xl">🦁</span>
            <div>
              <div className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white">FocusLion</div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Study · Focus · Roar</div>
            </div>
          </div>

          <nav className="flex-1 space-y-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {({ isActive }) => (
                  <div className={cn(
                    'relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-colors',
                    isActive
                      ? 'text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-gradient-to-r hover:from-brand-500/20 hover:to-purple-500/20 hover:text-brand-600 dark:hover:text-brand-300',
                  )}>
                    {isActive && (
                      <motion.div
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-brand-500 to-purple-500 shadow-lg shadow-brand-500/40"
                        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                      />
                    )}
                    <Icon size={18} className="relative z-10" />
                    <span className="relative z-10">{label}</span>
                  </div>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-4 space-y-1 border-t border-slate-200/50 dark:border-white/10 pt-3">
            <NavLink to="/settings">
              {({ isActive }) => (
                <div className={cn(
                  'flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold',
                  isActive ? 'bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg shadow-brand-500/40' : 'text-slate-600 dark:text-slate-300 hover:bg-gradient-to-r hover:from-brand-500/20 hover:to-purple-500/20 hover:text-brand-600 dark:hover:text-brand-300',
                )}>
                  <Settings size={18} /> Settings
                </div>
              )}
            </NavLink>
            {profile?.role === 'admin' && (
              <NavLink to="/admin">
                {({ isActive }) => (
                  <div className={cn(
                    'flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold',
                    isActive ? 'bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg shadow-brand-500/40' : 'text-slate-600 dark:text-slate-300 hover:bg-gradient-to-r hover:from-brand-500/20 hover:to-purple-500/20 hover:text-brand-600 dark:hover:text-brand-300',
                  )}>
                    <Crown size={18} /> Admin
                  </div>
                )}
              </NavLink>
            )}
            <button
              onClick={signOut}
              className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-rose-500/15 hover:text-rose-500"
            >
              <LogOut size={18} /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ---- topbar ---- */}
      <header className="sticky top-0 z-30 px-4 pt-4 lg:pl-72 sm:px-8 lg:pr-8">
        <div className="glass flex items-center justify-between rounded-3xl px-5 py-3">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="text-xl">🦁</span>
            <span className="font-extrabold text-slate-900 dark:text-white">FocusLion</span>
          </div>
          <div className="hidden lg:block text-sm font-medium text-slate-500 dark:text-slate-400">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-300">
              ⭐ {profile?.xp ?? 0} XP · Lv {level}
            </div>
            <button
              onClick={toggleDark}
              className="rounded-full p-2.5 text-slate-500 hover:bg-slate-500/10 dark:text-slate-300"
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white">
              {(profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* ---- content ---- */}
      <main className="pb-28 lg:pb-8 lg:pl-68" key={location.pathname}>
        <div className="lg:pl-4">
          <Outlet />
        </div>
      </main>

      {/* ---- mobile bottom nav ---- */}
      <nav className="fixed bottom-3 left-3 right-3 z-40 lg:hidden">
        <div className="glass-strong flex items-center justify-around rounded-3xl px-2 py-2">
          {NAV.slice(0, 5).map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className="flex flex-col items-center gap-0.5 px-2 py-1">
              {({ isActive }) => (
                <>
                  <div className={cn(
                    'rounded-2xl p-2 transition-colors',
                    isActive ? 'bg-slate-400/20 dark:bg-white/15 text-slate-900 dark:text-white ring-1 ring-white/60 dark:ring-white/20' : 'text-slate-500 dark:text-slate-400',
                  )}>
                    <Icon size={19} />
                  </div>
                  <span className={cn('text-[9px] font-semibold', isActive ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <NavLink to="/settings" className="flex flex-col items-center gap-0.5 px-2 py-1">
            {({ isActive }) => (
              <>
                <div className={cn('rounded-2xl p-2', isActive ? 'bg-slate-400/20 dark:bg-white/15 text-slate-900 dark:text-white ring-1 ring-white/60 dark:ring-white/20' : 'text-slate-500 dark:text-slate-400')}>
                  <Settings size={19} />
                </div>
                <span className="text-[9px] font-semibold text-slate-400">More</span>
              </>
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
