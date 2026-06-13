/**
 * App-blocker (Guard) bridge.
 *
 * The native Android wrapper runs a background app-blocker ("Guard") that
 * enforces your `social_limits` — daily caps and allowed-hours windows. The
 * Guard normally re-reads those settings only when its screen opens or you
 * pull-to-refresh, so changes made here (e.g. on the Wellbeing page) wouldn't
 * take effect until then.
 *
 * The Flutter wrapper injects an `FLGuard` JavaScript channel. When present,
 * we ping it after any change to your limits so the native side re-syncs and
 * pushes the new config to the running blocker immediately — no re-open or
 * manual refresh needed. On the plain web (no channel) this is a no-op.
 */
type AppBridge = { postMessage: (msg: string) => void }

export function notifyGuard() {
  try {
    const bridge = (window as unknown as { FLGuard?: AppBridge }).FLGuard
    if (bridge?.postMessage) {
      bridge.postMessage('sync')
    }
  } catch { /* ignore */ }
}
