/**
 * Native screen-capture bridge (Android app only).
 *
 * Android's WebView has no getDisplayMedia, so screen sharing from the app is
 * done natively: the Flutter wrapper captures the screen with MediaProjection
 * and pushes JPEG frames to `window.__flScreenFrame(base64)`; we paint them to
 * a canvas and feed canvas.captureStream() into the existing call. `FLScreen`
 * starts/stops the native capture. In a browser this bridge is absent and the
 * normal getDisplayMedia path is used instead.
 */
type AppBridge = { postMessage: (msg: string) => void }

function bridge(): AppBridge | undefined {
  try {
    return (window as unknown as { FLScreen?: AppBridge }).FLScreen
  } catch {
    return undefined
  }
}

export function hasNativeScreen(): boolean {
  return !!bridge()?.postMessage
}

/** Trigger the native "start casting?" prompt + capture. */
export function nativeScreenStart() {
  try { bridge()?.postMessage(JSON.stringify({ a: 'start' })) } catch { /* ignore */ }
}

/** Stop native capture. */
export function nativeScreenStop() {
  try { bridge()?.postMessage(JSON.stringify({ a: 'stop' })) } catch { /* ignore */ }
}
