/**
 * Accent themes. FocusLion's Tailwind 4 `@theme` exposes the brand palette as
 * CSS variables (--color-brand-50…900) that every `brand-*` utility resolves at
 * runtime — so overriding those variables on <html> re-skins the whole app
 * instantly. The user picks a theme in Settings (like a daisyUI theme picker);
 * it persists in localStorage and is applied before first paint.
 */
export type ThemeId =
  | 'ocean' | 'violet' | 'emerald' | 'rose' | 'amber'
  | 'cyan' | 'pink' | 'teal' | 'orange' | 'sky' | 'crimson'

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const

type Ramp = Record<(typeof SHADES)[number], string>

export const THEMES: { id: ThemeId; name: string; ramp: Ramp }[] = [
  { id: 'ocean', name: 'Ocean', ramp: { 50: '#eef1ff', 100: '#dde3ff', 200: '#c0cbff', 300: '#94a6ff', 400: '#6c8cff', 500: '#4f6bfa', 600: '#3a4bef', 700: '#2f3ad3', 800: '#2932aa', 900: '#283186' } },
  { id: 'violet', name: 'Violet', ramp: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95' } },
  { id: 'emerald', name: 'Emerald', ramp: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' } },
  { id: 'rose', name: 'Rose', ramp: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337' } },
  { id: 'amber', name: 'Amber', ramp: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f' } },
  { id: 'cyan', name: 'Cyan', ramp: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490', 800: '#155e75', 900: '#164e63' } },
  { id: 'pink', name: 'Pink', ramp: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' } },
  { id: 'teal', name: 'Teal', ramp: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a' } },
  { id: 'orange', name: 'Orange', ramp: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12' } },
  { id: 'sky', name: 'Sky', ramp: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e' } },
  { id: 'crimson', name: 'Crimson', ramp: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d' } },
]

const STORAGE_KEY = 'fl-theme'

export function getStoredTheme(): ThemeId {
  const id = localStorage.getItem(STORAGE_KEY) as ThemeId | null
  return THEMES.some((t) => t.id === id) ? (id as ThemeId) : 'ocean'
}

export function applyTheme(id: ThemeId) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  const root = document.documentElement
  for (const s of SHADES) root.style.setProperty(`--color-brand-${s}`, t.ramp[s])
}

export function setTheme(id: ThemeId) {
  localStorage.setItem(STORAGE_KEY, id)
  applyTheme(id)
}

// apply the saved theme as early as this module loads (imported in main.tsx)
applyTheme(getStoredTheme())
