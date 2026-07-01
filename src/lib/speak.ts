type AppBridge = { postMessage: (msg: string) => void }

// ---------------------------------------------------------------------------
// Text-to-speech for FocusLion.
//
// Inside the Android app (a Flutter WebView, which has NO working Web Speech
// API) the native wrapper injects an `FLSpeak` channel. On the web we use the
// browser's speechSynthesis, which supports pause/resume/stop directly.
//
// Two native tiers, auto-detected so nothing ever breaks:
//   • Legacy wrapper — only `FLSpeak.postMessage(text)` (speaks, can't stop).
//     We send PLAIN TEXT so old builds keep working (play only).
//   • Upgraded wrapper — sets `window.__FLSpeakV2 = true` and understands JSON
//     commands: {a:'speak',text,lang,rate} | {a:'pause'} | {a:'resume'} | {a:'stop'}.
//     It should also call `window.__flSpeakEnded()` when speech finishes so the
//     UI can reset to idle. This unlocks pause/resume/stop in the APK.
// ---------------------------------------------------------------------------

// App language label -> BCP-47 locale, so the device reads recipes in the
// correct voice (Telugu text with a Telugu voice, etc.).
const LOCALES: Record<string, string> = {
  english: 'en-IN', hindi: 'hi-IN', telugu: 'te-IN', tamil: 'ta-IN',
  kannada: 'kn-IN', malayalam: 'ml-IN', marathi: 'mr-IN', bengali: 'bn-IN',
  gujarati: 'gu-IN', punjabi: 'pa-IN',
}
export function localeFor(language?: string): string {
  return LOCALES[(language ?? '').toLowerCase().trim()] || 'en-IN'
}

function bridge(): AppBridge | null {
  try {
    const b = (window as unknown as { FLSpeak?: AppBridge }).FLSpeak
    return b && typeof b.postMessage === 'function' ? b : null
  } catch { return null }
}
function nativeControls(): boolean {
  try { return !!(window as unknown as { __FLSpeakV2?: boolean }).__FLSpeakV2 && !!bridge() }
  catch { return false }
}

export type SpeechState = 'idle' | 'playing' | 'paused'
type Listener = (s: SpeechState) => void

class Speech {
  state: SpeechState = 'idle'
  private listeners = new Set<Listener>()
  private mode: 'web' | 'native' | 'native-basic' | 'none' = 'none'
  private gen = 0 // invalidates stale onend callbacks after stop()/replay

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  private set(s: SpeechState) {
    if (this.state === s) return
    this.state = s
    this.listeners.forEach((l) => l(s))
  }

  /** Are pause/resume/stop available on this platform? (Legacy APK = play only.) */
  get canControl(): boolean {
    if (typeof window === 'undefined') return false
    if (nativeControls()) return true
    if (bridge()) return false
    return 'speechSynthesis' in window
  }

  play(text: string, language?: string) {
    const t = (text ?? '').trim()
    if (!t) return
    this.stop()
    const g = this.gen
    const lang = localeFor(language)

    if (nativeControls()) {
      this.mode = 'native'
      ;(window as unknown as { __flSpeakEnded?: () => void }).__flSpeakEnded = () => {
        if (g === this.gen) this.set('idle')
      }
      bridge()!.postMessage(JSON.stringify({ a: 'speak', text: t, lang, rate: 0.92 }))
      this.set('playing')
      return
    }
    if (bridge()) {
      // legacy wrapper — plain text, fire-and-forget (play only)
      this.mode = 'native-basic'
      bridge()!.postMessage(t)
      this.set('playing')
      return
    }
    if ('speechSynthesis' in window) {
      this.mode = 'web'
      const synth = window.speechSynthesis
      synth.cancel()
      // Chunk into sentences: works around Chrome cutting off long utterances,
      // and pause/resume/cancel still apply to the whole queue.
      const chunks = (t.match(/\S[^.!?\n]*[.!?\n]*/g) || [t]).map((c) => c.trim()).filter(Boolean)
      chunks.forEach((c, i) => {
        const u = new SpeechSynthesisUtterance(c)
        u.lang = lang
        u.rate = 0.95
        if (i === chunks.length - 1) {
          u.onend = () => { if (g === this.gen) this.set('idle') }
          u.onerror = () => { if (g === this.gen) this.set('idle') }
        }
        synth.speak(u)
      })
      // Chrome quirk: after a previous pause()+cancel() the engine can stay
      // internally paused, so a fresh speak() is silent. resume() clears it.
      synth.resume()
      this.set('playing')
      return
    }
    this.mode = 'none'
  }

  pause() {
    if (this.state !== 'playing') return
    if (this.mode === 'native') bridge()?.postMessage(JSON.stringify({ a: 'pause' }))
    else if (this.mode === 'web' && 'speechSynthesis' in window) window.speechSynthesis.pause()
    else return
    this.set('paused')
  }

  resume() {
    if (this.state !== 'paused') return
    if (this.mode === 'native') bridge()?.postMessage(JSON.stringify({ a: 'resume' }))
    else if (this.mode === 'web' && 'speechSynthesis' in window) window.speechSynthesis.resume()
    else return
    this.set('playing')
  }

  stop() {
    this.gen++ // any pending onend callback is now stale
    if (this.mode === 'native') bridge()?.postMessage(JSON.stringify({ a: 'stop' }))
    else if (this.mode === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    this.set('idle')
  }
}

export const speech = new Speech()

/**
 * One-shot speak (Word of the Day). Routes through the controller so it uses
 * the best available path; on legacy wrappers this stays plain-text.
 */
export function speak(text: string, language?: string) {
  speech.play(text, language)
}
