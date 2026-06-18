import { create } from 'zustand'

type LionState = {
  open: boolean
  appName: string
  reason: 'limit' | 'schedule'
  windowLabel?: string
}

type ActiveScroll = {
  appName: string
  startedAt: number // epoch ms
  limitMin: number
  usedTodayMin: number
  allowedUntilMin?: number // when schedule is on: session must end by this time
  windowLabel?: string
} | null

type AppState = {
  dark: boolean
  toggleDark: () => void
  lion: LionState
  showLion: (appName: string, reason?: 'limit' | 'schedule', windowLabel?: string) => void
  hideLion: () => void
  activeScroll: ActiveScroll
  startScroll: (s: NonNullable<ActiveScroll>) => void
  stopScroll: () => void
  onlineIds: string[]
  setOnlineIds: (ids: string[]) => void
  // the chat peer whose conversation is open in the foreground — the global DM
  // notifier skips notifying for this one (you're already looking at it)
  activeChatPeer: string | null
  setActiveChatPeer: (id: string | null) => void
}

const prefersDark =
  localStorage.getItem('fl-dark') === '1' ||
  (localStorage.getItem('fl-dark') === null &&
    window.matchMedia('(prefers-color-scheme: dark)').matches)

if (prefersDark) document.documentElement.classList.add('dark')

// A running scroll session is persisted so a page reload (or the WebView
// reloading on the native app) restores it instead of resetting the timer —
// elapsed time is derived from startedAt, so it keeps counting correctly.
const SCROLL_KEY = 'fl-active-scroll'
const MAX_SESSION_MS = 6 * 60 * 60 * 1000 // drop sessions left running >6h (e.g. across days)

function loadActiveScroll(): ActiveScroll {
  try {
    const raw = localStorage.getItem(SCROLL_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as NonNullable<ActiveScroll>
    if (!s || typeof s.startedAt !== 'number' || Date.now() - s.startedAt > MAX_SESSION_MS) {
      localStorage.removeItem(SCROLL_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}

export const useApp = create<AppState>((set) => ({
  dark: prefersDark,
  toggleDark: () =>
    set((s) => {
      const dark = !s.dark
      document.documentElement.classList.toggle('dark', dark)
      localStorage.setItem('fl-dark', dark ? '1' : '0')
      return { dark }
    }),
  lion: { open: false, appName: '', reason: 'limit' },
  showLion: (appName, reason = 'limit', windowLabel) =>
    set({ lion: { open: true, appName, reason, windowLabel } }),
  hideLion: () => set({ lion: { open: false, appName: '', reason: 'limit' } }),
  activeScroll: loadActiveScroll(),
  startScroll: (s) => {
    try { localStorage.setItem(SCROLL_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    set({ activeScroll: s })
  },
  stopScroll: () => {
    try { localStorage.removeItem(SCROLL_KEY) } catch { /* ignore */ }
    set({ activeScroll: null })
  },
  onlineIds: [],
  setOnlineIds: (ids) => set({ onlineIds: ids }),
  activeChatPeer: null,
  setActiveChatPeer: (id) => set({ activeChatPeer: id }),
}))
