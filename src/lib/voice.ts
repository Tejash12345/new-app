// ----------------------------------------------------------------------------
// Voice capture for Leo Live. Records the mic with MediaRecorder and stops by
// itself when the user goes quiet (simple volume-based voice detection), so it
// feels hands-free like a real assistant. Works in Chrome and in the Android
// WebView (the wrapper grants the mic to getUserMedia). Speech-to-text happens
// server-side (Whisper), because the WebView has no Web Speech API.
// ----------------------------------------------------------------------------

export type Recording = { dataUrl: string; spoke: boolean; ms: number }

export type Listener = {
  /** resolves with the clip once the user stops talking (or on stop()/timeout) */
  done: Promise<Recording>
  /** stop now and keep what was said */
  stop: () => void
  /** stop now and throw the clip away */
  cancel: () => void
}

const SILENCE_AFTER_SPEECH_MS = 1300 // quiet this long after speaking -> done
const NO_SPEECH_TIMEOUT_MS = 7000    // never started talking -> give up
const MAX_MS = 30000                 // hard cap per turn

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const m of options) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch { /* ignore */ }
  }
  return ''
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

/** Start listening. onLevel gets a 0..1 loudness value ~30x/second for the orb animation. */
export async function listen(onLevel?: (level: number) => void): Promise<Listener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const mime = pickMime()
  let rec: MediaRecorder
  let ctx: AudioContext
  let analyser: AnalyserNode
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop()) // never leave the mic on
    throw e
  }
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const buf = new Uint8Array(analyser.fftSize)

  const started = Date.now()
  let spoke = false
  let lastLoud = started
  let noise = 0.02 // adaptive noise floor
  let raf = 0
  let cancelled = false
  let finished = false

  let resolveDone!: (r: Recording) => void
  let rejectDone!: (e: unknown) => void
  const done = new Promise<Recording>((res, rej) => { resolveDone = res; rejectDone = rej })

  // backstop: rAF pauses when the app goes to the background, so a plain
  // timer guarantees the mic is released and the turn ends
  const hardStop = setTimeout(() => finish(), MAX_MS + 1000)

  const cleanup = () => {
    clearTimeout(hardStop)
    cancelAnimationFrame(raf)
    stream.getTracks().forEach((t) => t.stop())
    ctx.close().catch(() => {})
  }

  rec.onstop = () => {
    cleanup()
    if (cancelled) { rejectDone(new Error('cancelled')); return }
    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })
    const reader = new FileReader()
    reader.onload = () => resolveDone({ dataUrl: String(reader.result), spoke, ms: Date.now() - started })
    reader.onerror = () => rejectDone(new Error('Could not read the recording'))
    reader.readAsDataURL(blob)
  }

  const finish = () => {
    if (finished) return
    finished = true
    try {
      if (rec.state !== 'inactive') rec.stop()
      else rec.onstop?.(new Event('stop'))
    } catch { cleanup() }
  }

  const tick = () => {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
    const rms = Math.sqrt(sum / buf.length)
    const now = Date.now()
    // learn the room's background level during quiet moments
    if (rms < noise * 1.5) noise = noise * 0.95 + rms * 0.05
    const threshold = Math.max(0.025, noise * 2.6)
    if (rms > threshold) { lastLoud = now; if (now - started > 150) spoke = true }
    onLevel?.(Math.min(1, rms * 6))

    if (spoke && now - lastLoud > SILENCE_AFTER_SPEECH_MS) return finish()
    if (!spoke && now - started > NO_SPEECH_TIMEOUT_MS) return finish()
    if (now - started > MAX_MS) return finish()
    raf = requestAnimationFrame(tick)
  }

  rec.start(250)
  raf = requestAnimationFrame(tick)

  return {
    done,
    stop: finish,
    cancel: () => { cancelled = true; finish() },
  }
}
