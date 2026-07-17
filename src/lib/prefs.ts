/**
 * User preferences — a tiny reactive, localStorage-backed store.
 *
 * Every value is a real, user-facing option toggled from Settings and read
 * anywhere via usePref(). No backend, no migration — instant + offline-safe.
 * Web-only, so it reaches the Android WebView with the normal deploy.
 */
import { useSyncExternalStore } from 'react'

export type Prefs = {
  // appearance
  chatTextSize: 'sm' | 'md' | 'lg' | 'xl'
  density: 'cozy' | 'compact'
  bubbleCorners: 'round' | 'sharp'
  wallpaperDim: number // 0 – 0.6, darkens the chat wallpaper for readability
  bigEmoji: boolean // emoji-only messages render large
  showAvatars: boolean // show the friend's avatar next to each received bubble
  // behaviour
  enterToSend: boolean
  clock24: boolean
  autoScroll: boolean // jump to newest on incoming message
  confirmDelete: boolean
  // privacy
  readReceipts: boolean // send read ✓✓ to the other side
  sendTyping: boolean // broadcast "typing…"
  hideLastSeen: boolean // don't show the peer's last-seen line
  // feedback / accessibility
  haptics: boolean
  sounds: boolean
  reduceMotion: boolean
  // media
  autoDownloadMedia: boolean
}

export const DEFAULT_PREFS: Prefs = {
  chatTextSize: 'md',
  density: 'cozy',
  bubbleCorners: 'round',
  wallpaperDim: 0,
  bigEmoji: true,
  showAvatars: true,
  enterToSend: true,
  clock24: false,
  autoScroll: true,
  confirmDelete: true,
  readReceipts: true,
  sendTyping: true,
  hideLastSeen: false,
  haptics: true,
  sounds: true,
  reduceMotion: false,
  autoDownloadMedia: true,
}

const KEY = 'fl-prefs'
let cache: Prefs = load()
const listeners = new Set<() => void>()

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULT_PREFS }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return cache[key]
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  cache = { ...cache, [key]: value }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* quota / private mode */ }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Reactive read of a single preference. */
export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(subscribe, () => cache[key], () => DEFAULT_PREFS[key])
}

/** Reactive read of the whole prefs object (for the Settings screen). */
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => cache, () => DEFAULT_PREFS)
}

/** Vibrate only if the user left haptics on. Use for taps/long-press feedback. */
export function haptic(ms: number | number[] = 10) {
  if (cache.haptics) navigator.vibrate?.(ms)
}

/** Map the text-size preference to a Tailwind class for message bodies. */
export function chatTextClass(size: Prefs['chatTextSize']): string {
  return size === 'sm' ? 'text-[13px]' : size === 'lg' ? 'text-[17px]' : size === 'xl' ? 'text-[19px]' : 'text-sm'
}
