/**
 * Call audio routing bridge.
 *
 * In a browser the OS/WebRTC picks the output and there's no earpiece, so these
 * are no-ops. Inside the Android app the Flutter wrapper injects an `FLCallAudio`
 * channel that drives the native AudioManager: a voice call plays through the
 * EARPIECE by default (like a phone call), and the speaker button switches to
 * the loudspeaker. Video calls default to the loudspeaker (hands-free).
 */
type AppBridge = { postMessage: (msg: string) => void }

function bridge(): AppBridge | undefined {
  try {
    return (window as unknown as { FLCallAudio?: AppBridge }).FLCallAudio
  } catch {
    return undefined
  }
}

/** True when native routing is available (i.e. running inside the Android app). */
export function hasNativeCallAudio(): boolean {
  return !!bridge()?.postMessage
}

/** Enter call audio mode. `speaker` = start on the loudspeaker (video calls). */
export function callAudioStart(speaker: boolean) {
  try { bridge()?.postMessage(JSON.stringify({ a: 'start', speaker })) } catch { /* ignore */ }
}

/** Route to loudspeaker (true) or earpiece (false) mid-call. */
export function callAudioSpeaker(on: boolean) {
  try { bridge()?.postMessage(JSON.stringify({ a: 'speaker', on })) } catch { /* ignore */ }
}

/** Leave call audio mode — back to normal media routing. */
export function callAudioEnd() {
  try { bridge()?.postMessage(JSON.stringify({ a: 'end' })) } catch { /* ignore */ }
}
