/**
 * Adaptive music — a fully synthesized, generative soundtrack engine.
 *
 * There are no audio files: every note is generated live from oscillators and
 * filtered noise, so the whole soundtrack costs nothing, works offline, ships
 * with the normal deploy and reaches the Android WebView. Nothing here is a
 * sample or a recording, so there is no licensing question at all.
 *
 * It shares ONE AudioContext with the SFX engine (via `sfx.musicBus()`), on a
 * dedicated gain bus that sits under the SFX so effects always cut through.
 *
 * The music is MOOD-driven and INTENSITY-driven:
 *  - `play(mood)` crossfades to a mood (`menu` calm bed / `run` driving
 *    electronic / `boss` dark & heavy) at the next bar line so the harmony
 *    never lurches,
 *  - `setIntensity(0..1)` fades layers in/out live — drums and lead swell as
 *    the run speeds up and stages climb, then relax again — no track changes,
 *    just an adaptive mix.
 *
 * A lookahead scheduler (classic Web Audio pattern: a 25 ms timer queues notes
 * ~120 ms ahead on the sample-accurate audio clock) keeps timing rock-solid
 * even when the game's requestAnimationFrame loop stutters. Gated by the
 * `music` preference; a complete no-op if Web Audio is unavailable.
 */
import { getPref } from '../lib/prefs'
import { sfx } from './sfx'

export type Mood = 'menu' | 'run' | 'boss'
type Layer = 'bass' | 'pad' | 'arp' | 'drums' | 'lead'

const A4 = 440
/** MIDI note number → frequency in Hz. */
const mtof = (m: number) => A4 * Math.pow(2, (m - 69) / 12)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

type ChordType = 'min' | 'maj' | 'min7' | 'sus'
const CHORD_INTERVALS: Record<ChordType, number[]> = {
  min: [0, 3, 7],
  maj: [0, 4, 7],
  min7: [0, 3, 7, 10],
  sus: [0, 5, 7],
}

type Chord = { root: number; type: ChordType } // root = MIDI note
type MoodCfg = {
  bpm: number
  swing: number // 0..~0.3, delays off-beat 16ths
  prog: Chord[] // one chord per bar; the loop cycles through them
  scale: number[] // semitone offsets from the chord root, for lead lines
  /** Per-layer target gain as a function of intensity (0..1). */
  target: (i: number) => Record<Layer, number>
}

const MOODS: Record<Mood, MoodCfg> = {
  // calm, lush bed for menus / the pre-run screen / the WASTED screen
  menu: {
    bpm: 76,
    swing: 0.12,
    prog: [
      { root: 45, type: 'min' }, // Am
      { root: 41, type: 'maj' }, // F
      { root: 48, type: 'maj' }, // C
      { root: 43, type: 'maj' }, // G
    ],
    scale: [0, 2, 3, 5, 7, 8, 10], // natural minor
    target: () => ({ bass: 0.12, pad: 0.55, arp: 0.16, drums: 0, lead: 0 }),
  },
  // driving futuristic electronic — the running soundtrack
  run: {
    bpm: 128,
    swing: 0,
    prog: [
      { root: 40, type: 'min' }, // Em  (i)
      { root: 36, type: 'maj' }, // C   (VI)
      { root: 43, type: 'maj' }, // G   (III)
      { root: 38, type: 'maj' }, // D   (VII)
    ],
    scale: [0, 3, 5, 7, 10], // minor pentatonic
    target: (i) => ({
      bass: 0.24,
      pad: 0.14,
      arp: 0.1 + 0.12 * i,
      drums: 0.1 + 0.28 * i,
      lead: i > 0.55 ? 0.06 + 0.1 * i : 0,
    }),
  },
  // dark, heavy, relentless — races / boss & rival encounters
  boss: {
    bpm: 140,
    swing: 0,
    prog: [
      { root: 38, type: 'min' }, // Dm
      { root: 34, type: 'maj' }, // Bb
      { root: 38, type: 'min' }, // Dm
      { root: 36, type: 'maj' }, // C
    ],
    scale: [0, 1, 3, 5, 7, 8, 10], // phrygian — menacing
    target: (i) => ({ bass: 0.28, pad: 0.12, arp: 0.13, drums: 0.3, lead: 0.12 + 0.06 * i }),
  },
}

type Voice = { attack?: number; release?: number; cutoff?: number; q?: number; detune?: number }

class MusicEngine {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private layers = {} as Record<Layer, GainNode>
  private noiseBuf: AudioBuffer | null = null

  private mood: Mood | null = null
  private cfg: MoodCfg | null = null
  private intensity = 0

  private timer: ReturnType<typeof setInterval> | null = null
  private step = 0 // 0..15 within the bar (16th notes)
  private bar = 0 // index into the mood's chord progression
  private nextTime = 0 // next note's start time on the audio clock
  private padBar = -1 // last bar the pad chord was (re)triggered

  /** Acquire the shared bus + build one gain node per layer (once). */
  private bus(): boolean {
    if (!getPref('music')) return false
    if (this.ctx && this.out) return true
    const b = sfx.musicBus()
    if (!b) return false
    this.ctx = b.ctx
    this.out = b.out
    ;(['bass', 'pad', 'arp', 'drums', 'lead'] as Layer[]).forEach((n) => {
      const g = this.ctx!.createGain()
      g.gain.value = 0
      g.connect(this.out!)
      this.layers[n] = g
    })
    return true
  }

  /** Unlock/resume the audio on a user gesture (call from the first tap). */
  resume() {
    if (!getPref('music')) return
    if (!this.bus()) return
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  /**
   * Start, or crossfade to, a mood. The harmony swaps at once but the per-layer
   * gain ramps (and the tail of already-scheduled notes) keep it smooth.
   */
  play(mood: Mood, intensity = this.intensity) {
    if (!getPref('music')) {
      this.stop()
      return
    }
    if (!this.bus()) return
    this.intensity = clamp01(intensity)
    const fresh = !this.timer
    if (fresh || mood !== this.mood) {
      this.mood = mood
      this.cfg = MOODS[mood]
      this.padBar = -1 // force the pad to retrigger on the new chord
      if (fresh) {
        this.step = 0
        this.bar = 0
        this.nextTime = this.ctx!.currentTime + 0.08
      }
      this.applyTargets()
    }
    if (fresh) this.timer = setInterval(() => this.tick(), 25)
  }

  /** Live mix control — fade layers in/out with the action (0 calm → 1 peak). */
  setIntensity(v: number) {
    const next = clamp01(v)
    if (next === this.intensity) return
    this.intensity = next
    if (this.timer) this.applyTargets()
  }

  /** Fade everything out and stop the scheduler. */
  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const c = this.ctx
    if (c) {
      for (const n of Object.keys(this.layers) as Layer[]) {
        this.layers[n]?.gain.setTargetAtTime(0, c.currentTime, 0.25)
      }
    }
    this.mood = null
    this.cfg = null
  }

  private applyTargets() {
    const c = this.ctx
    const cfg = this.cfg
    if (!c || !cfg) return
    const tg = cfg.target(this.intensity)
    for (const n of Object.keys(tg) as Layer[]) {
      this.layers[n]?.gain.setTargetAtTime(tg[n], c.currentTime, 0.35)
    }
  }

  // ---- scheduler ----
  private tick() {
    const c = this.ctx
    if (!c) return
    if (!getPref('music')) {
      this.stop()
      return
    }
    const cfg = this.cfg
    if (!cfg) return
    const spb = 60 / cfg.bpm / 4 // seconds per 16th note
    while (this.nextTime < c.currentTime + 0.12) {
      const swingOff = this.step % 2 === 1 ? spb * cfg.swing : 0
      this.scheduleStep(this.step, this.bar, this.nextTime + swingOff, spb)
      this.step++
      if (this.step >= 16) {
        this.step = 0
        this.bar = (this.bar + 1) % cfg.prog.length
      }
      this.nextTime += spb
    }
  }

  private scheduleStep(step: number, bar: number, when: number, spb: number) {
    const cfg = this.cfg!
    const chord = cfg.prog[bar]
    const ints = CHORD_INTERVALS[chord.type]
    const i = this.intensity

    // PAD — a sustained triad, retriggered once per chord (bar) with a slow swell
    if (step === 0 && bar !== this.padBar) {
      this.padBar = bar
      const barDur = (60 / cfg.bpm) * 4
      ints.forEach((iv, k) =>
        this.synth(mtof(chord.root + 12 + iv), when, barDur * 1.02, 'sawtooth', k === 0 ? 0.5 : 0.32, 'pad', {
          attack: 0.6,
          release: 0.8,
          cutoff: 1500,
          detune: (k - 1) * 7,
        }),
      )
    }

    // BASS — chord root on every beat; octave pushes on off-beats when intense
    if (step % 4 === 0) {
      this.synth(mtof(chord.root), when, 0.34, 'sawtooth', 0.9, 'bass', {
        attack: 0.005,
        release: 0.08,
        cutoff: 240 + i * 300,
      })
    } else if (step % 2 === 0 && i > 0.5) {
      this.synth(mtof(chord.root + 12), when, 0.11, 'square', 0.45, 'bass', { attack: 0.004, release: 0.05, cutoff: 520 })
    }

    // ARP — a 16th-note arpeggio walking the chord tones (always consonant)
    const pool = ints
    const note = chord.root + 24 + pool[(step + bar * 3) % pool.length] + (step % 8 >= 4 ? 12 : 0)
    this.synth(mtof(note), when, spb * 0.9, 'triangle', 0.5, 'arp', { attack: 0.004, release: 0.09, cutoff: 1900 })

    // DRUMS — kick / snare / hats (their layer gain fades them in with intensity)
    if (step === 0 || step === 8 || (i > 0.4 && (step === 4 || step === 12))) this.kick(when)
    if (step === 4 || step === 12) this.snare(when)
    if (step % 2 === 0) this.hat(when, step % 4 === 0 ? 0.5 : 0.85)

    // LEAD — a sparse melodic motif drawn from the mood's scale
    if (step === 2 || step === 10 || step === 14) {
      const sc = cfg.scale
      const deg = (bar * 2 + (step === 14 ? 4 : step === 10 ? 2 : 0)) % sc.length
      this.synth(mtof(chord.root + 24 + sc[deg]), when, spb * 2, 'sawtooth', 0.5, 'lead', {
        attack: 0.01,
        release: 0.2,
        cutoff: 2400,
      })
    }
  }

  // ---- tiny synths (into a layer bus) ----
  private synth(freq: number, when: number, dur: number, type: OscillatorType, peak: number, layer: Layer, v?: Voice) {
    const c = this.ctx
    const dest = this.layers[layer]
    if (!c || !dest) return
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = freq
    if (v?.detune) o.detune.value = v.detune
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = v?.cutoff ?? 2000
    f.Q.value = v?.q ?? 0.7
    const g = c.createGain()
    const a = v?.attack ?? 0.005
    const r = v?.release ?? 0.1
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), when + a)
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + r)
    o.connect(f).connect(g).connect(dest)
    o.start(when)
    o.stop(when + dur + r + 0.02)
  }

  private noiseSource(): AudioBufferSourceNode | null {
    const c = this.ctx
    if (!c) return null
    if (!this.noiseBuf) {
      const len = Math.floor(c.sampleRate * 0.5)
      const b = c.createBuffer(1, len, c.sampleRate)
      const d = b.getChannelData(0)
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1
      this.noiseBuf = b
    }
    const s = c.createBufferSource()
    s.buffer = this.noiseBuf
    return s
  }

  private kick(when: number) {
    const c = this.ctx
    const dest = this.layers.drums
    if (!c || !dest) return
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150, when)
    o.frequency.exponentialRampToValueAtTime(45, when + 0.12)
    const g = c.createGain()
    g.gain.setValueAtTime(1, when)
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
    o.connect(g).connect(dest)
    o.start(when)
    o.stop(when + 0.2)
  }

  private snare(when: number) {
    const c = this.ctx
    const dest = this.layers.drums
    if (!c || !dest) return
    const s = this.noiseSource()
    if (s) {
      const f = c.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = 1400
      const g = c.createGain()
      g.gain.setValueAtTime(0.7, when)
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.15)
      s.connect(f).connect(g).connect(dest)
      s.start(when)
      s.stop(when + 0.16)
    }
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = 180
    const g2 = c.createGain()
    g2.gain.setValueAtTime(0.4, when)
    g2.gain.exponentialRampToValueAtTime(0.001, when + 0.1)
    o.connect(g2).connect(dest)
    o.start(when)
    o.stop(when + 0.12)
  }

  private hat(when: number, level: number) {
    const c = this.ctx
    const dest = this.layers.drums
    if (!c || !dest) return
    const s = this.noiseSource()
    if (!s) return
    const f = c.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7000
    const g = c.createGain()
    g.gain.setValueAtTime(0.2 * level, when)
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05)
    s.connect(f).connect(g).connect(dest)
    s.start(when)
    s.stop(when + 0.06)
  }
}

/** Shared singleton — one soundtrack across the whole app. */
export const music = new MusicEngine()
