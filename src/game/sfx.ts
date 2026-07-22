/**
 * Lion Run audio — a fully synthesized Web Audio sound engine.
 *
 * No samples, no downloads, offline-safe: every sound is generated live from
 * oscillators + filtered noise, so it costs nothing and reaches the Android
 * WebView with the normal deploy. Gated by the `sounds` preference (respects a
 * live toggle) and a complete no-op if Web Audio is unavailable.
 *
 * Beyond one-shot SFX it drives two adaptive AMBIENCE beds:
 *  - `drive(intensity)` — an engine hum whose pitch/volume track your speed
 *    while driving a car/bike/truck,
 *  - `fly(intensity)`   — a wind/rotor wash while flying a plane/heli.
 *
 * A singleton (`sfx`) shared across runs; the AudioContext is created lazily and
 * unlocked on the first tap via `resume()` (browsers require a user gesture).
 */
import { getPref } from '../lib/prefs'

type WinAC = typeof AudioContext

type Ambience = { osc: OscillatorNode; sub: OscillatorNode; filt: BiquadFilterNode; gain: GainNode }
type Wind = { src: AudioBufferSourceNode; filt: BiquadFilterNode; gain: GainNode }

class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private eng: Ambience | null = null
  private wind: Wind | null = null
  private rainBed: Wind | null = null
  private musicGain: GainNode | null = null

  /**
   * Create/resume the shared AudioContext + master bus. NOT gated by any pref —
   * the SFX gate lives in `ensure()`, and the music engine (which has its own
   * `music` pref) shares this core so it can play even with SFX muted.
   */
  private ensureCore(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
      return this.ctx
    }
    try {
      const AC: WinAC | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: WinAC }).webkitAudioContext
      if (!AC) return null
      const ctx = new AC()
      const master = ctx.createGain()
      master.gain.value = 0.5
      master.connect(ctx.destination)
      // one second of white noise, reused for every noise-based effect
      const len = Math.floor(ctx.sampleRate)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.ctx = ctx
      this.master = master
      this.noiseBuf = buf
      return ctx
    } catch {
      return null
    }
  }

  /** The SFX-gated context: one-shots bail here when `sounds` is off. */
  private ensure(): AudioContext | null {
    if (!getPref('sounds')) return null
    return this.ensureCore()
  }

  /**
   * A dedicated sub-bus for the adaptive music engine — the same context, on a
   * gain node under the master so effects sit on top of the score. Not gated by
   * the `sounds` pref (music has its own toggle).
   */
  musicBus(): { ctx: AudioContext; out: GainNode } | null {
    const c = this.ensureCore()
    if (!c || !this.master) return null
    if (!this.musicGain) {
      const g = c.createGain()
      g.gain.value = 0.7
      g.connect(this.master)
      this.musicGain = g
    }
    return { ctx: c, out: this.musicGain }
  }

  /** Unlock/resume the context on a user gesture (called from the first tap). */
  resume() {
    if (!getPref('sounds') && !getPref('music')) return
    const c = this.ensureCore()
    if (c && c.state === 'suspended') c.resume().catch(() => {})
  }

  // ---- primitives ----
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', peak = 0.25, sweepTo?: number, when = 0) {
    const c = this.ensure()
    if (!c || !this.master) return
    const t = c.currentTime + when
    const o = c.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.25))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.03)
  }

  private noise(dur: number, peak = 0.25, filter: BiquadFilterType = 'bandpass', freq = 1000, q = 1, sweepTo?: number) {
    const c = this.ensure()
    if (!c || !this.master || !this.noiseBuf) return
    const t = c.currentTime
    const s = c.createBufferSource()
    s.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = filter
    f.frequency.setValueAtTime(freq, t)
    f.Q.value = q
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(this.master)
    s.start(t)
    s.stop(t + dur + 0.03)
  }

  // ---- one-shot SFX ----
  jump(double = false) { this.tone(double ? 360 : 240, 0.18, 'square', 0.16, double ? 760 : 560) }
  climb() { this.tone(320, 0.22, 'sawtooth', 0.12, 900); this.noise(0.22, 0.06, 'highpass', 1400, 0.6) }
  land() { this.tone(150, 0.12, 'sine', 0.2, 70) }
  coin(combo = 0) {
    const k = Math.pow(2, Math.min(combo, 15) / 16) // pitch rises with the combo streak
    this.tone(740 * k, 0.1, 'triangle', 0.2)
    this.tone(1180 * k, 0.09, 'sine', 0.1, undefined, 0.02)
  }
  powerup() {[523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.13, 'triangle', 0.15, undefined, i * 0.05)) }
  shieldBreak() { this.noise(0.3, 0.28, 'highpass', 1200, 1, 300); this.tone(600, 0.3, 'sawtooth', 0.14, 120) }
  boost() { this.tone(300, 0.4, 'sawtooth', 0.2, 1300); this.noise(0.4, 0.13, 'bandpass', 800, 0.7, 2400) }
  nearMiss() { this.noise(0.16, 0.15, 'bandpass', 1600, 0.8, 600) }
  stageUp() {[659, 988].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.17, undefined, i * 0.09)); this.tone(1318, 0.5, 'sine', 0.11, undefined, 0.18) }
  crash() { this.noise(0.5, 0.38, 'lowpass', 900, 1, 120); this.tone(120, 0.5, 'sine', 0.28, 38) }
  slide() { this.noise(0.4, 0.16, 'bandpass', 700, 0.6) }
  thunder() { this.noise(0.25, 0.16, 'highpass', 3000, 1); this.noise(0.9, 0.3, 'lowpass', 420, 0.7, 80); this.tone(70, 0.9, 'sine', 0.2, 40) }
  // race combat
  launch() { this.tone(500, 0.25, 'sawtooth', 0.15, 1400) }
  hit(kind: 'rocket' | 'bolt' | 'fire' | 'freeze' | 'tornado') {
    if (kind === 'bolt') { this.noise(0.25, 0.3, 'highpass', 2000, 1, 500); this.tone(900, 0.2, 'square', 0.13, 180) }
    else if (kind === 'fire') { this.noise(0.4, 0.28, 'lowpass', 1200, 1, 300) }
    else if (kind === 'freeze') {[1568, 1318, 1046].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.11, undefined, i * 0.04)) }
    else if (kind === 'tornado') { this.noise(0.6, 0.24, 'bandpass', 400, 0.5, 180) }
    else { this.crash() }
  }

  // ---- premium UI + reward SFX ----
  /** Crisp glass-UI click for buttons. */
  uiClick() { this.tone(880, 0.05, 'square', 0.08, 1320); this.tone(1760, 0.04, 'sine', 0.05, undefined, 0.012) }
  /** Softer "back / dismiss" blip. */
  uiBack() { this.tone(560, 0.07, 'triangle', 0.08, 340) }
  /** Airy hologram / glass panel activating. */
  hologram() { this.tone(320, 0.5, 'sawtooth', 0.06, 1600); this.noise(0.5, 0.04, 'bandpass', 2200, 3, 800) }
  /** Bright XP tick (distinct from the coin chime). */
  xp() { this.tone(1046, 0.09, 'triangle', 0.14); this.tone(1568, 0.12, 'sine', 0.08, undefined, 0.04) }
  /** Treasure chest creaking open then a sparkle. */
  chest() { this.noise(0.12, 0.14, 'bandpass', 500, 2); [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, undefined, 0.06 + i * 0.05)) }
  /** Portal winding up. */
  portal() { this.tone(120, 0.9, 'sine', 0.14, 900); this.noise(0.9, 0.1, 'bandpass', 700, 4, 2600) }
  /** Teleport zap. */
  teleport() { this.tone(1400, 0.25, 'sine', 0.12, 120); this.noise(0.25, 0.12, 'highpass', 1800, 1, 400) }
  /** Energy charging up over `secs`. */
  charge(secs = 1) { this.tone(80, secs, 'sawtooth', 0.12, 1200); this.noise(secs, 0.05, 'bandpass', 400, 2, 3000) }
  /** Laser / pew. */
  laser() { this.tone(1800, 0.16, 'sawtooth', 0.14, 200); this.noise(0.1, 0.06, 'highpass', 3000, 1) }
  /** Achievement-unlock fanfare. */
  achievement() { [659, 988, 1318, 1568].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.13, undefined, i * 0.08)); this.tone(2093, 0.7, 'sine', 0.07, undefined, 0.34) }
  /** Level-up celebration run. */
  levelUp() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.13, undefined, i * 0.06)); this.tone(2093, 0.6, 'sine', 0.08, undefined, 0.4) }
  /** Heroic victory sting. */
  victory() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'square', 0.12, undefined, i * 0.06));[1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.14, undefined, 0.22 + i * 0.07)) }
  /** Descending game-over sting. */
  gameOver() { [440, 349, 262].forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.16, undefined, i * 0.16)); this.tone(131, 0.9, 'sine', 0.2, 90, 0.48) }
  /** Gentle two-note notification. */
  notify() { this.tone(880, 0.09, 'sine', 0.12); this.tone(1174, 0.12, 'sine', 0.1, undefined, 0.09) }

  // ---- adaptive ambience ----
  private ensureEng(): Ambience | null {
    const c = this.ensure()
    if (!c || !this.master) return null
    if (this.eng) return this.eng
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 80
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = 48
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400; filt.Q.value = 6
    const gain = c.createGain(); gain.gain.value = 0
    osc.connect(filt); sub.connect(filt); filt.connect(gain).connect(this.master)
    osc.start(); sub.start()
    this.eng = { osc, sub, filt, gain }
    return this.eng
  }

  private ensureWind(): Wind | null {
    const c = this.ensure()
    if (!c || !this.master || !this.noiseBuf) return null
    if (this.wind) return this.wind
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const filt = c.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 500; filt.Q.value = 0.7
    const gain = c.createGain(); gain.gain.value = 0
    src.connect(filt).connect(gain).connect(this.master)
    src.start()
    this.wind = { src, filt, gain }
    return this.wind
  }

  /** Engine hum for a ground vehicle. intensity 0 (off) → ~1 (flat out). */
  drive(intensity: number) {
    const c = this.ctx
    if (!getPref('sounds') || !c) { if (this.eng) this.eng.gain.gain.value = 0; return }
    const e = this.ensureEng()
    if (!e) return
    const on = intensity > 0.001
    e.gain.gain.setTargetAtTime(on ? 0.05 + intensity * 0.06 : 0, c.currentTime, 0.12)
    e.osc.frequency.setTargetAtTime(70 + intensity * 90, c.currentTime, 0.12)
    e.sub.frequency.setTargetAtTime(44 + intensity * 34, c.currentTime, 0.12)
    e.filt.frequency.setTargetAtTime(350 + intensity * 700, c.currentTime, 0.12)
  }

  /** Wind/rotor wash for a flying vehicle. intensity 0 (off) → ~1. */
  fly(intensity: number) {
    const c = this.ctx
    if (!getPref('sounds') || !c) { if (this.wind) this.wind.gain.gain.value = 0; return }
    const w = this.ensureWind()
    if (!w) return
    const on = intensity > 0.001
    w.gain.gain.setTargetAtTime(on ? 0.04 + intensity * 0.08 : 0, c.currentTime, 0.15)
    w.filt.frequency.setTargetAtTime(400 + intensity * 900, c.currentTime, 0.15)
  }

  private ensureRain(): Wind | null {
    const c = this.ensure()
    if (!c || !this.master || !this.noiseBuf) return null
    if (this.rainBed) return this.rainBed
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const filt = c.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 1800; filt.Q.value = 0.5
    const gain = c.createGain(); gain.gain.value = 0
    src.connect(filt).connect(gain).connect(this.master)
    src.start()
    this.rainBed = { src, filt, gain }
    return this.rainBed
  }

  /** Rain hiss for stormy stages. intensity 0 (off) → ~1 (downpour). */
  rain(intensity: number) {
    const c = this.ctx
    if (!getPref('sounds') || !c) { if (this.rainBed) this.rainBed.gain.gain.value = 0; return }
    const r = this.ensureRain()
    if (!r) return
    const on = intensity > 0.001
    r.gain.gain.setTargetAtTime(on ? 0.03 + intensity * 0.07 : 0, c.currentTime, 0.3)
  }

  /** Silence the ambience beds (run over / component unmount). */
  stopAmbience() {
    if (this.eng) this.eng.gain.gain.value = 0
    if (this.wind) this.wind.gain.gain.value = 0
    if (this.rainBed) this.rainBed.gain.gain.value = 0
  }
}

export const sfx = new GameAudio()
