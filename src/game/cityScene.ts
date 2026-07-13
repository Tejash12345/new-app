/**
 * Lion City — the living skyline behind the game hub hero.
 *
 * Pure canvas 2D, zero dependencies. Two inputs drive the whole scene:
 *  - the real clock  → sky colors, sun/moon, stars, window lights, neon,
 *    streetlight cones and car headlights all follow the actual time of day
 *  - the user level  → how much of the skyline has been built so far; each
 *    level reveals more buildings, and the next locked one shows as a
 *    scaffold with a crane so the next unlock is always visible
 *
 * Buildings come from a seeded RNG so the city looks identical on every
 * visit — levelling up reveals the next buildings instead of reshuffling
 * the whole town.
 */

export const CITY_TOTAL_BUILDINGS = 26

/** How many skyline buildings this level has unlocked. */
export function cityUnlocked(level: number) {
  return Math.min(CITY_TOTAL_BUILDINGS, 4 + level * 2)
}

/** First level at which the whole skyline is built. */
export function cityMaxLevel() {
  return Math.ceil((CITY_TOTAL_BUILDINGS - 4) / 2)
}

export type CityOpts = { level: number; streak: number; reducedMotion?: boolean }

// ---------- tiny seeded RNG (mulberry32) ----------
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- color helpers ----------
type RGB = [number, number, number]
function hex(c: string): RGB {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
function css(c: RGB, alpha = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`
}

// sky keyframes across 24h — `dark` (0 day → 1 night) drives lights everywhere
const SKY = [
  { h: 0, top: hex('#050510'), mid: hex('#10102a'), low: hex('#221c48'), dark: 1 },
  { h: 5, top: hex('#050510'), mid: hex('#10102a'), low: hex('#221c48'), dark: 1 },
  { h: 6.5, top: hex('#241a4e'), mid: hex('#7a4a8c'), low: hex('#ff9e6b'), dark: 0.55 },
  { h: 8, top: hex('#3f83cf'), mid: hex('#8fc0e8'), low: hex('#d9ecf8'), dark: 0 },
  { h: 16.5, top: hex('#3f83cf'), mid: hex('#8fc0e8'), low: hex('#d9ecf8'), dark: 0 },
  { h: 18.5, top: hex('#2b1b5e'), mid: hex('#a04c80'), low: hex('#ff8c52'), dark: 0.5 },
  { h: 20.5, top: hex('#050510'), mid: hex('#10102a'), low: hex('#221c48'), dark: 1 },
  { h: 24, top: hex('#050510'), mid: hex('#10102a'), low: hex('#221c48'), dark: 1 },
]

function skyAt(hour: number) {
  let i = 0
  while (i < SKY.length - 2 && hour >= SKY[i + 1].h) i++
  const a = SKY[i]
  const b = SKY[i + 1]
  const t = Math.min(1, Math.max(0, (hour - a.h) / Math.max(0.001, b.h - a.h)))
  return {
    top: mix(a.top, b.top, t),
    mid: mix(a.mid, b.mid, t),
    low: mix(a.low, b.low, t),
    dark: a.dark + (b.dark - a.dark) * t,
  }
}

const NEON_TEXTS = ['ROAR', 'FOCUS', 'XP', 'LION', 'STUDY']
const NEON_COLORS = ['#ff4fa3', '#00e5c3', '#ffb454', '#8f7bff', '#4fd6ff']
const CAR_COLORS = ['#e04a5a', '#4f6bfa', '#f2b544', '#3ec78f', '#c9cdd8']

type Win = { x: number; y: number; s: number }
type Bld = {
  x: number; w: number; h: number
  base: RGB
  wins: Win[]
  neon?: { text: string; color: string; s: number }
  billboard?: boolean
  antenna?: boolean
  tank?: boolean
  order: number
  back: boolean
}

export function startCityScene(canvas: HTMLCanvasElement, opts: CityOpts): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}

  let W = 0
  let H = 0
  let dpr = 1
  let blds: Bld[] = []
  let stars: { x: number; y: number; s: number }[] = []
  let raf = 0
  let running = true
  let visible = true

  // ambient actors
  let car: { x: number; dir: number; speed: number; color: string } | null = null
  let nextCarAt = 2500
  let shoot: { x: number; y: number; t0: number } | null = null
  let nextShootAt = 6000

  const unlocked = cityUnlocked(opts.level)

  function build() {
    const r = rng(20260713) // fixed seed — the city never reshuffles
    blds = []
    const ground = H - 72
    // back row — hazy distant slabs
    let x = -20
    let i = 0
    while (x < W + 20 && i < 12) {
      const w = 46 + r() * 60
      const h = (0.28 + r() * 0.3) * (ground - 30)
      blds.push({ x, w, h, base: hex('#1c1a3f'), wins: [], order: 0, back: true })
      x += w * (0.6 + r() * 0.3)
      i++
    }
    // front row — the real skyline with windows / neon / props
    x = -10
    i = 0
    while (x < W + 10 && i < 14) {
      const w = 58 + r() * 74
      const h = (0.38 + r() * 0.5) * (ground - 30)
      const wins: Win[] = []
      const cols = Math.max(2, Math.floor(w / 15))
      const rows = Math.max(3, Math.floor(h / 19))
      for (let c = 0; c < cols; c++) {
        for (let rr = 0; rr < rows; rr++) {
          wins.push({ x: (c + 0.5) / cols, y: (rr + 0.6) / rows, s: r() })
        }
      }
      const b: Bld = {
        x, w, h, wins, order: 0, back: false,
        base: mix(hex('#241f4a'), hex('#141230'), r()),
        antenna: r() > 0.6,
        tank: r() > 0.55,
      }
      if (i % 4 === 1 && h > (ground - 30) * 0.45) {
        b.neon = {
          text: NEON_TEXTS[i % NEON_TEXTS.length],
          color: NEON_COLORS[i % NEON_COLORS.length],
          s: r(),
        }
      }
      blds.push(b)
      x += w * (0.78 + r() * 0.3)
      i++
    }
    // reveal order — deterministic shuffle so growth is stable across visits
    const order = blds.map((_, k) => k)
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1))
      ;[order[k], order[j]] = [order[j], order[k]]
    }
    order.forEach((idx, rank) => { blds[idx].order = rank })
    // the streak billboard lives on the tallest unlocked front building
    const fronts = blds.filter((b) => !b.back && b.order < unlocked)
    if (fronts.length) {
      fronts.sort((a, b) => b.h - a.h)
      fronts[Math.min(1, fronts.length - 1)].billboard = true
    }
    // stars
    const sr = rng(99)
    stars = Array.from({ length: 70 }, () => ({ x: sr(), y: sr() * 0.55, s: sr() }))
  }

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    dpr = Math.min(2, window.devicePixelRatio || 1)
    W = rect.width
    H = rect.height
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    build()
    if (opts.reducedMotion) draw(performance.now())
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx!.beginPath()
    ctx!.moveTo(x + r, y)
    ctx!.arcTo(x + w, y, x + w, y + h, r)
    ctx!.arcTo(x + w, y + h, x, y + h, r)
    ctx!.arcTo(x, y + h, x, y, r)
    ctx!.arcTo(x, y, x + w, y, r)
    ctx!.closePath()
  }

  function drawLion(gx: number, gy: number, t: number, dark: number) {
    const c = ctx!
    const breath = Math.sin(t * 0.0012) * 1.2
    const blink = t % 4200 < 140
    const body = css(mix(hex('#c08347'), hex('#1a1206'), dark * 0.92))
    const mane = css(mix(hex('#8a5222'), hex('#241505'), dark * 0.9))
    c.save()
    c.translate(gx, gy)
    // tail — swaying, tuft at the end
    c.strokeStyle = body
    c.lineWidth = 5
    c.lineCap = 'round'
    const sway = Math.sin(t * 0.0015) * 7
    c.beginPath()
    c.moveTo(30, -18)
    c.quadraticCurveTo(52, -30 + sway * 0.4, 46 + sway, -52)
    c.stroke()
    c.fillStyle = mane
    c.beginPath()
    c.arc(46 + sway, -54, 5.5, 0, Math.PI * 2)
    c.fill()
    // haunch + body (breathes)
    c.fillStyle = body
    c.beginPath()
    c.ellipse(18, -20, 24, 20 + breath * 0.4, 0, 0, Math.PI * 2)
    c.fill()
    c.beginPath()
    c.ellipse(-4, -26 - breath * 0.5, 28, 17 + breath * 0.5, -0.12, 0, Math.PI * 2)
    c.fill()
    // front legs
    roundRect(-26, -32, 8, 32, 4)
    c.fill()
    roundRect(-16, -30, 8, 30, 4)
    c.fill()
    // mane — spiky ring behind the head
    c.fillStyle = mane
    c.save()
    c.translate(-24, -56 - breath)
    c.beginPath()
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2
      const rr = 19 + (k % 2 === 0 ? 4 : 0)
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    c.closePath()
    c.fill()
    // ears
    c.beginPath()
    c.arc(-8, -16, 5, 0, Math.PI * 2)
    c.arc(8, -17, 5, 0, Math.PI * 2)
    c.fill()
    // head + muzzle
    c.fillStyle = body
    c.beginPath()
    c.arc(0, 0, 12.5, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = css(mix(hex('#e6c497'), hex('#2b1c0c'), dark * 0.85))
    c.beginPath()
    c.ellipse(-7, 4, 7, 5.5, 0, 0, Math.PI * 2)
    c.fill()
    // nose + eye (blinks)
    c.fillStyle = css(mix(hex('#402a15'), hex('#000000'), dark))
    c.beginPath()
    c.arc(-12, 2, 2.2, 0, Math.PI * 2)
    c.fill()
    if (!blink) {
      c.fillStyle = dark > 0.5 ? 'rgba(255,214,140,0.95)' : '#2b1c0c'
      c.beginPath()
      c.arc(-4, -3, 1.8, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
    // warm rim light against the night sky
    if (dark > 0.4) {
      c.strokeStyle = `rgba(255,180,84,${0.35 * dark})`
      c.lineWidth = 1.5
      c.beginPath()
      c.ellipse(-4, -27, 29, 18, -0.12, -Math.PI * 0.9, -Math.PI * 0.1)
      c.stroke()
    }
    c.restore()
  }

  function draw(t: number) {
    const c = ctx!
    const now = new Date()
    const hour = now.getHours() + now.getMinutes() / 60
    const sky = skyAt(hour)
    const dark = sky.dark
    const ground = H - 72

    // sky
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, css(sky.top))
    g.addColorStop(0.55, css(sky.mid))
    g.addColorStop(1, css(sky.low))
    c.fillStyle = g
    c.fillRect(0, 0, W, H)

    // stars — twinkle in, fade with daylight
    if (dark > 0.15) {
      for (const s of stars) {
        const a = dark * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.001 * (0.5 + s.s) + s.s * 20)))
        c.fillStyle = `rgba(255,255,255,${a * 0.8})`
        c.fillRect(s.x * W, s.y * H, s.s > 0.9 ? 2 : 1.3, s.s > 0.9 ? 2 : 1.3)
      }
      // the occasional shooting star
      if (!shoot && t > nextShootAt && dark > 0.7) shoot = { x: 0.15 + Math.random() * 0.6, y: 0.08 + Math.random() * 0.2, t0: t }
      if (shoot) {
        const p = (t - shoot.t0) / 700
        if (p >= 1) { shoot = null; nextShootAt = t + 7000 + Math.random() * 9000 }
        else {
          const sx = shoot.x * W + p * 130
          const sy = shoot.y * H + p * 46
          const grad = c.createLinearGradient(sx - 46, sy - 16, sx, sy)
          grad.addColorStop(0, 'rgba(255,255,255,0)')
          grad.addColorStop(1, `rgba(255,255,255,${0.85 * (1 - p)})`)
          c.strokeStyle = grad
          c.lineWidth = 1.6
          c.beginPath()
          c.moveTo(sx - 46, sy - 16)
          c.lineTo(sx, sy)
          c.stroke()
        }
      }
    }

    // sun / moon on their arcs
    const sunFrac = (hour - 6) / 12
    if (sunFrac > -0.05 && sunFrac < 1.05) {
      const sx = W * (0.12 + 0.76 * sunFrac)
      const sy = H * 0.66 - Math.sin(Math.max(0, Math.min(1, sunFrac)) * Math.PI) * H * 0.48
      const lowSun = Math.abs(sunFrac - 0.5) > 0.34
      const glow = c.createRadialGradient(sx, sy, 4, sx, sy, lowSun ? 70 : 50)
      glow.addColorStop(0, lowSun ? 'rgba(255,150,80,0.95)' : 'rgba(255,238,180,0.95)')
      glow.addColorStop(1, 'rgba(255,180,90,0)')
      c.fillStyle = glow
      c.beginPath()
      c.arc(sx, sy, lowSun ? 70 : 50, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = lowSun ? '#ffb46b' : '#fff3c4'
      c.beginPath()
      c.arc(sx, sy, lowSun ? 17 : 13, 0, Math.PI * 2)
      c.fill()
    }
    const moonFrac = ((hour + 24 - 18) % 24) / 12
    if (moonFrac > -0.05 && moonFrac < 1.05 && dark > 0.25) {
      const mx = W * (0.12 + 0.76 * moonFrac)
      const my = H * 0.6 - Math.sin(Math.max(0, Math.min(1, moonFrac)) * Math.PI) * H * 0.42
      const glow = c.createRadialGradient(mx, my, 4, mx, my, 46)
      glow.addColorStop(0, `rgba(210,225,255,${0.5 * dark})`)
      glow.addColorStop(1, 'rgba(210,225,255,0)')
      c.fillStyle = glow
      c.beginPath()
      c.arc(mx, my, 46, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = `rgba(235,240,255,${0.95 * dark})`
      c.beginPath()
      c.arc(mx, my, 12, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = `rgba(190,200,230,${0.5 * dark})`
      for (const [dx, dy, r] of [[-4, -2, 2.4], [3, 3, 1.7], [4, -4, 1.3]]) {
        c.beginPath()
        c.arc(mx + dx, my + dy, r, 0, Math.PI * 2)
        c.fill()
      }
    }

    // clouds — slow drift, tinted by the sky
    const cloudTint = mix([255, 255, 255], [42, 42, 68], dark)
    for (let k = 0; k < 4; k++) {
      const speed = 6 + k * 3
      const cx = ((t * 0.001 * speed + k * 260) % (W + 240)) - 120
      const cy = H * (0.1 + k * 0.07)
      c.fillStyle = css(cloudTint, 0.4 - dark * 0.14)
      for (const [dx, dy, rw, rh] of [[0, 0, 42, 13], [26, -7, 30, 11], [-26, -4, 26, 10]]) {
        c.beginPath()
        c.ellipse(cx + dx, cy + dy, rw + k * 4, rh, 0, 0, Math.PI * 2)
        c.fill()
      }
    }

    // distant back row — hazy slabs
    for (const b of blds) {
      if (!b.back || b.order >= unlocked) continue
      c.fillStyle = css(mix(b.base, sky.mid, 0.45 - dark * 0.25), 0.9)
      c.fillRect(b.x, ground - b.h, b.w, b.h)
    }

    // dusk haze between the rows
    const haze = c.createLinearGradient(0, ground - H * 0.4, 0, ground)
    haze.addColorStop(0, css(sky.low, 0))
    haze.addColorStop(1, css(sky.low, 0.22))
    c.fillStyle = haze
    c.fillRect(0, ground - H * 0.4, W, H * 0.4)

    // front skyline
    let ghostDrawn = false
    for (const b of blds) {
      if (b.back) continue
      const top = ground - b.h
      if (b.order >= unlocked) {
        // next locked building — scaffold ghost with a crane, labelled with
        // the level that unlocks it
        if (!ghostDrawn && b.order === unlocked) {
          ghostDrawn = true
          c.save()
          c.setLineDash([5, 5])
          c.strokeStyle = `rgba(255,180,84,${0.25 + dark * 0.2})`
          c.lineWidth = 1.5
          c.strokeRect(b.x + 0.5, top + 0.5, b.w, b.h)
          for (let yy = top + b.h / 4; yy < ground; yy += b.h / 4) {
            c.beginPath()
            c.moveTo(b.x, yy)
            c.lineTo(b.x + b.w, yy)
            c.stroke()
          }
          c.setLineDash([])
          // crane
          const mastX = b.x + b.w - 8
          c.strokeStyle = `rgba(255,180,84,${0.5 + dark * 0.3})`
          c.beginPath()
          c.moveTo(mastX, ground)
          c.lineTo(mastX, top - 34)
          c.lineTo(mastX - b.w * 0.8, top - 34)
          c.moveTo(mastX - b.w * 0.5, top - 34)
          c.lineTo(mastX - b.w * 0.5, top - 12)
          c.stroke()
          c.fillStyle = `rgba(255,180,84,${0.75 + dark * 0.2})`
          c.font = '700 10px Inter, sans-serif'
          c.textAlign = 'center'
          c.fillText(`LV ${Math.ceil((b.order + 1 - 4) / 2)}`, mastX - b.w * 0.5, top - 2)
          c.restore()
        }
        continue
      }
      // body — slightly lighter toward the lit side
      const bg = c.createLinearGradient(b.x, 0, b.x + b.w, 0)
      bg.addColorStop(0, css(mix(b.base, [0, 0, 0], 0.25)))
      bg.addColorStop(1, css(mix(b.base, sky.low, 0.2 - dark * 0.12)))
      c.fillStyle = bg
      c.fillRect(b.x, top, b.w, b.h)
      // windows — warm and flickering at night, cool glass by day
      for (const wnd of b.wins) {
        const wx = b.x + wnd.x * b.w - 2.6
        const wy = top + wnd.y * b.h - 3.4
        const lit = wnd.s < dark * 0.62
        if (lit) {
          const fl = 0.72 + 0.28 * Math.sin(t * 0.003 + wnd.s * 40)
          c.fillStyle = `rgba(255,196,110,${dark * fl})`
        } else {
          c.fillStyle = dark > 0.5 ? 'rgba(12,14,30,0.85)' : 'rgba(22,32,64,0.28)'
        }
        c.fillRect(wx, wy, 5.2, 6.8)
      }
      // rooftop props
      c.fillStyle = css(mix(b.base, [0, 0, 0], 0.35))
      if (b.tank) {
        c.fillRect(b.x + b.w * 0.14, top - 10, 12, 10)
        c.fillRect(b.x + b.w * 0.14 - 2, top - 11, 16, 2.5)
      }
      if (b.antenna) {
        c.fillRect(b.x + b.w * 0.72, top - 20, 2, 20)
        // aircraft warning beacon
        const bl = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.0022 + b.x))
        c.fillStyle = `rgba(255,70,70,${bl * (0.3 + dark * 0.7)})`
        c.beginPath()
        c.arc(b.x + b.w * 0.72 + 1, top - 22, 2.4, 0, Math.PI * 2)
        c.fill()
      }
      // neon sign — vertical, glowing, occasionally flickering
      if (b.neon && dark > 0.25) {
        const flick = Math.sin(t * 0.011 + b.neon.s * 90) > -0.92 ? 1 : 0.25
        const a = dark * flick
        c.save()
        c.font = '900 13px "Arial Black", Inter, sans-serif'
        c.textAlign = 'center'
        c.shadowColor = b.neon.color
        c.shadowBlur = 12
        c.fillStyle = b.neon.color
        c.globalAlpha = a
        const chars = b.neon.text.split('')
        chars.forEach((ch, ci) => {
          c.fillText(ch, b.x + b.w / 2, top + 22 + ci * 15)
        })
        c.restore()
      }
      // streak billboard
      if (b.billboard) {
        const bw = Math.min(96, b.w + 26)
        // keep the panel on-screen even when its tower hugs a canvas edge
        const bx = Math.min(Math.max(6, b.x + b.w / 2 - bw / 2), W - bw - 6)
        const by = top - 44
        c.fillStyle = css(mix(hex('#0d0b1c'), [0, 0, 0], 0.2), 0.95)
        roundRect(bx, by, bw, 34, 5)
        c.fill()
        c.strokeStyle = `rgba(255,180,84,${0.5 + dark * 0.4})`
        c.lineWidth = 1.5
        c.stroke()
        c.fillRect(b.x + b.w / 2 - 1.5, by + 34, 3, 10)
        c.textAlign = 'center'
        c.font = '900 14px "Arial Black", Inter, sans-serif'
        c.fillStyle = '#ffb454'
        if (dark > 0.3) {
          c.shadowColor = '#ffb454'
          c.shadowBlur = 10
        }
        c.fillText(`🔥 ${opts.streak}`, bx + bw / 2, by + 16)
        c.shadowBlur = 0
        c.font = '700 7.5px Inter, sans-serif'
        c.fillStyle = 'rgba(255,255,255,0.75)'
        c.fillText('DAY STREAK', bx + bw / 2, by + 27)
      }
    }

    // road
    c.fillStyle = css(mix(hex('#3a3f52'), hex('#131120'), dark))
    c.fillRect(0, ground, W, H - ground)
    c.fillStyle = css(mix(hex('#525a70'), hex('#1c1930'), dark))
    c.fillRect(0, ground, W, 8)
    // lane dashes
    c.fillStyle = `rgba(255,190,90,${0.5 + dark * 0.3})`
    for (let lx = 8; lx < W; lx += 46) c.fillRect(lx, ground + 34, 22, 3)

    // streetlights — cones only once it's dark
    for (const fx of [0.16, 0.46, 0.74]) {
      const px = W * fx
      c.fillStyle = css(mix(hex('#2b3040'), hex('#0d0c18'), dark))
      c.fillRect(px, ground - 52, 3, 52)
      c.fillRect(px, ground - 54, 14, 3)
      if (dark > 0.25) {
        const lg = c.createLinearGradient(px + 12, ground - 50, px + 12, ground + 20)
        lg.addColorStop(0, `rgba(255,214,140,${0.5 * dark})`)
        lg.addColorStop(1, 'rgba(255,214,140,0)')
        c.fillStyle = lg
        c.beginPath()
        c.moveTo(px + 12, ground - 50)
        c.lineTo(px - 12, ground + 20)
        c.lineTo(px + 36, ground + 20)
        c.closePath()
        c.fill()
        c.fillStyle = `rgba(255,226,160,${0.85 * dark + 0.1})`
        c.beginPath()
        c.arc(px + 13, ground - 51, 3, 0, Math.PI * 2)
        c.fill()
      }
    }

    // a car passes by now and then — headlights sweep at night
    if (!car && t > nextCarAt) {
      const dir = Math.random() > 0.5 ? 1 : -1
      car = {
        dir,
        x: dir === 1 ? -70 : W + 70,
        speed: 150 + Math.random() * 90,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      }
    }
    if (car) {
      car.x += car.dir * car.speed * 0.016
      if (car.x < -90 || car.x > W + 90) {
        car = null
        nextCarAt = t + 7000 + Math.random() * 9000
      } else {
        const cy = ground + 26
        if (dark > 0.3) {
          const hx = car.x + car.dir * 24
          const hg = c.createLinearGradient(hx, cy, hx + car.dir * 84, cy)
          hg.addColorStop(0, `rgba(255,240,190,${0.45 * dark})`)
          hg.addColorStop(1, 'rgba(255,240,190,0)')
          c.fillStyle = hg
          c.beginPath()
          c.moveTo(hx, cy - 2)
          c.lineTo(hx + car.dir * 84, cy - 13)
          c.lineTo(hx + car.dir * 84, cy + 11)
          c.closePath()
          c.fill()
        }
        c.fillStyle = car.color
        roundRect(car.x - 24, cy - 9, 48, 12, 5)
        c.fill()
        roundRect(car.x - 13, cy - 17, 25, 10, 4)
        c.fill()
        c.fillStyle = '#0c0c14'
        c.beginPath()
        c.arc(car.x - 13, cy + 4, 4.6, 0, Math.PI * 2)
        c.arc(car.x + 13, cy + 4, 4.6, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = `rgba(255,60,60,${0.4 + dark * 0.6})`
        c.fillRect(car.x - car.dir * 25, cy - 7, 2.5, 4)
      }
    }

    // hill + acacia + the lion, watching the city grow
    const hillX = W - 210
    c.fillStyle = css(mix(hex('#3c6b3f'), hex('#0e1410'), dark * 0.92))
    c.beginPath()
    c.moveTo(hillX, H)
    c.quadraticCurveTo(W - 100, ground - 66, W + 40, H)
    c.closePath()
    c.fill()
    // acacia tree — flat crown on a forked trunk
    const tx = W - 168
    const ty = ground - 8
    c.strokeStyle = css(mix(hex('#4a3220'), hex('#0a0805'), dark * 0.9))
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(tx, ty)
    c.lineTo(tx + 6, ty - 34)
    c.moveTo(tx + 6, ty - 22)
    c.lineTo(tx - 8, ty - 40)
    c.moveTo(tx + 6, ty - 26)
    c.lineTo(tx + 18, ty - 42)
    c.stroke()
    c.fillStyle = css(mix(hex('#4f7a42'), hex('#101a10'), dark * 0.9))
    c.beginPath()
    c.ellipse(tx + 5, ty - 47, 30, 9, 0, 0, Math.PI * 2)
    c.fill()
    drawLion(W - 96, ground - 22, t, dark)

    // soft vignette to seat the HUD
    const vg = c.createLinearGradient(0, 0, 0, H)
    vg.addColorStop(0, 'rgba(5,5,16,0.34)')
    vg.addColorStop(0.25, 'rgba(5,5,16,0)')
    vg.addColorStop(0.78, 'rgba(5,5,16,0)')
    vg.addColorStop(1, 'rgba(5,5,16,0.4)')
    c.fillStyle = vg
    c.fillRect(0, 0, W, H)
  }

  // ~30fps is plenty for an ambient scene and kind to phone batteries
  let last = 0
  function loop(t: number) {
    if (!running) return
    raf = requestAnimationFrame(loop)
    if (!visible || t - last < 30) return
    last = t
    draw(t)
  }

  const ro = new ResizeObserver(resize)
  if (canvas.parentElement) ro.observe(canvas.parentElement)
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
  io.observe(canvas)
  resize()
  if (!opts.reducedMotion) raf = requestAnimationFrame(loop)

  return () => {
    running = false
    cancelAnimationFrame(raf)
    ro.disconnect()
    io.disconnect()
  }
}
