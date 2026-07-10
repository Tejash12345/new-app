import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, CalendarDays, CheckCircle2, Timer, Shield,
  BarChart3, NotebookPen, Trophy, Bot, Settings, Moon, Sun, LogOut, Crown, FileText, MessageCircle, Users, Download, Clapperboard, Eye, Hourglass, GraduationCap, Briefcase, Rocket, BookOpen, Salad, Search, Swords, Sparkles, Camera,
} from 'lucide-react'
import { useApp } from '../store/app'
import { useAuth } from '../hooks/useAuth'
import { LionOverlay } from './LionOverlay'
import { ConfirmDialog } from './ConfirmDialog'
import { ScrollWatcher } from './ScrollWatcher'
import { CommandPalette } from './CommandPalette'
import { openSearch } from '../lib/search'
import { Onboarding } from './Onboarding'
import { PresenceTracker } from './PresenceTracker'
import { StoryRing, useStories } from './Stories'
import { LionAI } from './LionAI'
import { MascotImg } from './ui'
import { useNotificationEngine, useDMNotifications, useFriendRequestNotifications, requestNotifPermission } from '../hooks/useNotifications'
import { cn, levelForXp } from '../lib/utils'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/feed', label: 'Feed', icon: Clapperboard },
  { to: '/planner', label: 'Planner', icon: CalendarDays },
  { to: '/tasks', label: 'Tasks', icon: CheckCircle2 },
  { to: '/focus', label: 'Focus', icon: Timer },
  { to: '/wellbeing', label: 'Wellbeing', icon: Shield },
  { to: '/capsule', label: 'Future Me', icon: Hourglass },
  { to: '/learn', label: 'Learn', icon: GraduationCap },
  { to: '/quiz', label: 'Quiz', icon: Swords },
  { to: '/lens', label: 'Lens', icon: Camera },
  { to: '/vocab', label: 'Word', icon: BookOpen },
  { to: '/diet', label: 'Diet', icon: Salad },
  { to: '/career', label: 'Career', icon: Briefcase },
  { to: '/startup', label: 'Startup', icon: Rocket },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/insights', label: 'Insights', icon: Sparkles },
  { to: '/arena', label: 'Arena', icon: Trophy },
  { to: '/coach', label: 'Coach', icon: Bot },
  { to: '/chat', label: 'Messages', icon: MessageCircle },
  { to: '/community', label: 'Community', icon: Users },
  { to: '/friends', label: 'Friends', icon: Users },
  { to: '/report', label: 'Report', icon: FileText },
  { to: '/install', label: 'Get App', icon: Download },
]

export function Layout() {
  const { dark, toggleDark, chatUnread } = useApp()
  const { profile, signOut } = useAuth()
  // unread DMs across all senders → badge on every Messages entry point, so a
  // message that arrives while you're on any other page is visible in-app
  const unreadTotal = Object.values(chatUnread).reduce((a, b) => a + b, 0)
  const unreadLabel = unreadTotal > 9 ? '9+' : String(unreadTotal)
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  useNotificationEngine()
  // app-wide incoming-DM + friend-request notifications (fire on any page)
  useDMNotifications()
  useFriendRequestNotifications()
  // ask once so reminders (study, deadlines, time-almost-up) can actually fire
  useEffect(() => { requestNotifPermission() }, [])

  const level = levelForXp(profile?.xp ?? 0)
  const initial = (profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()
  // show the uploaded profile photo where we'd otherwise show the initial
  const avatarNode = profile?.avatar_url
    ? <img src={profile.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
    : initial
  // wrap a nav avatar so it shows a story ring (visual only — keeps its own tap)
  const withRing = (el: ReactNode) => <StoryRing userId={profile?.id} display>{el}</StoryRing>
  const { hasStory, openStory } = useStories()
  const iHaveStory = hasStory(profile?.id)

  return (
    <div className="aurora min-h-screen overflow-x-hidden">
      <ScrollWatcher />
      <LionOverlay />
      <ConfirmDialog />
      <CommandPalette />
      <Onboarding />
      <PresenceTracker />
      <LionAI />

      {/* ---- desktop sidebar ---- */}
      <aside className="fixed left-4 top-4 bottom-4 z-40 hidden w-60 flex-col lg:flex">
        <div className="glass flex h-full flex-col rounded-3xl p-4">
          <div className="mb-6 flex items-center gap-2.5 px-2 pt-1">
            <MascotImg className="h-9 w-auto" />
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
                    {to === '/chat' && unreadTotal > 0 && (
                      <span className="relative z-10 ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                        {unreadLabel}
                      </span>
                    )}
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
        {/* tighter paddings/gaps below sm — with the Messages button added, the
            p-2.5/gap-2 cluster overflowed a 360px screen and clipped the icons */}
        <div className="glass flex items-center justify-between gap-2 rounded-3xl px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <MascotImg className="h-8 w-auto shrink-0" />
            <span className="truncate font-extrabold text-slate-900 dark:text-white">FocusLion</span>
          </div>
          <div className="hidden lg:block text-sm font-medium text-slate-500 dark:text-slate-400">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
            {/* universal search — labelled pill on desktop, icon on mobile (the
                Android WebView has no ⌘K, so a tappable button is essential) */}
            <button
              onClick={openSearch}
              className="hidden items-center gap-2 rounded-full bg-slate-400/10 px-3.5 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-400/20 lg:flex dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <Search size={16} />
              <span>Search…</span>
              <kbd className="ml-3 rounded-md bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">⌘K</kbd>
            </button>
            <button
              onClick={openSearch}
              aria-label="Search"
              className="rounded-full p-2 text-slate-500 hover:bg-slate-500/10 sm:p-2.5 lg:hidden dark:text-slate-300"
            >
              <Search size={18} />
            </button>
            <button
              onClick={() => navigate('/chat')}
              aria-label={unreadTotal > 0 ? `Messages — ${unreadTotal} unread` : 'Messages'}
              className="relative rounded-full p-2 text-slate-500 hover:bg-slate-500/10 sm:p-2.5 dark:text-slate-300"
            >
              <MessageCircle size={18} />
              {unreadTotal > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                  {unreadLabel}
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-300">
              ⭐ {profile?.xp ?? 0} XP · Lv {level}
            </div>
            <button
              onClick={toggleDark}
              className="rounded-full p-2 text-slate-500 hover:bg-slate-500/10 sm:p-2.5 dark:text-slate-300"
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {/* profile menu */}
            <div className="relative">
              {withRing(
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white ring-2 ring-transparent transition hover:ring-brand-300"
                  aria-label="Profile menu"
                >
                  {avatarNode}
                </button>,
              )}

              <AnimatePresence>
                {menuOpen && (
                  <div className="hidden lg:block">
                    {/* tap-away backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ duration: 0.16 }}
                      className="glass-strong absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-3xl p-2"
                    >
                      {/* identity */}
                      <div className="flex items-center gap-3 rounded-2xl px-3 py-3">
                        {withRing(
                          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-base font-bold text-white">
                            {avatarNode}
                          </div>,
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-bold text-slate-900 dark:text-white">
                            {profile?.full_name || 'Student'}
                          </div>
                          <div className="truncate text-xs text-slate-500">{profile?.email}</div>
                        </div>
                      </div>

                      <div className="mx-3 my-1 flex items-center justify-between rounded-2xl bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-600 dark:text-amber-300">
                        <span>⭐ {profile?.xp ?? 0} XP</span>
                        <span>Level {level}</span>
                      </div>

                      <div className="my-1 h-px bg-slate-200/60 dark:bg-white/10" />

                      {iHaveStory && (
                        <button
                          onClick={() => { setMenuOpen(false); openStory(profile?.id) }}
                          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-brand-500 hover:bg-brand-500/10"
                        >
                          <Eye size={17} /> View your story
                        </button>
                      )}
                      <button
                        onClick={() => { setMenuOpen(false); navigate('/settings') }}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/10"
                      >
                        <Settings size={17} /> Settings
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); toggleDark() }}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/10"
                      >
                        {dark ? <Sun size={17} /> : <Moon size={17} />} {dark ? 'Light mode' : 'Dark mode'}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); signOut() }}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-rose-500 hover:bg-rose-500/10"
                      >
                        <LogOut size={17} /> Log out
                      </button>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* ---- content ---- */}
      {/* mobile bottom padding clears the bottom nav AND the floating lion
          button (bottom-28 + h-14 = 168px) plus any gesture-bar safe area */}
      <main className="min-w-0 overflow-x-hidden pb-[calc(11.5rem+env(safe-area-inset-bottom))] lg:pb-8 lg:pl-68" key={location.pathname}>
        <div className="min-w-0 lg:pl-4">
          <Outlet />
        </div>
      </main>

      {/* ---- mobile bottom nav ---- */}
      <nav className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 lg:hidden">
        {/* items are flex-1 min-w-0 so all six fit even on 320px screens */}
        <div className="glass-strong flex items-center justify-around rounded-3xl px-1 py-2 sm:px-2">
          {NAV.slice(0, 5).map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1">
              {({ isActive }) => (
                <>
                  <div className={cn(
                    'rounded-2xl p-2 transition-colors',
                    isActive ? 'bg-slate-400/20 dark:bg-white/15 text-slate-900 dark:text-white ring-1 ring-white/60 dark:ring-white/20' : 'text-slate-500 dark:text-slate-400',
                  )}>
                    <Icon size={19} />
                  </div>
                  <span className={cn('max-w-full truncate text-[9px] font-semibold', isActive ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button onClick={() => setMenuOpen(true)} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1">
            {withRing(
              <div className="flex h-[35px] w-[35px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
                {avatarNode}
              </div>,
            )}
            <span className="max-w-full truncate text-[9px] font-semibold text-slate-400">Profile</span>
          </button>
        </div>
      </nav>

      {/* ---- mobile profile sheet ---- */}
      <AnimatePresence>
        {menuOpen && (
          <div className="lg:hidden">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ y: 320 }} animate={{ y: 0 }} exit={{ y: 320 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="glass-strong fixed inset-x-3 bottom-3 z-[61] rounded-3xl p-4"
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
              <div className="flex items-center gap-3 px-2 py-2">
                {withRing(
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-lg font-bold text-white">
                    {avatarNode}
                  </div>,
                )}
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold text-slate-900 dark:text-white">{profile?.full_name || 'Student'}</div>
                  <div className="truncate text-xs text-slate-500">{profile?.email}</div>
                </div>
              </div>
              <div className="mx-2 my-2 flex items-center justify-between rounded-2xl bg-amber-400/15 px-4 py-2.5 text-sm font-bold text-amber-600 dark:text-amber-300">
                <span>⭐ {profile?.xp ?? 0} XP</span>
                <span>Level {level}</span>
              </div>

              {iHaveStory && (
                <button onClick={() => { setMenuOpen(false); openStory(profile?.id) }}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-brand-500 hover:bg-brand-500/10">
                  <Eye size={18} /> View your story
                </button>
              )}

              {/* all pages grid */}
              <div className="my-2 grid grid-cols-4 gap-1.5 px-1">
                {NAV.map(({ to, label, icon: Icon }) => (
                  <button key={to}
                    onClick={() => { setMenuOpen(false); navigate(to) }}
                    className={cn(
                      'relative flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[10px] font-semibold transition',
                      location.pathname === to
                        ? 'bg-gradient-to-br from-brand-500 to-purple-500 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-500/10',
                    )}>
                    <Icon size={18} />
                    {label}
                    {to === '/chat' && unreadTotal > 0 && (
                      <span className="absolute right-1.5 top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                        {unreadLabel}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mx-2 my-1 h-px bg-slate-200/60 dark:bg-white/10" />

              {profile?.role === 'admin' && (
                <button onClick={() => { setMenuOpen(false); navigate('/admin') }}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/10">
                  <Crown size={18} /> Admin
                </button>
              )}
              <button onClick={() => { setMenuOpen(false); navigate('/settings') }}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/10">
                <Settings size={18} /> Settings
              </button>
              <button onClick={() => { setMenuOpen(false); toggleDark() }}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/10">
                {dark ? <Sun size={18} /> : <Moon size={18} />} {dark ? 'Light mode' : 'Dark mode'}
              </button>
              <button onClick={() => { setMenuOpen(false); signOut() }}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-rose-500 hover:bg-rose-500/10">
                <LogOut size={18} /> Log out
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
