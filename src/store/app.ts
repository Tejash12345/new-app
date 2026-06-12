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
}

const prefersDark =
  localStorage.getItem('fl-dark') === '1' ||
  (localStorage.getItem('fl-dark') === null &&
    window.matchMedia('(prefers-color-scheme: dark)').matches)

if (prefersDark) document.documentElement.classList.add('dark')

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
  activeScroll: null,
  startScroll: (s) => set({ activeScroll: s }),
  stopScroll: () => set({ activeScroll: null }),
  onlineIds: [],
  setOnlineIds: (ids) => set({ onlineIds: ids }),
}))
