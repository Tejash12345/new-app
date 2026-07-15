/**
 * Accent themes. FocusLion's Tailwind 4 `@theme` exposes the brand palette as
 * CSS variables (--color-brand-50…900) that every `brand-*` utility resolves at
 * runtime — so overriding those variables on <html> re-skins the WHOLE app
 * (buttons, nav, gradients, the aurora background, highlights) instantly. The
 * user picks from 50+ colours in Settings; it persists and is applied before
 * first paint.
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const
type Shade = (typeof SHADES)[number]
type Ramp = Record<Shade, string>

// lightness curve per shade (tuned to look like a real Tailwind ramp)
const LIGHT: Record<Shade, number> = { 50: 97, 100: 94, 200: 87, 300: 77, 400: 67, 500: 57, 600: 49, 700: 41, 800: 34, 900: 27 }

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// build a 50→900 ramp from a hue + base saturation (slightly desaturate the
// palest tints, keep the darks rich)
function ramp(h: number, s: number): Ramp {
  const out = {} as Ramp
  for (const shade of SHADES) {
    const sat = shade <= 100 ? s * 0.82 : shade >= 800 ? Math.min(s * 1.05, 92) : s
    out[shade] = hslToHex(h, sat, LIGHT[shade])
  }
  return out
}

// Ocean = the app's original brand ramp (kept exact so existing users' look
// doesn't shift); everything else is generated from a hue + saturation.
const OCEAN: Ramp = { 50: '#eef1ff', 100: '#dde3ff', 200: '#c0cbff', 300: '#94a6ff', 400: '#6c8cff', 500: '#4f6bfa', 600: '#3a4bef', 700: '#2f3ad3', 800: '#2932aa', 900: '#283186' }

const HUES: [string, number, number][] = [
  ['Blue', 218, 82], ['Sky', 200, 85], ['Azure', 208, 82], ['Sapphire', 224, 70], ['Royal', 234, 66],
  ['Indigo', 245, 62], ['Denim', 214, 46], ['Violet', 262, 68], ['Purple', 275, 62], ['Grape', 285, 58],
  ['Lavender', 258, 46], ['Amethyst', 270, 54], ['Magenta', 310, 70], ['Fuchsia', 322, 76], ['Orchid', 300, 54],
  ['Plum', 295, 40], ['Pink', 330, 80], ['Rose', 345, 80], ['Blush', 350, 56], ['Cherry', 352, 72],
  ['Crimson', 348, 76], ['Ruby', 342, 66], ['Red', 4, 78], ['Scarlet', 10, 82], ['Coral', 14, 78],
  ['Salmon', 12, 60], ['Vermilion', 16, 82], ['Orange', 26, 88], ['Tangerine', 30, 90], ['Peach', 24, 62],
  ['Apricot', 34, 78], ['Amber', 40, 90], ['Honey', 44, 82], ['Gold', 46, 76], ['Yellow', 52, 86],
  ['Chartreuse', 78, 68], ['Lime', 92, 66], ['Olive', 70, 40], ['Green', 135, 58], ['Emerald', 152, 62],
  ['Forest', 145, 44], ['Fern', 120, 50], ['Mint', 158, 52], ['Jade', 162, 55], ['Seafoam', 168, 46],
  ['Teal', 176, 62], ['Turquoise', 182, 58], ['Aqua', 186, 66], ['Cyan', 190, 72], ['Cerulean', 196, 70],
  ['Slate', 220, 15], ['Steel', 210, 20], ['Mocha', 25, 28], ['Bronze', 34, 42], ['Sienna', 18, 48], ['Rust', 16, 56],
]

export type ThemeEntry = { id: string; name: string; ramp: Ramp }

export const THEMES: ThemeEntry[] = [
  { id: 'ocean', name: 'Ocean', ramp: OCEAN },
  ...HUES.map(([name, h, s]): ThemeEntry => ({ id: name.toLowerCase(), name, ramp: ramp(h, s) })),
]

export type ThemeId = string

const STORAGE_KEY = 'fl-theme'

export function getStoredTheme(): ThemeId {
  const id = localStorage.getItem(STORAGE_KEY)
  return id && THEMES.some((t) => t.id === id) ? id : 'ocean'
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
