/**
 * Cross-surface notification helper.
 *
 * On the web it uses the browser Notification API. Inside the Android app
 * (a WebView), the Notification API is unavailable, so the native wrapper
 * injects a `FLNotify` JavaScript channel — when present, we hand the
 * notification to it and Flutter shows a real Android notification.
 */
type AppBridge = { postMessage: (msg: string) => void }

export function pushNotification(title: string, body: string, tag?: string) {
  // native Android app bridge (set up by the Flutter wrapper)
  try {
    const bridge = (window as unknown as { FLNotify?: AppBridge }).FLNotify
    if (bridge?.postMessage) {
      bridge.postMessage(JSON.stringify({ title, body, tag }))
      return
    }
  } catch { /* ignore */ }

  // browser
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag })
    }
  } catch { /* ignore */ }
}

export function requestNotifPermission() {
  // native app handles its own permission; nothing to do here
  if ((window as unknown as { FLNotify?: unknown }).FLNotify) return
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}
