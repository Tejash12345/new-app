/**
 * Lion Run — the endless-runner mini-game inside Lion City.
 *
 * Night sprint across the city: tap to jump (double-tap for a double jump),
 * vault the roadworks, grab amber XP orbs. Speed ramps up forever; one hit
 * and you're WASTED. Pure canvas 2D, no dependencies.
 *
 * The engine only runs the game — plays, XP awards and the game-over screen
 * are the page's job via the callbacks.
 */

export type RunResult = { score: number; coins: number; distanceM: number }

export type RunHandle = { destroy: () => void }

type Obstacle = { x: number; w: number; h: number; kind: 'cone' | 'crate' | 'stack' | 'barrier' }
type Coin = { x: number; y: number; got: boolean }

export function startLionRun(
  canvas: HTMLCanvasElement,
  cb: { onStart: () => void; onOver: (r: RunResult) => void },
): RunHandle {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { destroy: () => {} }

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const GY = H - 46 // ground line
  const LX = Math.max(56, W * 0.16) // lion anchor x

  let state: 'ready' | 'run' | 'dead' = 'ready'
  let raf = 0
  let lastT = 0
  let dist = 0
  let speed = 300
  let vy = 0
  let ly = GY // lion baseline y (feet)
  let jumps = 0
  let coins = 0
  let flash = 0
  let elapsed = 0

  let obstacles: Obstacle[] = []
  let coinList: Coin[] = []
  let nextObsAt = 460
  let nextCoinAt = 300

  // far skyline drawn once, then scrolled and wrapped — cheap parallax
  const skyline = document.createElement('canvas')
  skyline.width = Math.round(W * dpr)
  skyline.height = Math.round(120 * dpr)
  {
    const s = skyline.getContext('2d')!
    s.setTransform(dpr, 0, 0, dpr, 0, 0)
    let x = 0
    let i = 0
    while (x < W) {
      const bw = 34 + ((i * 53) % 48)
      const bh = 34 + ((i * 37) % 74)
      s.fillStyle = i % 2 ? '#171536' : '#1d1a42'
      s.fillRect(x, 120 - bh, bw, bh)
      s.fillStyle = 'rgba(255,196,110,0.75)'
      for (let k = 0; k < 5; k++) {
        if ((i * 7 + k * 13) % 3 === 0) {
          s.fillRect(x + 5 + (k % 3) * 9, 120 - bh + 8 + Math.floor(k / 3) * 14, 3.4, 4.6)
        }
      }
      x += bw + 8
      i++
    }
  }

  const stars = Array.from({ length: 40 }, (_, i) => ({
    x: ((i * 97) % 100) / 100,
    y: ((i * 61) % 55) / 100,
    s: ((i * 31) % 10) / 10,
  }))

  function jump() {
    if (state === 'ready') {
      state = 'run'
      cb.onStart()
      return
    }
    if (state !== 'run') return
    if (jumps < 2) {
      vy = jumps === 0 ? -760 : -640
      jumps++
      navigator.vibrate?.(12)
    }
  }

  function onPointer(e: PointerEvent) {
    e.preventDefault()
    jump()
  }
  function onKey(e: KeyboardEvent) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault()
      jump()
    }
  }
  canvas.addEventListener('pointerdown', onPointer)
  window.addEventListener('keydown', onKey)

  function spawn() {
    if (dist > nextObsAt) {
      const kinds: Obstacle['kind'][] = ['cone', 'crate', 'stack', 'barrier']
      // taller stacks only appear once the run is fast enough to double jump
      const kind = kinds[Math.floor(Math.random() * (elapsed > 12 ? 4 : 3))]
      const dims = { cone: [26, 32], crate: [34, 34], barrier: [58, 26], stack: [34, 62] }[kind]
      obstacles.push({ x: W + 60, w: dims[0], h: dims[1], kind })
      nextObsAt = dist + 300 + Math.random() * 330 + speed * 0.25
    }
    if (dist > nextCoinAt) {
      const n = 3 + Math.floor(Math.random() * 3)
      const baseY = GY - 74 - Math.random() * 66
      for (let k = 0; k < n; k++) {
        coinList.push({ x: W + 60 + k * 34, y: baseY + Math.sin(k * 0.9) * 12, got: false })
      }
      nextCoinAt = dist + 520 + Math.random() * 480
    }
  }

  function score() {
    return Math.floor(dist / 8) + coins * 10
  }

  function drawLion(t: number) {
    const c = ctx!
    const airborne = ly < GY - 1
    const gallop = Math.sin(t * 0.022)
    c.save()
    c.translate(LX, ly)
    // tail
    c.strokeStyle = '#191009'
    c.lineWidth = 5
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(-24, -26)
    c.quadraticCurveTo(-40, -34 + gallop * 3, -44, -46)
    c.stroke()
    c.fillStyle = '#ffb454'
    c.beginPath()
    c.arc(-44, -48, 4.5, 0, Math.PI * 2)
    c.fill()
    // legs — alternating gallop, tucked when airborne
    c.strokeStyle = '#191009'
    c.lineWidth = 7
    const legSwing = airborne ? 0.4 : gallop
    for (const [ox, ph] of [[-16, 0], [-8, Math.PI], [10, Math.PI * 0.9], [17, Math.PI * 1.9]]) {
      const a = Math.sin(t * 0.022 + ph) * (airborne ? 0.25 : 0.6)
      c.beginPath()
      c.moveTo(ox, -22)
      c.lineTo(ox + a * 14, -2 + Math.abs(legSwing) * (airborne ? -6 : 0))
      c.stroke()
    }
    // body
    c.fillStyle = '#241708'
    c.beginPath()
    c.ellipse(0, -28, 27, 14, airborne ? -0.18 : -0.06, 0, Math.PI * 2)
    c.fill()
    // mane + head — facing right, into the run
    c.fillStyle = '#ffb454'
    c.save()
    c.translate(24, -38)
    c.beginPath()
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      c.lineTo(Math.cos(a) * (15 + (k % 2) * 3.4), Math.sin(a) * (15 + (k % 2) * 3.4))
    }
    c.closePath()
    c.fill()
    c.fillStyle = '#241708'
    c.beginPath()
    c.arc(2, 0, 10, 0, Math.PI * 2)
    c.fill()
    // muzzle + eye
    c.fillStyle = '#e6c497'
    c.beginPath()
    c.ellipse(8, 3, 5.5, 4.4, 0, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#fff'
    c.beginPath()
    c.arc(5, -3, 2, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#000'
    c.beginPath()
    c.arc(5.7, -3, 1, 0, Math.PI * 2)
    c.fill()
    c.restore()
    c.restore()
  }

  function drawObstacle(o: Obstacle) {
    const c = ctx!
    const y = GY - o.h
    if (o.kind === 'cone') {
      c.fillStyle = '#ff7b3a'
      c.beginPath()
      c.moveTo(o.x + o.w / 2, y)
      c.lineTo(o.x + o.w, GY)
      c.lineTo(o.x, GY)
      c.closePath()
      c.fill()
      c.fillStyle = '#fff'
      c.fillRect(o.x + o.w * 0.28, y + o.h * 0.42, o.w * 0.44, 5)
    } else if (o.kind === 'barrier') {
      c.fillStyle = '#2a2438'
      c.fillRect(o.x + 3, y + 8, 5, o.h - 8)
      c.fillRect(o.x + o.w - 8, y + 8, 5, o.h - 8)
      // hazard stripes
      c.save()
      c.beginPath()
      c.rect(o.x, y, o.w, 14)
      c.clip()
      for (let sx = -14; sx < o.w + 14; sx += 14) {
        c.fillStyle = sx % 28 === 0 ? '#ffb454' : '#191024'
        c.beginPath()
        c.moveTo(o.x + sx, y + 14)
        c.lineTo(o.x + sx + 14, y)
        c.lineTo(o.x + sx + 28, y)
        c.lineTo(o.x + sx + 14, y + 14)
        c.closePath()
        c.fill()
      }
      c.restore()
    } else {
      // crate / stack of crates
      const n = o.kind === 'stack' ? 2 : 1
      for (let k = 0; k < n; k++) {
        const cy = GY - (k + 1) * (o.h / n)
        c.fillStyle = k % 2 ? '#8a5a2e' : '#7a4e26'
        c.fillRect(o.x, cy, o.w, o.h / n)
        c.strokeStyle = 'rgba(0,0,0,0.35)'
        c.lineWidth = 2
        c.strokeRect(o.x + 1, cy + 1, o.w - 2, o.h / n - 2)
        c.beginPath()
        c.moveTo(o.x, cy)
        c.lineTo(o.x + o.w, cy + o.h / n)
        c.stroke()
      }
    }
  }

  function draw(t: number) {
    const c = ctx!
    // night sky
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#07061a')
    g.addColorStop(0.7, '#181233')
    g.addColorStop(1, '#241d49')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)
    for (const s of stars) {
      c.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * Math.abs(Math.sin(t * 0.001 + s.s * 9))})`
      c.fillRect(s.x * W, s.y * H, s.s > 0.8 ? 2 : 1.2, s.s > 0.8 ? 2 : 1.2)
    }
    // moon
    c.fillStyle = 'rgba(235,240,255,0.9)'
    c.beginPath()
    c.arc(W * 0.82, H * 0.16, 11, 0, Math.PI * 2)
    c.fill()
    // far skyline (wrapped scroll at quarter speed)
    const off = (dist * 0.25) % W
    c.drawImage(skyline, -off, GY - 130, W, 120)
    c.drawImage(skyline, W - off, GY - 130, W, 120)
    // road
    c.fillStyle = '#131120'
    c.fillRect(0, GY, W, H - GY)
    c.fillStyle = '#1e1b30'
    c.fillRect(0, GY, W, 6)
    c.fillStyle = 'rgba(255,190,90,0.7)'
    for (let lx = -((dist % 46)); lx < W; lx += 46) c.fillRect(lx, GY + 22, 22, 3)

    for (const o of obstacles) drawObstacle(o)
    for (const cn of coinList) {
      if (cn.got) continue
      const pulse = 1 + Math.sin(t * 0.008 + cn.x) * 0.12
      const cg = c.createRadialGradient(cn.x, cn.y, 1, cn.x, cn.y, 13 * pulse)
      cg.addColorStop(0, 'rgba(255,214,120,0.95)')
      cg.addColorStop(0.5, 'rgba(255,180,84,0.6)')
      cg.addColorStop(1, 'rgba(255,180,84,0)')
      c.fillStyle = cg
      c.beginPath()
      c.arc(cn.x, cn.y, 13 * pulse, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#ffd678'
      c.beginPath()
      c.arc(cn.x, cn.y, 5.5, 0, Math.PI * 2)
      c.fill()
    }

    drawLion(t)

    // HUD — GTA money-green score, amber coins
    c.textAlign = 'right'
    c.font = '900 20px "Consolas", "Courier New", monospace'
    c.fillStyle = 'rgba(0,0,0,0.45)'
    c.fillText(String(score()).padStart(6, '0'), W - 15, 31)
    c.fillStyle = '#7dff9c'
    c.fillText(String(score()).padStart(6, '0'), W - 16, 30)
    c.font = '900 13px "Consolas", monospace'
    c.fillStyle = '#ffd678'
    c.fillText(`● ${coins}`, W - 16, 50)

    if (state === 'ready') {
      c.textAlign = 'center'
      c.fillStyle = 'rgba(255,255,255,0.92)'
      c.font = '900 22px "Arial Black", Inter, sans-serif'
      c.fillText('TAP TO RUN', W / 2, H * 0.42)
      c.font = '600 12px Inter, sans-serif'
      c.fillStyle = 'rgba(255,255,255,0.6)'
      c.fillText('tap = jump · tap again = double jump', W / 2, H * 0.42 + 22)
    }

    // crash flash
    if (flash > 0) {
      c.fillStyle = `rgba(200,20,30,${flash * 0.5})`
      c.fillRect(0, 0, W, H)
    }
  }

  function step(t: number) {
    raf = requestAnimationFrame(step)
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016)
    lastT = t

    if (state === 'run') {
      elapsed += dt
      speed = Math.min(640, 300 + elapsed * 9)
      dist += speed * dt
      // physics
      vy += 2350 * dt
      ly += vy * dt
      if (ly >= GY) {
        ly = GY
        vy = 0
        jumps = 0
      }
      spawn()
      for (const o of obstacles) o.x -= speed * dt
      for (const cn of coinList) cn.x -= speed * dt
      obstacles = obstacles.filter((o) => o.x > -90)
      coinList = coinList.filter((cn) => cn.x > -40 && !cn.got)
      // coin pickup — generous circle around the lion's chest
      for (const cn of coinList) {
        const dx = cn.x - LX
        const dy = cn.y - (ly - 30)
        if (dx * dx + dy * dy < 30 * 30) {
          cn.got = true
          coins++
          navigator.vibrate?.(8)
        }
      }
      // collision — AABB with a forgiving margin so near-misses feel heroic
      const lx0 = LX - 18
      const lx1 = LX + 26
      const ly0 = ly - 46
      const ly1 = ly - 4
      for (const o of obstacles) {
        const ox0 = o.x + 5
        const ox1 = o.x + o.w - 5
        const oy0 = GY - o.h + 6
        if (lx1 > ox0 && lx0 < ox1 && ly1 > oy0 && ly0 < GY) {
          state = 'dead'
          flash = 1
          navigator.vibrate?.([60, 40, 120])
          const r: RunResult = { score: score(), coins, distanceM: Math.round(dist / 40) }
          // let the crash flash land before handing over to the WASTED screen
          setTimeout(() => cb.onOver(r), 550)
          break
        }
      }
    }
    if (state === 'dead') flash = Math.max(0, flash - dt * 1.6)
    draw(t)
  }
  raf = requestAnimationFrame(step)

  return {
    destroy: () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    },
  }
}
