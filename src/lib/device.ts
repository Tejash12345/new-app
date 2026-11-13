// ----------------------------------------------------------------------------
// Leo Live "phone powers" bridge. Inside the Android app the Flutter wrapper
// exposes an FLDevice channel (and sets window.__FLDeviceV1); native Kotlin
// performs the action and answers through window.__flDeviceResult(id, result).
// On the plain website none of this exists, and hasPhonePowers() is false.
// ----------------------------------------------------------------------------

export type DeviceResult = { ok: boolean; msg: string; level?: number; charging?: boolean; lat?: number; lon?: number }

type Bridge = { postMessage: (m: string) => void }
type W = Window & {
  FLDevice?: Bridge
  __FLDeviceV1?: boolean
  __FLDeviceToken?: string
  __flDeviceResult?: (id: string, r: DeviceResult) => void
}

const pending = new Map<string, (r: DeviceResult) => void>()
let seq = 0

export function hasPhonePowers(): boolean {
  const w = window as W
  return !!w.__FLDeviceV1 && typeof w.FLDevice?.postMessage === 'function' && leoPrefs().phoneControl
}

/** Ask the phone to do one thing. Never throws; resolves {ok:false} on failure/timeout. */
export function phone(a: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<DeviceResult> {
  const w = window as W
  if (!hasPhonePowers()) {
    return Promise.resolve({ ok: false, msg: 'Phone control works in the FocusLion Android app' })
  }
  w.__flDeviceResult ??= (id, r) => { pending.get(id)?.(r); pending.delete(id) }
  const id = `d${Date.now()}-${++seq}`
  return new Promise<DeviceResult>((resolve) => {
    const t = setTimeout(() => { pending.delete(id); resolve({ ok: false, msg: 'The phone did not respond' }) }, timeoutMs)
    pending.set(id, (r) => { clearTimeout(t); resolve(r) })
    w.FLDevice!.postMessage(JSON.stringify({ id, a, ...args, token: w.__FLDeviceToken }))
  })
}

/** Actions that switch to another app — run them after Leo finishes talking. */
export const LEAVES_APP = new Set([
  'open_app', 'call', 'sms', 'whatsapp', 'settings', 'youtube', 'music', 'maps', 'web', 'camera',
  'video', 'url', 'email', 'calendar', 'share',
  'power_menu', 'lock', 'screenshot', 'home', 'back', 'recents', 'notifications', 'quick_settings',
  'send_whatsapp', 'close_app', 'open_focuslion', 'send_bulk', 'scroll', 'tap', 'type', // these switch away from FocusLion
])

// ---- Leo settings (per device, user-controlled) ----
export type LeoPrefs = {
  enabled: boolean      // show the floating Leo button at all
  handsFree: boolean    // keep listening after each answer
  aiVoice: boolean      // natural Gemini voice (off = phone's built-in voice)
  briefing: boolean     // greet with a day briefing on the first open each day
  phoneControl: boolean // allow Leo to control the phone (Android app)
  heyLeo: boolean       // listen for "Hey Leo" (Android app, opt-in)
  bubble: boolean       // floating Leo bubble over other apps (Android app, opt-in)
  confirmSend: boolean  // Leo asks "shall I send?" before WhatsApp/SMS (off = sends right away)
}
const PREFS_KEY = 'fl:leo-prefs'
export const LEO_PREFS_EVENT = 'focuslion:leo-prefs'
const DEFAULT_PREFS: LeoPrefs = { enabled: true, handsFree: true, aiVoice: true, briefing: true, phoneControl: true, heyLeo: false, bubble: false, confirmSend: false }

export function leoPrefs(): LeoPrefs {
  try {
    // one-time update (v1.7.80): sending became automatic by default — older
    // saved settings still carry the previous "confirm: on" default
    if (!localStorage.getItem('fl:leo-prefs-v2')) {
      localStorage.setItem('fl:leo-prefs-v2', '1')
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
      if (saved && typeof saved === 'object' && 'confirmSend' in saved) {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ ...saved, confirmSend: false }))
      }
    }
    const legacyHands = localStorage.getItem('fl:leo-handsfree')
    const base = { ...DEFAULT_PREFS, ...(legacyHands === '0' ? { handsFree: false } : {}) }
    return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch { return DEFAULT_PREFS }
}

export function setLeoPrefs(patch: Partial<LeoPrefs>) {
  const next = { ...leoPrefs(), ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(LEO_PREFS_EVENT, { detail: next }))
}

export function clearLeoBrain() {
  try { localStorage.removeItem('fl:leo-memory'); localStorage.removeItem('fl:leo-skills') } catch { /* ignore */ }
}

// ---- Leo's learned skills: "when I say X, do Y" (kept on this device) ----
// Taught by the user through conversation; matched before any AI call, so a
// learned skill runs instantly and works offline.
export type Skill = { phrase: string; say: string; actions: Record<string, unknown>[]; uses: number }
const SKILL_KEY = 'fl:leo-skills'

const ph = (d: string, extra: Record<string, unknown> = {}) => ({ type: 'phone', do: d, ...extra })
/** Built-in skills every user starts with (editable/removable like taught ones). */
const BUILTIN_SKILLS: Skill[] = [
  { phrase: 'study mode', say: 'Study mode on. Notifications silenced, music paused, and a 50 minute focus session started. Let us go.',
    actions: [ph('dnd', { on: true }), ph('media', { key: 'pause' }), { type: 'start_focus', minutes: 50 }], uses: 0 },
  { phrase: 'exam mode', say: 'Exam mode. Phone on silent and a 90 minute deep focus session started. You have got this.',
    actions: [ph('dnd', { on: true }), ph('ringer', { mode: 'silent' }), { type: 'start_focus', minutes: 90 }], uses: 0 },
  { phrase: 'focus mode', say: 'Focus mode on. 25 minutes, no distractions.',
    actions: [ph('dnd', { on: true }), { type: 'start_focus', minutes: 25 }], uses: 0 },
  { phrase: 'break time', say: 'Break time. Notifications are back on, and I will ping you in 5 minutes.',
    actions: [ph('dnd', { on: false }), ph('timer', { seconds: 300, label: 'Break over' })], uses: 0 },
  { phrase: 'good night', say: 'Good night. Do Not Disturb is on, the screen is dimmed, and your alarm is set for 6 30.',
    actions: [ph('dnd', { on: true }), ph('brightness', { level: 'min' }), ph('alarm', { hour: 6, minute: 30, label: 'Good morning' })], uses: 0 },
  { phrase: 'lights on', say: 'Flashlight on.', actions: [ph('torch', { on: true })], uses: 0 },
  { phrase: 'lights off', say: 'Flashlight off.', actions: [ph('torch', { on: false })], uses: 0 },
]

export function loadSkills(): Skill[] {
  try {
    // first run: install the built-in skills once (users can remove them)
    if (!localStorage.getItem('fl:leo-skills-seeded')) {
      localStorage.setItem('fl:leo-skills-seeded', '1')
      const mine = JSON.parse(localStorage.getItem(SKILL_KEY) || '[]') as Skill[]
      localStorage.setItem(SKILL_KEY, JSON.stringify([...BUILTIN_SKILLS, ...(Array.isArray(mine) ? mine : [])]))
    }
    const v = JSON.parse(localStorage.getItem(SKILL_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
function saveSkills(s: Skill[]) {
  try { localStorage.setItem(SKILL_KEY, JSON.stringify(s.slice(-50))) } catch { /* ignore */ }
}
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

export function learnSkill(phrase: string, say: string, actions: Record<string, unknown>[]) {
  const p = norm(phrase)
  if (!p || !actions.length) return
  saveSkills([...loadSkills().filter((s) => norm(s.phrase) !== p), { phrase: phrase.trim(), say: say.trim(), actions, uses: 0 }])
}

export function forgetSkill(phrase: string): boolean {
  const p = norm(phrase)
  const all = loadSkills()
  const next = all.filter((s) => norm(s.phrase) !== p && !norm(s.phrase).includes(p))
  saveSkills(next)
  return next.length < all.length
}

/**
 * The learned skill this utterance triggers, if any. The sentence must be
 * (almost) just the phrase — "study mode" / "start study mode please" — so a
 * skill never hijacks a normal sentence ("tell mom good night"), and questions
 * or "off/stop/exit" requests go to the AI instead.
 */
export function matchSkill(text: string): Skill | null {
  const t = ` ${norm(text)} `
  // words that mean the user wants something else (turn it off, ask about it,
  // message someone) — unless that word is part of the skill's own phrase
  const BLOCK = ['off', 'stop', 'exit', 'end', 'disable', 'cancel', 'quit', 'is', 'what', 'why', 'how', 'when',
    'dont', 'not', 'tell', 'send', 'message', 'whatsapp', 'text', 'say']
  const FILLER = new Set(['leo', 'hey', 'ok', 'okay', 'please', 'now', 'start', 'activate', 'enable', 'turn', 'switch',
    'go', 'into', 'to', 'the', 'my', 'it', 's', 'its', 'time', 'for', 'let', 'lets', 'on'])
  const words = t.trim().split(' ')
  const hit = loadSkills().find((s) => {
    const phraseWords = norm(s.phrase).split(' ').filter(Boolean)
    if (!phraseWords.length) return false
    if (BLOCK.some((b) => words.includes(b) && !phraseWords.includes(b))) return false
    if (!t.includes(` ${phraseWords.join(' ')} `)) return false
    // everything outside the phrase must be filler ("start study mode please")
    const rest = t.replace(` ${phraseWords.join(' ')} `, ' ').trim().split(' ').filter(Boolean)
    return rest.every((w) => FILLER.has(w))
  })
  if (!hit) return null
  saveSkills(loadSkills().map((s) => (s.phrase === hit.phrase ? { ...s, uses: s.uses + 1 } : s)))
  return hit
}

// ---- Leo's memory: facts the user asked him to remember (kept on this device) ----
const MEM_KEY = 'fl:leo-memory'

export function loadMemory(): string[] {
  try { const v = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}

export function remember(fact: string) {
  const f = fact.trim()
  if (!f) return
  const next = [...loadMemory().filter((x) => x.toLowerCase() !== f.toLowerCase()), f].slice(-40)
  try { localStorage.setItem(MEM_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

export function forget(fact: string): boolean {
  const q = fact.trim().toLowerCase()
  const all = loadMemory()
  const next = all.filter((x) => !x.toLowerCase().includes(q) && !q.includes(x.toLowerCase()))
  try { localStorage.setItem(MEM_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next.length < all.length
}
