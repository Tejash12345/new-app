/**
 * Lion City in 3D — the three.js skyline behind the game hub hero.
 *
 * Same rules as the 2D fallback (cityScene.ts): the real clock drives the
 * sky, lights, neon and headlights; the user level decides how many
 * buildings have been built. The city grows outward from the plaza where
 * the low-poly lion sits, and the next locked building shows as an amber
 * wireframe with a crane so the next unlock is always visible.
 *
 * Camera slowly orbits on its own; a horizontal drag steers it (vertical
 * pans stay with the page scroll — the canvas is touch-action: pan-y).
 * Returns null if WebGL isn't available so the caller can fall back to 2D.
 */
import * as THREE from 'three'
import { CITY_TOTAL_BUILDINGS, cityUnlocked, type CityOpts } from './cityScene'

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

// sky keyframes across 24h — `dark` (0 day → 1 night) drives every light
const SKY = [
  { h: 0, top: 0x050510, low: 0x221c48, dark: 1 },
  { h: 5, top: 0x050510, low: 0x221c48, dark: 1 },
  { h: 6.5, top: 0x241a4e, low: 0xff9e6b, dark: 0.55 },
  { h: 8, top: 0x3f83cf, low: 0xd9ecf8, dark: 0 },
  { h: 16.5, top: 0x3f83cf, low: 0xd9ecf8, dark: 0 },
  { h: 18.5, top: 0x2b1b5e, low: 0xff8c52, dark: 0.5 },
  { h: 20.5, top: 0x050510, low: 0x221c48, dark: 1 },
  { h: 24, top: 0x050510, low: 0x221c48, dark: 1 },
]
function skyAt(hour: number) {
  let i = 0
  while (i < SKY.length - 2 && hour >= SKY[i + 1].h) i++
  const a = SKY[i]
  const b = SKY[i + 1]
  const t = Math.min(1, Math.max(0, (hour - a.h) / Math.max(0.001, b.h - a.h)))
  return {
    top: new THREE.Color(a.top).lerp(new THREE.Color(b.top), t),
    low: new THREE.Color(a.low).lerp(new THREE.Color(b.low), t),
    dark: a.dark + (b.dark - a.dark) * t,
  }
}

// ---------- canvas textures ----------
/** Facade (day) + lit-window (night emissive) texture pair. */
function facadeTextures(seed: number, tint: string) {
  const r = rng(seed)
  const day = document.createElement('canvas')
  const night = document.createElement('canvas')
  day.width = night.width = 64
  day.height = night.height = 128
  const d = day.getContext('2d')!
  const n = night.getContext('2d')!
  d.fillStyle = tint
  d.fillRect(0, 0, 64, 128)
  n.fillStyle = '#000'
  n.fillRect(0, 0, 64, 128)
  for (let c = 0; c < 4; c++) {
    for (let rw = 0; rw < 9; rw++) {
      const x = 7 + c * 14
      const y = 8 + rw * 13
      d.fillStyle = 'rgba(14,20,42,0.85)'
      d.fillRect(x, y, 9, 8)
      if (r() < 0.55) {
        n.fillStyle = `rgba(255,255,255,${0.55 + r() * 0.45})`
        n.fillRect(x, y, 9, 8)
      }
    }
  }
  const dt = new THREE.CanvasTexture(day)
  const nt = new THREE.CanvasTexture(night)
  dt.colorSpace = THREE.SRGBColorSpace
  return { map: dt, emissiveMap: nt }
}

function textSprite(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 128) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  draw(cv.getContext('2d')!, w, h)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false })
  return new THREE.Sprite(mat)
}

function glowSprite(color: string, size: number) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const c = cv.getContext('2d')!
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 64, 64)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  sp.scale.setScalar(size)
  return sp
}

export function startCity3D(canvas: HTMLCanvasElement, opts: CityOpts): (() => void) | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1))

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x0, 130, 320)
  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 600)

  const unlocked = cityUnlocked(opts.level)
  const r = rng(20260713)
  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x }

  // ---------- sky dome (vertex-color gradient, re-tinted as the clock moves) ----------
  const domeGeo = track(new THREE.SphereGeometry(230, 24, 12))
  const domeCount = domeGeo.attributes.position.count
  domeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(domeCount * 3), 3))
  const domeMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }))
  scene.add(new THREE.Mesh(domeGeo, domeMat))
  function tintDome(top: THREE.Color, low: THREE.Color) {
    const pos = domeGeo.attributes.position
    const col = domeGeo.attributes.color
    const c = new THREE.Color()
    for (let i = 0; i < domeCount; i++) {
      const t = Math.max(0, Math.min(1, pos.getY(i) / 160))
      c.copy(low).lerp(top, t)
      col.setXYZ(i, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }

  // ---------- lights ----------
  const ambient = new THREE.AmbientLight(0xffffff, 0.8)
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.1)
  sun.position.set(60, 90, 40)
  const plazaLamp = new THREE.PointLight(0xffc46e, 0, 60, 1.6)
  plazaLamp.position.set(0, 10, 0)
  scene.add(ambient, sun, plazaLamp)

  // ---------- ground + avenues ----------
  const ground = new THREE.Mesh(
    track(new THREE.CircleGeometry(170, 40)),
    track(new THREE.MeshLambertMaterial({ color: 0x191723 })),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  const roadMat = track(new THREE.MeshLambertMaterial({ color: 0x121019 }))
  for (const rot of [0, Math.PI / 2]) {
    const road = new THREE.Mesh(track(new THREE.PlaneGeometry(320, 8)), roadMat)
    road.rotation.set(-Math.PI / 2, 0, rot)
    road.position.y = 0.04
    scene.add(road)
  }
  const dashMat = track(new THREE.MeshBasicMaterial({ color: 0xffb454 }))
  const dashGeo = track(new THREE.PlaneGeometry(2.2, 0.4))
  for (let i = -12; i <= 12; i++) {
    if (Math.abs(i) < 2) continue
    for (const rot of [0, Math.PI / 2]) {
      const dash = new THREE.Mesh(dashGeo, dashMat)
      dash.rotation.set(-Math.PI / 2, 0, rot)
      dash.position.set(rot === 0 ? i * 12 : 0, 0.06, rot === 0 ? 0 : i * 12)
      scene.add(dash)
    }
  }

  // ---------- buildings (city grows outward from the plaza) ----------
  // daylight-plausible concrete and glass tones — the day/night ambient
  // lighting darkens them into silhouettes after sunset on its own
  const FACADES = ['#8d92b0', '#a3a0bd', '#7e84a6', '#b3aca4', '#95a2bd']
  const texSets = FACADES.map((tint, i) => facadeTextures(500 + i, tint))
  texSets.forEach((s) => { track(s.map); track(s.emissiveMap) })

  type Bld = {
    mesh: THREE.Mesh
    h: number
    order: number
    mats: THREE.MeshLambertMaterial[]
  }
  const blds: Bld[] = []
  const spots: { x: number; z: number; d: number }[] = []
  for (const gx of [-2, -1, 1, 2]) {
    for (const gz of [-2, -1, 1, 2]) {
      spots.push({ x: gx * 13 + (r() - 0.5) * 3, z: gz * 13 + (r() - 0.5) * 3, d: Math.hypot(gx, gz) })
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + r() * 0.4
    const rad = 42 + r() * 14
    spots.push({ x: Math.cos(a) * rad, z: Math.sin(a) * rad, d: 4 + r() })
  }
  spots.sort((a, b) => a.d - b.d)

  const beacons: THREE.Mesh[] = []
  const padGeo = track(new THREE.BoxGeometry(1, 1, 1))
  const padMat = track(new THREE.MeshLambertMaterial({ color: 0x232030 }))
  spots.slice(0, CITY_TOTAL_BUILDINGS).forEach((s, order) => {
    const w = 5.5 + r() * 3
    const dep = 5.5 + r() * 3
    // tallest towers cluster around the plaza, the skyline tapers outward
    const h = 6 + r() * 10 + 26 / (1 + s.d)
    if (order >= unlocked) return // locked — ghost handled below
    const set = texSets[order % texSets.length]
    const side = new THREE.MeshLambertMaterial({
      map: set.map,
      emissive: new THREE.Color(0xffc46e),
      emissiveMap: set.emissiveMap,
      emissiveIntensity: 0,
    })
    const roof = new THREE.MeshLambertMaterial({ color: 0x3f3d55 })
    track(side)
    track(roof)
    const geo = track(new THREE.BoxGeometry(w, h, dep))
    const mesh = new THREE.Mesh(geo, [side, side, roof, roof, side, side])
    mesh.position.set(s.x, h / 2, s.z)
    scene.add(mesh)
    blds.push({ mesh, h, order, mats: [side] })
    // sidewalk pad
    const pad = new THREE.Mesh(padGeo, padMat)
    pad.scale.set(w + 2, 0.5, dep + 2)
    pad.position.set(s.x, 0.25, s.z)
    scene.add(pad)
    // rooftop props
    if (r() > 0.5) {
      const tank = new THREE.Mesh(padGeo, padMat)
      tank.scale.set(1.6, 1.6, 1.6)
      tank.position.set(s.x + w * 0.25, h + 0.8, s.z)
      mesh.userData.props = [tank, pad]
      scene.add(tank)
    }
    if (r() > 0.55) {
      const mastGeo = track(new THREE.CylinderGeometry(0.09, 0.09, 3))
      const mast = new THREE.Mesh(mastGeo, padMat)
      mast.position.set(s.x - w * 0.2, h + 1.5, s.z)
      scene.add(mast)
      const beacon = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.28)),
        track(new THREE.MeshBasicMaterial({ color: 0xff4646, transparent: true })),
      )
      beacon.position.set(s.x - w * 0.2, h + 3.1, s.z)
      scene.add(beacon)
      beacons.push(beacon)
    }
  })

  // ghost of the next building — amber wireframe + crane + level tag
  let craneGroup: THREE.Group | null = null
  if (unlocked < CITY_TOTAL_BUILDINGS) {
    const s = spots[unlocked]
    const gw = 6.5
    const gh = 6 + 5 + 26 / (1 + s.d)
    craneGroup = new THREE.Group()
    const edges = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(track(new THREE.BoxGeometry(gw, gh, gw)))),
      track(new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.5 })),
    )
    edges.position.y = gh / 2
    craneGroup.add(edges)
    const mastGeo = track(new THREE.BoxGeometry(0.4, gh + 7, 0.4))
    const craneMat = track(new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.8 }))
    const mast = new THREE.Mesh(mastGeo, craneMat)
    mast.position.set(gw * 0.7, (gh + 7) / 2, 0)
    craneGroup.add(mast)
    const jib = new THREE.Mesh(track(new THREE.BoxGeometry(gw * 1.6, 0.4, 0.4)), craneMat)
    jib.position.set(0, gh + 6.8, 0)
    craneGroup.add(jib)
    const tag = textSprite((c, w2, h2) => {
      c.font = '900 44px "Arial Black", sans-serif'
      c.textAlign = 'center'
      c.fillStyle = '#ffb454'
      c.shadowColor = '#ffb454'
      c.shadowBlur = 18
      c.fillText(`LV ${opts.level + 1}`, w2 / 2, h2 / 2 + 16)
    })
    tag.scale.set(9, 4.5, 1)
    tag.position.set(0, gh + 10.5, 0)
    craneGroup.add(tag)
    craneGroup.position.set(s.x, 0, s.z)
    scene.add(craneGroup)
  }

  // neon signs on the three tallest towers
  const neonDefs = [
    { text: 'FOCUS', color: '#ff4fa3' },
    { text: 'LION', color: '#00e5c3' },
    { text: 'ROAR', color: '#8f7bff' },
  ]
  const neons: THREE.Sprite[] = []
  const tallest = [...blds].sort((a, b) => b.h - a.h).slice(0, 3)
  tallest.forEach((b, i) => {
    const def = neonDefs[i]
    const sp = textSprite((c, w2, h2) => {
      c.font = '900 52px "Arial Black", sans-serif'
      c.textAlign = 'center'
      c.fillStyle = def.color
      c.shadowColor = def.color
      c.shadowBlur = 26
      c.fillText(def.text, w2 / 2, h2 / 2 + 18)
    }, 512, 128)
    sp.scale.set(14, 3.5, 1)
    sp.position.set(b.mesh.position.x, b.h + 2.4, b.mesh.position.z)
    scene.add(sp)
    neons.push(sp)
  })

  // streak billboard above the tallest tower
  if (tallest[0]) {
    const bb = textSprite((c, w2, h2) => {
      c.fillStyle = 'rgba(10,8,24,0.92)'
      c.beginPath()
      c.roundRect(8, 8, w2 - 16, h2 - 16, 18)
      c.fill()
      c.strokeStyle = '#ffb454'
      c.lineWidth = 5
      c.stroke()
      c.textAlign = 'center'
      c.font = '900 52px "Arial Black", sans-serif'
      c.fillStyle = '#ffb454'
      c.fillText(`🔥 ${opts.streak}`, w2 / 2, 66)
      c.font = '700 24px Inter, sans-serif'
      c.fillStyle = 'rgba(255,255,255,0.85)'
      c.fillText('DAY STREAK', w2 / 2, 100)
    })
    bb.scale.set(12, 6, 1)
    bb.position.set(tallest[0].mesh.position.x, tallest[0].h + 7.5, tallest[0].mesh.position.z)
    scene.add(bb)
  }

  // ---------- plaza: hill, acacia, low-poly lion ----------
  const plaza = new THREE.Group()
  const hill = new THREE.Mesh(
    track(new THREE.SphereGeometry(7, 20, 12)),
    track(new THREE.MeshLambertMaterial({ color: 0x3c6b3f })),
  )
  hill.scale.set(1.5, 0.42, 1.5)
  hill.position.y = 0
  plaza.add(hill)
  // acacia
  const trunkMat = track(new THREE.MeshLambertMaterial({ color: 0x4a3220 }))
  const trunk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.34, 3.6)), trunkMat)
  trunk.position.set(-4.4, 4, 1.6)
  trunk.rotation.z = 0.16
  plaza.add(trunk)
  const crown = new THREE.Mesh(
    track(new THREE.SphereGeometry(2.6, 10, 6)),
    track(new THREE.MeshLambertMaterial({ color: 0x4f7a42 })),
  )
  crown.scale.set(1.35, 0.34, 1.35)
  crown.position.set(-4.9, 6, 1.6)
  plaza.add(crown)

  // the lion is the plaza monument — big enough to read from the aerial
  // camera, lit up gold after dark like a real city landmark
  const lion = new THREE.Group()
  const bodyMat = track(new THREE.MeshLambertMaterial({ color: 0xc98a4b, emissive: 0xffa64d, emissiveIntensity: 0 }))
  const maneMat = track(new THREE.MeshLambertMaterial({ color: 0x7a4a1c, emissive: 0xcc7a26, emissiveIntensity: 0 }))
  const body = new THREE.Mesh(track(new THREE.SphereGeometry(1.15, 14, 10)), bodyMat)
  body.scale.set(1.6, 1, 1)
  body.position.y = 1.35
  lion.add(body)
  const legGeo = track(new THREE.CylinderGeometry(0.22, 0.19, 1.1))
  for (const [lx, lz] of [[-1.1, 0.5], [-1.1, -0.5], [1.1, 0.5], [1.1, -0.5]]) {
    const leg = new THREE.Mesh(legGeo, bodyMat)
    leg.position.set(lx, 0.55, lz)
    lion.add(leg)
  }
  const headGroup = new THREE.Group()
  const mane = new THREE.Mesh(track(new THREE.DodecahedronGeometry(1)), maneMat)
  mane.scale.set(1, 1, 0.75)
  headGroup.add(mane)
  const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.62, 12, 9)), bodyMat)
  head.position.z = 0.42
  headGroup.add(head)
  const muzzle = new THREE.Mesh(track(new THREE.SphereGeometry(0.3, 8, 6)), track(new THREE.MeshLambertMaterial({ color: 0xe6c497 })))
  muzzle.scale.set(1, 0.75, 0.9)
  muzzle.position.set(0, -0.14, 0.96)
  headGroup.add(muzzle)
  const earGeo = track(new THREE.SphereGeometry(0.2, 6, 5))
  for (const ex of [-0.5, 0.5]) {
    const ear = new THREE.Mesh(earGeo, maneMat)
    ear.position.set(ex, 0.88, 0.2)
    headGroup.add(ear)
  }
  headGroup.position.set(1.7, 2.5, 0)
  headGroup.rotation.y = Math.PI / 2 // face along +x, toward the avenue
  lion.add(headGroup)
  const tail = new THREE.Mesh(track(new THREE.CylinderGeometry(0.09, 0.07, 1.7)), bodyMat)
  tail.position.set(-1.9, 1.7, 0)
  tail.rotation.z = 0.7
  lion.add(tail)
  const tuft = new THREE.Mesh(track(new THREE.SphereGeometry(0.19, 6, 5)), maneMat)
  tuft.position.set(-2.45, 2.3, 0)
  lion.add(tuft)
  lion.position.y = 2.6
  lion.scale.setScalar(2.1)
  plaza.add(lion)

  // four plaza lamps
  const lampGlows: THREE.Sprite[] = []
  for (const [lx, lz] of [[9, 9], [-9, 9], [9, -9], [-9, -9]]) {
    const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.12, 0.12, 4.4)), padMat)
    post.position.set(lx, 2.2, lz)
    plaza.add(post)
    const glow = glowSprite('rgba(255,214,140,0.9)', 4)
    glow.position.set(lx, 4.7, lz)
    plaza.add(glow)
    lampGlows.push(glow)
  }
  scene.add(plaza)

  // ---------- cars on the avenues ----------
  const cars: { g: THREE.Group; axis: 'x' | 'z'; v: number; head: THREE.Sprite }[] = []
  for (const [axis, colorHex] of [['z', 0xe04a5a], ['x', 0x4f6bfa]] as const) {
    const g = new THREE.Group()
    const bodyMesh = new THREE.Mesh(track(new THREE.BoxGeometry(3.4, 1, 1.8)), track(new THREE.MeshLambertMaterial({ color: colorHex })))
    bodyMesh.position.y = 0.8
    g.add(bodyMesh)
    const cab = new THREE.Mesh(track(new THREE.BoxGeometry(1.7, 0.8, 1.6)), track(new THREE.MeshLambertMaterial({ color: 0x11101c })))
    cab.position.set(-0.2, 1.6, 0)
    g.add(cab)
    const head = glowSprite('rgba(255,240,190,0.95)', 3)
    head.position.set(2.1, 0.8, 0)
    g.add(head)
    if (axis === 'z') g.rotation.y = -Math.PI / 2
    scene.add(g)
    cars.push({ g, axis, v: 9 + Math.random() * 4, head })
  }

  // ---------- stars, moon, sun ----------
  const starGeo = track(new THREE.BufferGeometry())
  {
    const pts = new Float32Array(350 * 3)
    const sr = rng(99)
    for (let i = 0; i < 350; i++) {
      const a = sr() * Math.PI * 2
      const el = sr() * Math.PI * 0.42 + 0.12
      const rad = 215
      pts[i * 3] = Math.cos(a) * Math.cos(el) * rad
      pts[i * 3 + 1] = Math.sin(el) * rad
      pts[i * 3 + 2] = Math.sin(a) * Math.cos(el) * rad
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  }
  const starMat = track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, fog: false, sizeAttenuation: false }))
  scene.add(new THREE.Points(starGeo, starMat))
  const moon = glowSprite('rgba(235,240,255,1)', 26)
  const sunSprite = glowSprite('rgba(255,238,180,1)', 34)
  moon.material.fog = false
  sunSprite.material.fog = false
  scene.add(moon, sunSprite)

  // ---------- camera orbit ----------
  let azimuth = -0.7
  let azVel = 0
  let dragging = false
  let lastX = 0
  // stay outside the outer ring (radius ~56) and high enough to read the grid
  const radius = () => (camera.aspect < 0.85 ? 104 : 88)
  function placeCamera() {
    camera.position.set(Math.cos(azimuth) * radius(), 46, Math.sin(azimuth) * radius())
    camera.lookAt(0, 4, 0)
  }
  function onDown(e: PointerEvent) {
    dragging = true
    lastX = e.clientX
    canvas.setPointerCapture(e.pointerId)
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return
    const dx = e.clientX - lastX
    lastX = e.clientX
    azVel = dx * 0.004
    azimuth += azVel
  }
  function onUp() {
    dragging = false
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.style.touchAction = 'pan-y'

  // ---------- loop ----------
  let raf = 0
  let running = true
  let visible = true
  let lastTint = -1
  const startT = performance.now()

  function frame(t: number) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (!visible) return
    const now = new Date()
    const hour = now.getHours() + now.getMinutes() / 60
    const sky = skyAt(hour)
    const dark = sky.dark
    const tSec = (t - startT) / 1000

    // sky + fog + lights — only re-tint the dome when the palette moved
    if (Math.abs(dark - lastTint) > 0.01) {
      tintDome(sky.top, sky.low)
      lastTint = dark
    }
    ;(scene.fog as THREE.Fog).color.copy(sky.low).multiplyScalar(0.7)
    ambient.intensity = 0.85 - dark * 0.62
    ambient.color.setHSL(0.62, dark * 0.35, 1)
    sun.intensity = Math.max(0.05, 1.15 * (1 - dark))
    plazaLamp.intensity = dark * 26
    starMat.opacity = dark * 0.9

    // sun & moon arcs
    const sf = (hour - 6) / 12
    sunSprite.visible = sf > -0.04 && sf < 1.04
    if (sunSprite.visible) {
      sunSprite.position.set(Math.cos(Math.PI * (1 - sf)) * 180, Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, sf))) * 130 + 6, -90)
    }
    const mf = ((hour + 24 - 18) % 24) / 12
    moon.visible = mf > -0.04 && mf < 1.04 && dark > 0.2
    if (moon.visible) {
      moon.position.set(Math.cos(Math.PI * (1 - mf)) * 180, Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, mf))) * 130 + 6, -90)
    }

    // windows, neon, lamps, beacons
    const flicker = 0.9 + 0.1 * Math.sin(tSec * 3.1)
    for (const b of blds) {
      b.mats[0].emissiveIntensity = dark * flicker
      // build-up: each building rises in reveal order
      const k = Math.max(0, Math.min(1, (tSec - b.order * 0.05) / 0.55))
      const e = 1 - (1 - k) * (1 - k)
      b.mesh.scale.y = Math.max(0.001, e)
      b.mesh.position.y = (b.h * e) / 2
    }
    neons.forEach((n2, i) => {
      const fl = Math.sin(tSec * 7 + i * 9) > -0.9 ? 1 : 0.25
      n2.material.opacity = Math.max(0.06, dark * fl)
    })
    lampGlows.forEach((g2) => { g2.material.opacity = dark })
    beacons.forEach((bc, i) => {
      ;(bc.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.7 * Math.abs(Math.sin(tSec * 2 + i * 2))
    })
    if (craneGroup) craneGroup.rotation.y = Math.sin(tSec * 0.3) * 0.15

    // lion — breathe, look around, tail sway; glows gold after dark
    body.scale.y = 1 + Math.sin(tSec * 1.7) * 0.03
    headGroup.rotation.y = Math.PI / 2 + Math.sin(tSec * 0.4) * 0.5
    tail.rotation.x = Math.sin(tSec * 2.2) * 0.25
    bodyMat.emissiveIntensity = dark * 0.35
    maneMat.emissiveIntensity = dark * 0.3

    // cars — loop along the avenues, headlights only after dark
    for (const car of cars) {
      const range = 150
      const p = ((tSec * car.v + range) % (range * 2)) - range
      if (car.axis === 'z') car.g.position.set(2.6, 0, p)
      else car.g.position.set(-p, 0, 2.6)
      car.head.material.opacity = dark
    }

    // camera — gentle self-orbit unless the user is steering
    if (!dragging) {
      azVel *= 0.95
      azimuth += azVel + 0.0012
    }
    placeCamera()
    renderer.render(scene, camera)
  }

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    renderer.setSize(rect.width, rect.height, false)
    camera.aspect = rect.width / rect.height
    camera.updateProjectionMatrix()
    placeCamera()
  }
  const ro = new ResizeObserver(resize)
  if (canvas.parentElement) ro.observe(canvas.parentElement)
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
  io.observe(canvas)
  resize()

  if (opts.reducedMotion) {
    // a single settled frame: buildings fully risen, no orbit
    for (const b of blds) {
      b.mesh.scale.y = 1
      b.mesh.position.y = b.h / 2
    }
    const now = new Date()
    const sky = skyAt(now.getHours() + now.getMinutes() / 60)
    tintDome(sky.top, sky.low)
    renderer.render(scene, camera)
  } else {
    raf = requestAnimationFrame(frame)
  }

  return () => {
    running = false
    cancelAnimationFrame(raf)
    ro.disconnect()
    io.disconnect()
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.material) {
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const withMap = mat as THREE.Material & { map?: THREE.Texture | null }
          withMap.map?.dispose()
          mat.dispose()
        }
      }
      m.geometry?.dispose()
    })
    disposables.forEach((d) => d.dispose())
    renderer.dispose()
  }
}
