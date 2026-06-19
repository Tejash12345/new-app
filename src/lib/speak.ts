type AppBridge = { postMessage: (msg: string) => void }

/**
 * Speak text aloud. Inside the Android app (a WebView, which has NO working Web
 * Speech API) the native wrapper injects an `FLSpeak` channel — we hand the text
 * to it and Flutter speaks it with the device TTS. On the web we fall back to
 * the browser's speechSynthesis.
 */
export function speak(text: string) {
  const t = (text ?? '').trim()
  if (!t) return

  // native Android TTS bridge (set up by the Flutter wrapper)
  try {
    const bridge = (window as unknown as { FLSpeak?: AppBridge }).FLSpeak
    if (bridge?.postMessage) {
      bridge.postMessage(t)
      return
    }
  } catch { /* ignore */ }

  // browser Web Speech API
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.rate = 0.9
      window.speechSynthesis.speak(u)
    }
  } catch { /* ignore */ }
}
