/**
 * Lion City in 3D — the living open world behind the game hub.
 *
 * Everything is driven by two inputs:
 *  - the real clock  → sky, sun/moon, stars, window lights, neon, headlights,
 *    floodlights, fireflies… plus deterministic weather (clear/rain/storm/
 *    snow) that rolls every few hours
 *  - the user level  → downtown buildings unlock one by one (cityUnlocked),
 *    and whole DISTRICTS come online at level milestones: university, park,
 *    harbor, tech park, metro line, stadium, mountain temple, airport, neon
 *    strip and finally the Golden Lion Tower
 *
 * The world is deliberately animated everywhere: traffic scales with level,
 * pedestrians walk the plaza, a metro loops its elevated track, a hot-air
 * balloon drifts, a helicopter patrols, birds cross the sky by day, a ship
 * works the harbor, cranes swing over the next unlock. Bloom post-processing
 * makes night neon glow; it disables itself automatically if the device
 * can't hold frame rate.
 *
 * Returns null if WebGL isn't available so the caller can fall back to the
 * 2D skyline. The handle exposes capture() for Photo Mode.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CITY_TOTAL_BUILDINGS, cityUnlocked, nextDistrict, type CityOpts } from './cityScene'
import { buildCharacter, type CharacterRig } from './characterModel'
import { PLAYABLE_CHARACTERS, characterById } from '../lib/characters'
import { loadBrain, saveBrain, idleLine, rememberEvent, gossip, chooseBuildKind, recordBuild, type NpcBrain } from '../lib/npcMind'
import { autoLearnStep } from '../lib/npcLearn'

export type City3DHandle = { stop: () => void; capture: () => string | null; setAvatar: (id: string) => void }

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

type Weather = 'clear' | 'rain' | 'storm' | 'snow'
/** Deterministic weather that rolls every 3 hours — same for every visit in the slot. */
function weatherNow(): Weather {
  const slot = Math.floor(Date.now() / (3 * 3600 * 1000))
  const roll = rng(slot)()
  if (roll < 0.58) return 'clear'
  if (roll < 0.82) return 'rain'
  if (roll < 0.92) return 'storm'
  return 'snow'
}

// ---------- canvas textures ----------
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

/** Trace a rounded-rectangle path (no ctx.roundRect — older WebViews lack it). */
function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

export function startCity3D(canvas: HTMLCanvasElement, opts: CityOpts): City3DHandle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1))
  // cinematic grade — filmic tone-map + sRGB, so the PBR character models read realistically
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  const level = opts.level
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x0, 130, 380)
  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 700)

  const unlocked = cityUnlocked(level)
  const r = rng(20260713)
  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x }

  // image-based lighting: a built-in room environment (no asset) so the PBR
  // character models (monument + roaming citizens) catch soft realistic light
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = envRT.texture
    scene.environmentIntensity = 0.3
    disposables.push({ dispose: () => { envRT.dispose(); pmrem.dispose() } })
  } catch { /* PMREM unsupported → lights still light the scene */ }
  const lowEnd = (navigator.hardwareConcurrency || 4) <= 4

  // ---------- post-processing: bloom, with an automatic kill switch ----------
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.7, 0.55)
  composer.addPass(bloom)
  let fxOn = localStorage.getItem('fl-city-fx') !== 'off'
  let slowFrames = 0

  // ---------- sky dome ----------
  const domeGeo = track(new THREE.SphereGeometry(300, 24, 12))
  const domeCount = domeGeo.attributes.position.count
  domeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(domeCount * 3), 3))
  const domeMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }))
  scene.add(new THREE.Mesh(domeGeo, domeMat))
  function tintDome(top: THREE.Color, low: THREE.Color) {
    const pos = domeGeo.attributes.position
    const col = domeGeo.attributes.color
    const c = new THREE.Color()
    for (let i = 0; i < domeCount; i++) {
      const t = Math.max(0, Math.min(1, pos.getY(i) / 200))
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
  const flashLight = new THREE.DirectionalLight(0xcfe0ff, 0) // storm lightning
  flashLight.position.set(-40, 120, -30)
  scene.add(ambient, sun, plazaLamp, flashLight)

  // ---------- ground + avenues ----------
  const ground = new THREE.Mesh(
    track(new THREE.CircleGeometry(190, 40)),
    track(new THREE.MeshLambertMaterial({ color: 0x191723 })),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  const roadMat = track(new THREE.MeshLambertMaterial({ color: 0x121019 }))
  for (const rot of [0, Math.PI / 2]) {
    const road = new THREE.Mesh(track(new THREE.PlaneGeometry(340, 8)), roadMat)
    road.rotation.set(-Math.PI / 2, 0, rot)
    road.position.y = 0.04
    scene.add(road)
  }
  const dashMat = track(new THREE.MeshBasicMaterial({ color: 0xffb454 }))
  const dashGeo = track(new THREE.PlaneGeometry(2.2, 0.4))
  for (let i = -13; i <= 13; i++) {
    if (Math.abs(i) < 2) continue
    for (const rot of [0, Math.PI / 2]) {
      const dash = new THREE.Mesh(dashGeo, dashMat)
      dash.rotation.set(-Math.PI / 2, 0, rot)
      dash.position.set(rot === 0 ? i * 12 : 0, 0.06, rot === 0 ? 0 : i * 12)
      scene.add(dash)
    }
  }

  // ---------- downtown buildings ----------
  const FACADES = ['#8d92b0', '#a3a0bd', '#7e84a6', '#b3aca4', '#95a2bd']
  const texSets = FACADES.map((tint, i) => facadeTextures(500 + i, tint))
  texSets.forEach((s) => { track(s.map); track(s.emissiveMap) })

  type Bld = { mesh: THREE.Mesh; h: number; order: number; mats: THREE.MeshLambertMaterial[] }
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
    const h = 6 + r() * 10 + 26 / (1 + s.d)
    if (order >= unlocked) return
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
    const pad = new THREE.Mesh(padGeo, padMat)
    pad.scale.set(w + 2, 0.5, dep + 2)
    pad.position.set(s.x, 0.25, s.z)
    scene.add(pad)
    if (r() > 0.5) {
      const tank = new THREE.Mesh(padGeo, padMat)
      tank.scale.set(1.6, 1.6, 1.6)
      tank.position.set(s.x + w * 0.25, h + 0.8, s.z)
      scene.add(tank)
    }
    if (r() > 0.55) {
      const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.09, 0.09, 3)), padMat)
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

  // ghost of the next building — amber wireframe + swinging crane + level tag
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
    const craneMat = track(new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.8 }))
    const mast = new THREE.Mesh(track(new THREE.BoxGeometry(0.4, gh + 7, 0.4)), craneMat)
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
      c.fillText(`LV ${level + 1}`, w2 / 2, h2 / 2 + 16)
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

  // ---------- plaza: hill, acacia, the lion monument ----------
  const plaza = new THREE.Group()
  const hill = new THREE.Mesh(
    track(new THREE.SphereGeometry(7, 20, 12)),
    track(new THREE.MeshLambertMaterial({ color: 0x3c6b3f })),
  )
  hill.scale.set(1.5, 0.42, 1.5)
  plaza.add(hill)
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

  // ---- the monument is YOUR chosen character (any unlocked runner) ----
  let avatarId = opts.character || 'lion'
  let monument = buildCharacter(characterById(avatarId), {})
  function placeMonument(m: CharacterRig) {
    m.group.position.set(0, 2.6, 0)
    m.group.scale.setScalar(2.4)
    plaza.add(m.group)
  }
  placeMonument(monument)
  // a soft spotlight glow ring under the monument — marks the centrepiece
  const ringMat = track(new THREE.MeshBasicMaterial({ color: 0xffd678, transparent: true, opacity: 0.5, side: THREE.DoubleSide }))
  const monRing = new THREE.Mesh(track(new THREE.RingGeometry(3.4, 4.2, 40)), ringMat)
  monRing.rotation.x = -Math.PI / 2
  monRing.position.y = 2.62
  plaza.add(monRing)
  function setAvatar(id: string) {
    if (id === avatarId || !id) return
    avatarId = id
    plaza.remove(monument.group)
    monument.dispose()
    monument = buildCharacter(characterById(id), {})
    placeMonument(monument)
  }

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

  // ---------- districts (level-gated) ----------
  const districtPos: Record<string, [number, number]> = {
    'University District': [-62, -58],
    'Lion Park': [-60, 55],
    'Harbor': [95, 0],
    'Tech Park': [60, -58],
    'Metro Line': [0, 0],
    'Stadium': [66, 62],
    'Mountain Temple': [-14, -150],
    'Airport': [12, 135],
    'Neon Strip': [-26, 33],
    'Golden Lion Tower': [-38, -14],
  }
  const lowMat = track(new THREE.MeshLambertMaterial({ color: 0x9a8f7e }))

  // University — three halls + a clock tower
  if (level >= 3) {
    const [ux, uz] = districtPos['University District']
    const g = new THREE.Group()
    for (const [dx, dz, w, h, d] of [[-8, 0, 10, 5, 7], [4, 4, 8, 4, 6], [3, -7, 7, 4, 6]]) {
      const hall = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), lowMat)
      hall.position.set(dx, h / 2, dz)
      g.add(hall)
    }
    const tower = new THREE.Mesh(track(new THREE.BoxGeometry(3, 13, 3)), lowMat)
    tower.position.set(-8, 6.5, 6)
    g.add(tower)
    const clock = textSprite((c, w2, h2) => {
      c.fillStyle = '#f5ecd8'
      c.beginPath()
      c.arc(w2 / 2, h2 / 2, 52, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = '#2a2438'
      c.lineWidth = 7
      c.stroke()
      c.beginPath()
      c.moveTo(w2 / 2, h2 / 2)
      c.lineTo(w2 / 2, h2 / 2 - 36)
      c.moveTo(w2 / 2, h2 / 2)
      c.lineTo(w2 / 2 + 26, h2 / 2 + 10)
      c.stroke()
    }, 128, 128)
    clock.scale.set(2.4, 2.4, 1)
    clock.position.set(-8, 11, 6)
    g.add(clock)
    g.position.set(ux, 0, uz)
    scene.add(g)
  }

  // Lion Park — instanced trees + fireflies at night
  let fireflyMat: THREE.PointsMaterial | null = null
  let fireflyGeo: THREE.BufferGeometry | null = null
  if (level >= 4) {
    const [px, pz] = districtPos['Lion Park']
    const lawn = new THREE.Mesh(track(new THREE.CircleGeometry(16, 20)), track(new THREE.MeshLambertMaterial({ color: 0x2f5d33 })))
    lawn.rotation.x = -Math.PI / 2
    lawn.position.set(px, 0.05, pz)
    scene.add(lawn)
    const trunkGeo = track(new THREE.CylinderGeometry(0.25, 0.35, 2.4))
    const crownGeo = track(new THREE.ConeGeometry(1.7, 3.4, 7))
    const trunkI = new THREE.InstancedMesh(trunkGeo, trunkMat, 12)
    const crownI = new THREE.InstancedMesh(crownGeo, track(new THREE.MeshLambertMaterial({ color: 0x39703a })), 12)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2
      const rad = 3 + r() * 11
      const tx = px + Math.cos(a) * rad
      const tz = pz + Math.sin(a) * rad
      const sc = 0.8 + r() * 0.7
      m.makeScale(sc, sc, sc).setPosition(tx, 1.2 * sc, tz)
      trunkI.setMatrixAt(i, m)
      m.makeScale(sc, sc, sc).setPosition(tx, (2.4 + 1.4) * sc, tz)
      crownI.setMatrixAt(i, m)
    }
    scene.add(trunkI, crownI)
    fireflyGeo = track(new THREE.BufferGeometry())
    const fp = new Float32Array(30 * 3)
    for (let i = 0; i < 30; i++) {
      fp[i * 3] = px + (r() - 0.5) * 26
      fp[i * 3 + 1] = 1 + r() * 3
      fp[i * 3 + 2] = pz + (r() - 0.5) * 26
    }
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3))
    fireflyMat = track(new THREE.PointsMaterial({
      color: 0xd8ff7a, size: 2.4, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, sizeAttenuation: false, depthWrite: false,
    }))
    scene.add(new THREE.Points(fireflyGeo, fireflyMat))
  }

  // Harbor — water, dock, a working ship
  let ship: THREE.Group | null = null
  let shipDir = 1
  if (level >= 5) {
    const water = new THREE.Mesh(
      track(new THREE.PlaneGeometry(95, 230)),
      track(new THREE.MeshPhongMaterial({ color: 0x123a5e, specular: 0x88bbff, shininess: 90, transparent: true, opacity: 0.92 })),
    )
    water.rotation.x = -Math.PI / 2
    water.position.set(118, 0.06, 0)
    scene.add(water)
    const dock = new THREE.Mesh(padGeo, padMat)
    dock.scale.set(14, 1.2, 30)
    dock.position.set(76, 0.6, 8)
    scene.add(dock)
    ship = new THREE.Group()
    const hull = new THREE.Mesh(track(new THREE.BoxGeometry(9, 1.6, 3)), track(new THREE.MeshLambertMaterial({ color: 0x8a2f3c })))
    hull.position.y = 0.9
    ship.add(hull)
    const cabin = new THREE.Mesh(track(new THREE.BoxGeometry(2.6, 1.8, 2.2)), track(new THREE.MeshLambertMaterial({ color: 0xe8e4da })))
    cabin.position.set(-1.6, 2.4, 0)
    ship.add(cabin)
    ship.rotation.y = Math.PI / 2
    ship.position.set(100, 0, -30)
    scene.add(ship)
  }

  // Tech Park — mirrored towers with extra neon
  if (level >= 8) {
    const [tx, tz] = districtPos['Tech Park']
    const glassMat = track(new THREE.MeshPhongMaterial({ color: 0x2e4a6e, specular: 0xaaccff, shininess: 80 }))
    for (const [dx, dz, h] of [[-5, 0, 18], [4, 5, 14], [3, -6, 22]]) {
      const t2 = new THREE.Mesh(track(new THREE.BoxGeometry(6, h, 6)), glassMat)
      t2.position.set(tx + dx, h / 2, tz + dz)
      scene.add(t2)
    }
    const sp = textSprite((c, w2, h2) => {
      c.font = '900 46px "Arial Black", sans-serif'
      c.textAlign = 'center'
      c.fillStyle = '#4fd6ff'
      c.shadowColor = '#4fd6ff'
      c.shadowBlur = 24
      c.fillText('TECH PARK', w2 / 2, h2 / 2 + 16)
    }, 512, 128)
    sp.scale.set(15, 3.6, 1)
    sp.position.set(tx, 25, tz)
    scene.add(sp)
    neons.push(sp)
  }

  // Metro — elevated ring with a three-car train
  const trainCars: THREE.Mesh[] = []
  if (level >= 10) {
    const rail = new THREE.Mesh(
      track(new THREE.TorusGeometry(46, 0.22, 6, 90)),
      track(new THREE.MeshLambertMaterial({ color: 0x4a4660 })),
    )
    rail.rotation.x = Math.PI / 2
    rail.position.y = 7.5
    scene.add(rail)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const pillar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.28, 0.34, 7.5)), padMat)
      pillar.position.set(Math.cos(a) * 46, 3.75, Math.sin(a) * 46)
      scene.add(pillar)
    }
    const carGeo = track(new THREE.BoxGeometry(3.4, 1.5, 1.7))
    const carMat = track(new THREE.MeshLambertMaterial({ color: 0xd8dae6, emissive: 0xaBc4ff, emissiveIntensity: 0 }))
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Mesh(carGeo, carMat)
      scene.add(car)
      trainCars.push(car)
    }
  }

  // Stadium — bowl, pitch, floodlights
  const floodGlows: THREE.Sprite[] = []
  if (level >= 12) {
    const [sx, sz] = districtPos['Stadium']
    const bowl = new THREE.Mesh(
      track(new THREE.TorusGeometry(9, 2.8, 8, 26)),
      track(new THREE.MeshLambertMaterial({ color: 0xb9b2a6 })),
    )
    bowl.rotation.x = Math.PI / 2
    bowl.scale.z = 1.5
    bowl.position.set(sx, 2.1, sz)
    scene.add(bowl)
    const pitch = new THREE.Mesh(track(new THREE.CircleGeometry(8.2, 18)), track(new THREE.MeshLambertMaterial({ color: 0x2f7a3a })))
    pitch.rotation.x = -Math.PI / 2
    pitch.position.set(sx, 0.08, sz)
    scene.add(pitch)
    for (const [dx, dz] of [[10, 10], [-10, 10], [10, -10], [-10, -10]]) {
      const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.16, 9)), padMat)
      pole.position.set(sx + dx, 4.5, sz + dz)
      scene.add(pole)
      const fl = glowSprite('rgba(230,240,255,0.95)', 6)
      fl.position.set(sx + dx, 9.4, sz + dz)
      scene.add(fl)
      floodGlows.push(fl)
    }
  }

  // Mountain Temple — hazy peak on the horizon
  if (level >= 15) {
    const [mx, mz] = districtPos['Mountain Temple']
    const mountain = new THREE.Mesh(track(new THREE.ConeGeometry(34, 42, 7)), track(new THREE.MeshLambertMaterial({ color: 0x4e4a5e })))
    mountain.position.set(mx, 21, mz)
    scene.add(mountain)
    const cap = new THREE.Mesh(track(new THREE.ConeGeometry(11, 13, 7)), track(new THREE.MeshLambertMaterial({ color: 0xe8ecf5 })))
    cap.position.set(mx, 35.5, mz)
    scene.add(cap)
    const temple = new THREE.Mesh(track(new THREE.ConeGeometry(2.6, 3.4, 4)), track(new THREE.MeshLambertMaterial({ color: 0xc9503c })))
    temple.position.set(mx, 43.5, mz)
    scene.add(temple)
    const tg = glowSprite('rgba(255,214,140,0.9)', 7)
    tg.position.set(mx, 44, mz)
    scene.add(tg)
    lampGlows.push(tg)
  }

  // Airport — runway with edge lights and a tower
  if (level >= 20) {
    const [ax, az] = districtPos['Airport']
    const runway = new THREE.Mesh(track(new THREE.PlaneGeometry(9, 64)), roadMat)
    runway.rotation.x = -Math.PI / 2
    runway.position.set(ax, 0.05, az)
    scene.add(runway)
    const edgeMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    const edgeGeo = track(new THREE.BoxGeometry(0.5, 0.2, 0.5))
    for (let i = -4; i <= 4; i++) {
      for (const side of [-4.8, 4.8]) {
        const l2 = new THREE.Mesh(edgeGeo, edgeMat)
        l2.position.set(ax + side, 0.15, az + i * 7)
        scene.add(l2)
      }
    }
    const twr = new THREE.Mesh(track(new THREE.CylinderGeometry(0.9, 1.2, 9)), lowMat)
    twr.position.set(ax - 9, 4.5, az - 20)
    scene.add(twr)
  }

  // Neon Strip — venue row with animated billboards
  if (level >= 25) {
    const [nx, nz] = districtPos['Neon Strip']
    const words = ['XP', 'WIN', 'ROAR']
    const colors = ['#ffb454', '#ff4fa3', '#00e5c3']
    for (let i = 0; i < 3; i++) {
      const venue = new THREE.Mesh(track(new THREE.BoxGeometry(6, 4, 5)), padMat)
      venue.position.set(nx + i * 8, 2, nz)
      scene.add(venue)
      const sp = textSprite((c, w2, h2) => {
        c.font = '900 60px "Arial Black", sans-serif'
        c.textAlign = 'center'
        c.fillStyle = colors[i]
        c.shadowColor = colors[i]
        c.shadowBlur = 28
        c.fillText(words[i], w2 / 2, h2 / 2 + 22)
      }, 256, 128)
      sp.scale.set(6.5, 3.2, 1)
      sp.position.set(nx + i * 8, 6.2, nz)
      scene.add(sp)
      neons.push(sp)
    }
  }

  // Golden Lion Tower — the endgame landmark
  let goldMat: THREE.MeshLambertMaterial | null = null
  if (level >= 30) {
    const [gx, gz] = districtPos['Golden Lion Tower']
    goldMat = track(new THREE.MeshLambertMaterial({ color: 0xd9a43a, emissive: 0xffc45e, emissiveIntensity: 0 }))
    let y = 0
    for (const [rad, h] of [[4.4, 16], [3.2, 12], [2, 9]]) {
      const tier = new THREE.Mesh(track(new THREE.CylinderGeometry(rad, rad + 0.6, h, 10)), goldMat)
      tier.position.set(gx, y + h / 2, gz)
      scene.add(tier)
      y += h
    }
    const crownGlow = glowSprite('rgba(255,214,120,1)', 16)
    crownGlow.position.set(gx, y + 3, gz)
    scene.add(crownGlow)
    lampGlows.push(crownGlow)
  }

  // marker over the NEXT district to unlock
  const upcoming = nextDistrict(level)
  if (upcoming && districtPos[upcoming.name]) {
    const [ux, uz] = districtPos[upcoming.name]
    const marker = textSprite((c, w2, h2) => {
      c.font = '900 34px "Arial Black", sans-serif'
      c.textAlign = 'center'
      c.fillStyle = 'rgba(255,180,84,0.9)'
      c.shadowColor = '#ffb454'
      c.shadowBlur = 14
      c.fillText(upcoming.name.toUpperCase(), w2 / 2, h2 / 2)
      c.font = '700 26px Inter, sans-serif'
      c.fillStyle = 'rgba(255,255,255,0.75)'
      c.fillText(`UNLOCKS AT LV ${upcoming.level}`, w2 / 2, h2 / 2 + 34)
    }, 512, 128)
    marker.scale.set(20, 5, 1)
    marker.position.set(ux === 0 && uz === 0 ? 0 : ux, 16, ux === 0 && uz === 0 ? -46 : uz)
    scene.add(marker)
  }

  // ---------- traffic (scales with level) + pedestrians ----------
  type Car = { g: THREE.Group; axis: 'x' | 'z'; dir: number; v: number; off: number; head: THREE.Sprite }
  const cars: Car[] = []
  const carColors = [0xe04a5a, 0x4f6bfa, 0xf2b544, 0x3ec78f, 0xc9cdd8, 0x8f7bff]
  const nCars = Math.min(8, 2 + Math.floor(level / 4))
  for (let i = 0; i < nCars; i++) {
    const g = new THREE.Group()
    const bodyMesh = new THREE.Mesh(track(new THREE.BoxGeometry(3.4, 1, 1.8)), track(new THREE.MeshLambertMaterial({ color: carColors[i % carColors.length] })))
    bodyMesh.position.y = 0.8
    g.add(bodyMesh)
    const cab = new THREE.Mesh(track(new THREE.BoxGeometry(1.7, 0.8, 1.6)), track(new THREE.MeshLambertMaterial({ color: 0x11101c })))
    cab.position.set(-0.2, 1.6, 0)
    g.add(cab)
    const head = glowSprite('rgba(255,240,190,0.95)', 3)
    head.position.set(2.1, 0.8, 0)
    g.add(head)
    const axis = i % 2 === 0 ? 'z' : 'x'
    const dir = i % 4 < 2 ? 1 : -1
    g.rotation.y = axis === 'z' ? (dir === 1 ? -Math.PI / 2 : Math.PI / 2) : dir === 1 ? 0 : Math.PI
    scene.add(g)
    cars.push({ g, axis, dir, v: 8 + (i % 3) * 3, off: i * 41, head })
  }

  // (the old abstract white capsule pedestrians are gone — the plaza is peopled
  // entirely by the autonomous character-model citizens below)

  // ---------- living citizens: autonomous character-model agents ----------
  // Each is a real animated 3D character with a tiny "mind": a state machine
  // (wander → visit a point of interest → rest → watch/gather), a MEMORY of
  // where it's been + a home spot, and a PERSONALITY (speed/curiosity/social) —
  // so they roam and do what they want, like living beings. Drawn from the
  // roster you've UNLOCKED, so the city fills with life as you level up.
  const POIS: [number, number][] = [[0, 0], [-4.4, 1.6], [9, 9], [-9, 9], [9, -9], [-9, -9], [15, 0], [-15, 0], [0, 15], [0, -15]]
  // walking characters/animals only (road cars live in `cars`; no flyers on foot)
  // NPCs are the WHOLE walking cast (lions, wolves, foxes, deer, humans, robots,
  // dinosaurs…) — not gated by the player's unlocks — so the city is a varied,
  // lively crowd of animals + humans from level 1. Bigger crowd on capable phones.
  const roster = PLAYABLE_CHARACTERS.filter((c) => !c.fly && !c.vehicle)
  const citizenCount = opts.reducedMotion ? 0 : lowEnd ? 4 : Math.min(12, 6 + Math.floor(level / 3))
  const CITIZEN_SCALE = 1.6 // bigger, easier-to-see citizens
  const BUBBLE_W = 11 // bubble width in world units — large so the text is readable
  const BUBBLE_Y = 5.6 // bubble centre height above the ground (clears the model head)
  type Bubble = { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; draw: (text: string, think: boolean) => void }
  type Citizen = {
    rig: CharacterRig; pos: THREE.Vector2; heading: number
    state: 'wander' | 'goto' | 'rest' | 'watch' | 'build'; target: THREE.Vector2; timer: number; poi: number | null
    speed: number; curiosity: number; social: number; home: THREE.Vector2; visited: Set<number>
    bubble: Bubble; speakT: number; showing: boolean
    npcId: string; brain: NpcBrain
  }
  // A floating speech / thought bubble that hovers over a citizen. Big + high-res
  // so the words are readable at the city's far camera. It's added to the SCENE
  // (not parented to the model) and positioned every frame, so its size is
  // independent of how large the character models are. Billboards to the camera.
  function makeBubble(): Bubble {
    const W = 512, H = 288
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')!
    const tex = track(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace
    const mat = track(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, fog: false, depthWrite: false }))
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(BUBBLE_W, (BUBBLE_W * H) / W, 1) // big world-space bubble
    sprite.renderOrder = 999
    const draw = (text: string, think: boolean) => {
      g.clearRect(0, 0, W, H)
      g.font = '700 52px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      const maxW = W - 96
      const lines: string[] = []
      let cur = ''
      for (const word of text.split(' ')) {
        const t = cur ? cur + ' ' + word : word
        if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = word } else cur = t
      }
      if (cur) lines.push(cur)
      if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].replace(/\s*\S*$/, '') + '…' }
      const bodyY = 12, bodyH = 196, bx = 12, bw = W - 24
      roundRectPath(g, bx, bodyY, bw, bodyH, 40)
      g.fillStyle = 'rgba(12,10,24,0.88)'; g.fill()
      g.lineWidth = 5; g.strokeStyle = think ? 'rgba(130,180,255,0.7)' : 'rgba(255,190,90,0.75)'; g.stroke()
      g.fillStyle = 'rgba(12,10,24,0.88)'
      if (think) {
        for (const [dx, dy, r0] of [[-20, 26, 18], [-46, 62, 10]] as const) {
          g.beginPath(); g.arc(W / 2 + dx, bodyY + bodyH + dy, r0, 0, Math.PI * 2); g.fill(); g.stroke()
        }
      } else {
        g.beginPath(); g.moveTo(W / 2 - 30, bodyY + bodyH - 6); g.lineTo(W / 2 + 30, bodyY + bodyH - 6); g.lineTo(W / 2 - 12, bodyY + bodyH + 58); g.closePath(); g.fill()
      }
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
      const lh = 62, startY = bodyY + bodyH / 2 - ((lines.length - 1) * lh) / 2
      lines.forEach((ln, i) => g.fillText(ln, W / 2, startY + i * lh))
      tex.needsUpdate = true
    }
    return { sprite, mat, draw }
  }

  // ---------- citizen-built world: structures NPCs construct on their own ----------
  // Cheap procedural primitives; what gets built is decided by the citizen's
  // brain (profession + building skill). Persisted so the city THEY build grows
  // across sessions. Capped for performance ("unlimited" in spirit, bounded in
  // practice so mid-range phones stay smooth).
  type BuildRec = { kind: string; x: number; z: number; level: number; by: string }
  const BUILDS_KEY = 'fl-city-builds-v1'
  const MAX_BUILDS = 48
  let buildRecords: BuildRec[] = []
  try { const raw = localStorage.getItem(BUILDS_KEY); if (raw) buildRecords = JSON.parse(raw) as BuildRec[] } catch { /* ignore */ }
  const bMat = {
    wood: track(new THREE.MeshLambertMaterial({ color: 0x6b4a2b })),
    leaf: track(new THREE.MeshLambertMaterial({ color: 0x3f7a3a })),
    leaf2: track(new THREE.MeshLambertMaterial({ color: 0x4f8a42 })),
    stone: track(new THREE.MeshLambertMaterial({ color: 0x8a8f99 })),
    wall: track(new THREE.MeshLambertMaterial({ color: 0xcaa06a })),
    roof: track(new THREE.MeshLambertMaterial({ color: 0xb0503a })),
    metal: track(new THREE.MeshStandardMaterial({ color: 0x9fb2c8, metalness: 0.55, roughness: 0.4 })),
  }
  function buildStructure(kind: string, x: number, z: number, level: number): THREE.Group | null {
    const g = new THREE.Group()
    const s = 1 + level * 0.15 // structures grow with the builder's skill
    const box = (w: number, h: number, d: number, m: THREE.Material, y: number) => {
      const me = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), m); me.position.y = y; g.add(me); return me
    }
    const cyl = (r1: number, r2: number, h: number, m: THREE.Material, y: number) => {
      const me = new THREE.Mesh(track(new THREE.CylinderGeometry(r1, r2, h, 10)), m); me.position.y = y; g.add(me); return me
    }
    const cone = (r: number, h: number, m: THREE.Material, y: number) => {
      const me = new THREE.Mesh(track(new THREE.ConeGeometry(r, h, 10)), m); me.position.y = y; g.add(me); return me
    }
    switch (kind) {
      case 'tree': cyl(0.16, 0.22, 1.4 * s, bMat.wood, 0.7 * s); cone(0.95 * s, 1.7 * s, bMat.leaf, 2.0 * s); break
      case 'garden':
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const t = cone(0.4 * s, 0.9 * s, i % 2 ? bMat.leaf : bMat.leaf2, 0.6 * s); t.position.x = Math.cos(a) * 0.9; t.position.z = Math.sin(a) * 0.9 }
        break
      case 'rock': { const r = cyl(0.7 * s, 0.95 * s, 0.7 * s, bMat.stone, 0.3 * s); r.scale.y = 0.6; break }
      case 'lamp': { cyl(0.08, 0.1, 2.2 * s, bMat.metal, 1.1 * s); const glow = glowSprite('rgba(255,214,140,0.9)', 2.4 * s); glow.position.y = 2.3 * s; g.add(glow); break }
      case 'bench': { box(1.4 * s, 0.14, 0.5 * s, bMat.wood, 0.5 * s); const back = box(1.4 * s, 0.4 * s, 0.12, bMat.wood, 0.75 * s); back.position.z = -0.2 * s; break }
      case 'hut': box(1.8 * s, 1.4 * s, 1.8 * s, bMat.wall, 0.7 * s); cone(1.5 * s, 1.0 * s, bMat.roof, 1.9 * s); break
      case 'tower': { const floors = 2 + level; for (let i = 0; i < floors; i++) box((1.5 - i * 0.12) * s, 0.9 * s, (1.5 - i * 0.12) * s, i % 2 ? bMat.wall : bMat.stone, 0.45 * s + i * 0.9 * s); break }
      case 'fountain': cyl(1.2 * s, 1.35 * s, 0.4 * s, bMat.stone, 0.2 * s); cyl(0.2, 0.24, 1.0 * s, bMat.stone, 0.7 * s); cone(0.5 * s, 0.6 * s, bMat.metal, 1.4 * s); break
      case 'statue': { box(0.9 * s, 0.5 * s, 0.9 * s, bMat.stone, 0.25 * s); cyl(0.28 * s, 0.34 * s, 1.4 * s, bMat.metal, 1.2 * s); break }
      default: return null
    }
    g.position.set(x, 0, z)
    scene.add(g)
    return g
  }
  function persistBuilds() {
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(buildRecords.slice(-MAX_BUILDS))) } catch { /* quota */ }
  }
  // replay everything citizens have already built — the city they made persists
  for (const rec of buildRecords.slice(-MAX_BUILDS)) buildStructure(rec.kind, rec.x, rec.z, rec.level)

  const citizens: Citizen[] = []
  const seen: Record<string, number> = {} // dedupe identities when a species repeats
  for (let i = 0; i < citizenCount; i++) {
    const def = roster.length ? roster[i % roster.length] : characterById('lion')
    const rig = buildCharacter(def, { phase: i * 1.3 })
    rig.group.scale.setScalar(CITIZEN_SCALE)
    scene.add(rig.group)
    // stable per-citizen identity so the local brain persists across sessions
    const occ = (seen[def.id] = (seen[def.id] || 0) + 1)
    const npcId = occ > 1 ? `${def.id}-${occ}` : def.id
    const brain = loadBrain(npcId, { name: occ > 1 ? `${def.name} ${occ}` : def.name, emoji: def.emoji })
    rig.group.userData.npcId = npcId
    const bubble = makeBubble()
    scene.add(bubble.sprite) // in world space, positioned above the citizen each frame
    const a = (i / Math.max(1, citizenCount)) * Math.PI * 2
    const rad0 = 8 + (i % 3) * 5 // vary the radius (8/13/18) so the crowd spreads out
    const home = new THREE.Vector2(Math.cos(a) * rad0, Math.sin(a) * rad0)
    citizens.push({
      rig, pos: home.clone(), heading: a, state: 'wander', target: home.clone(), timer: 0.5 + r() * 2, poi: null,
      // personality traits from the brain drive how each one moves + socialises
      speed: 1.3 + brain.traits.energy * 1.8, curiosity: brain.traits.curiosity, social: brain.traits.warmth,
      home, visited: new Set<number>(), bubble, speakT: 0.6 + i * 0.7 + r() * 3, showing: false, npcId, brain,
    })
  }
  // hand the roster to the hub so it can offer a reliable tappable citizen list
  opts.onCitizens?.(citizens.map((c) => ({ id: c.npcId, name: c.brain.name, emoji: c.brain.emoji })))
  const tmpV2 = new THREE.Vector2()
  const shortestAngle = (from: number, to: number) => {
    let d = (to - from) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return d
  }
  // pick the citizen's next intent from its personality + memory
  function citizenDecide(c: Citizen) {
    // contextual daily-life routine: at night citizens rest + head home more,
    // by day they roam, explore and socialise
    const hour = new Date().getHours()
    const night = hour < 6 || hour >= 21
    const roll = Math.random()
    c.poi = null
    if (roll < (night ? 0.42 : 0.16)) { c.state = 'rest'; c.timer = 2 + Math.random() * 4; return } // stop + look around
    // sometimes decide to BUILD something (daytime, while there's room in the city)
    if (!night && buildRecords.length < MAX_BUILDS && Math.random() < 0.14 + c.brain.traits.curiosity * 0.12) {
      const ang = Math.random() * Math.PI * 2, rr = 6 + Math.random() * 13
      c.target.set(Math.cos(ang) * rr, Math.sin(ang) * rr)
      c.state = 'build'; c.timer = 12
      return
    }
    if (!night && roll < 0.18 + c.social * 0.34) {
      // sociable → go watch the monument, or drift toward another citizen
      const other = citizens[Math.floor(Math.random() * citizens.length)]
      c.target.copy(Math.random() < 0.55 || !other ? new THREE.Vector2(0, 0) : other.pos)
      c.state = 'watch'; c.timer = 4 + Math.random() * 4; return
    }
    // curious → head to a point of interest, preferring somewhere new (memory)
    let idx = Math.floor(Math.random() * POIS.length)
    if (c.curiosity > 0.5) {
      for (let k = 0; k < POIS.length; k++) { const j = (idx + k) % POIS.length; if (!c.visited.has(j)) { idx = j; break } }
    }
    if (night || Math.random() < 0.22) { c.target.copy(c.home); c.state = 'goto' } // routine: home at night
    else { c.target.set(POIS[idx][0], POIS[idx][1]); c.poi = idx; c.state = 'goto' }
    c.timer = 6 + Math.random() * 6
  }
  let learnT = 0 // seconds since the last autonomous internet-learning attempt
  let gossipT = 0 // seconds since the last offline peer-gossip attempt
  // a citizen has walked to a chosen spot → construct what its brain decided on
  function doBuild(c: Citizen) {
    if (buildRecords.length >= MAX_BUILDS) return
    const kind = chooseBuildKind(c.brain)
    const level = Math.min(6, 1 + Math.floor(c.brain.skills['building'] || 0))
    if (!buildStructure(kind, c.target.x, c.target.y, level)) return
    buildRecords.push({ kind, x: c.target.x, z: c.target.y, level, by: c.brain.name })
    persistBuilds()
    recordBuild(c.brain, kind)
    c.bubble.draw(`🔨 Built a ${kind}!`, false); c.showing = true; c.speakT = 4.5
  }
  function updateCitizens(tSec: number, dt: number) {
    for (const c of citizens) {
      c.timer -= dt
      tmpV2.copy(c.target).sub(c.pos)
      const dist = tmpV2.length()
      const moving = (c.state === 'goto' || c.state === 'wander' || c.state === 'build') && dist > 0.7
      const desired = Math.atan2(-tmpV2.x, -tmpV2.y) // face travel/target (model forward = -z)
      if (dist > 0.05) c.heading += shortestAngle(c.heading, desired) * Math.min(1, dt * (moving ? 4 : 2.5))
      if (moving) { tmpV2.normalize(); const s = c.speed * dt; c.pos.x += tmpV2.x * s; c.pos.y += tmpV2.y * s }
      else if (c.state === 'build') { doBuild(c); citizenDecide(c) } // arrived → construct
      else if (c.timer <= 0 || (c.state === 'goto' || c.state === 'wander')) {
        if (c.poi != null) { // remember where it went — becomes a recallable memory
          c.visited.add(c.poi)
          if (Math.random() < 0.5) rememberEvent(c.brain, 'life', 'I explored a corner of the city.', 0.3)
        }
        citizenDecide(c)
      }
      const rad = Math.hypot(c.pos.x, c.pos.y) // stay inside the plaza
      if (rad > 22) c.pos.multiplyScalar(22 / rad)
      c.rig.group.position.set(c.pos.x, 0.15, c.pos.y)
      c.rig.group.rotation.y = c.heading
      c.rig.pose({ tSec, running: false, walk: moving, airborne: false, sliding: false, dead: false })
      c.rig.update(dt)
      // speech / thought bubble — brain-driven; follows the citizen, cycles + fades
      c.bubble.sprite.position.set(c.pos.x, BUBBLE_Y, c.pos.y)
      c.speakT -= dt
      if (c.speakT <= 0) {
        if (c.showing) { c.showing = false; c.speakT = 3 + Math.random() * 7 }
        else { const p = idleLine(c.brain, c.state); c.bubble.draw(p.text, p.think); c.showing = true; c.speakT = 2.8 + Math.random() * 2.4 }
      }
      c.bubble.mat.opacity += ((c.showing ? 1 : 0) - c.bubble.mat.opacity) * Math.min(1, dt * 6)
    }

    // autonomous internet self-learning (opt-in): a curious citizen quietly reads
    // up on a topic, then shows what it learned. The module rate-limits itself.
    learnT += dt
    if (learnT >= 6 && citizens.length) {
      learnT = 0
      void autoLearnStep(citizens.map((c) => c.brain)).then((res) => {
        if (!res) return
        const c = citizens.find((z) => z.npcId === res.id)
        if (c) { c.bubble.draw(`🌐 Learned about ${res.topic}`, false); c.showing = true; c.speakT = 4.5 }
      })
    }
    // offline peer learning: nearby citizens swap a fact they know (works offline)
    gossipT += dt
    if (gossipT >= 9 && citizens.length > 1) {
      gossipT = 0
      let done = false
      for (let i = 0; i < citizens.length && !done; i++) {
        for (let j = i + 1; j < citizens.length && !done; j++) {
          const a = citizens[i], b = citizens[j]
          if (a.pos.distanceTo(b.pos) < 5 && Math.random() < 0.5) {
            const topic = gossip(a.brain, b.brain)
            if (topic) { b.bubble.draw(`Heard about ${topic} from ${a.brain.name}`, false); b.showing = true; b.speakT = 4.5 }
            done = true
          }
        }
      }
    }
  }

  // ---------- sky traffic: balloon, helicopter, birds, airliner ----------
  let balloon: THREE.Group | null = null
  if (level >= 6) {
    balloon = new THREE.Group()
    const env = new THREE.Mesh(track(new THREE.SphereGeometry(2.4, 12, 10)), track(new THREE.MeshLambertMaterial({ color: 0xe0574f })))
    balloon.add(env)
    const basket = new THREE.Mesh(track(new THREE.BoxGeometry(1, 0.8, 1)), trunkMat)
    basket.position.y = -3.4
    balloon.add(basket)
    scene.add(balloon)
  }
  let heli: THREE.Group | null = null
  let rotor: THREE.Mesh | null = null
  let heliBeacon: THREE.Sprite | null = null
  if (level >= 15) {
    heli = new THREE.Group()
    const hb = new THREE.Mesh(track(new THREE.SphereGeometry(1, 10, 8)), track(new THREE.MeshLambertMaterial({ color: 0x2a2f42 })))
    hb.scale.set(1.7, 0.8, 0.8)
    heli.add(hb)
    const tailB = new THREE.Mesh(track(new THREE.BoxGeometry(2.4, 0.25, 0.25)), padMat)
    tailB.position.x = -2.2
    heli.add(tailB)
    rotor = new THREE.Mesh(track(new THREE.BoxGeometry(4.6, 0.08, 0.3)), padMat)
    rotor.position.y = 1
    heli.add(rotor)
    heliBeacon = glowSprite('rgba(255,80,80,0.95)', 2.2)
    heliBeacon.position.y = 1.4
    heli.add(heliBeacon)
    scene.add(heli)
  }
  // birds: a small flock of dark points circling by day
  const birdGeo = track(new THREE.BufferGeometry())
  {
    const bp = new Float32Array(9 * 3)
    for (let i = 0; i < 9; i++) {
      bp[i * 3] = (r() - 0.5) * 10
      bp[i * 3 + 1] = (r() - 0.5) * 2.4
      bp[i * 3 + 2] = (r() - 0.5) * 8
    }
    birdGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3))
  }
  const birdMat = track(new THREE.PointsMaterial({ color: 0x1c1a26, size: 2.2, transparent: true, sizeAttenuation: false }))
  const birds = new THREE.Points(birdGeo, birdMat)
  scene.add(birds)
  // airliner streaking high above (level 20+)
  let airliner: THREE.Group | null = null
  if (level >= 20) {
    airliner = new THREE.Group()
    const fus = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.5, 7, 8)), track(new THREE.MeshLambertMaterial({ color: 0xe8e8f0 })))
    fus.rotation.z = Math.PI / 2
    airliner.add(fus)
    const wing = new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.12, 8)), track(new THREE.MeshLambertMaterial({ color: 0xc8c8d8 })))
    airliner.add(wing)
    const strobe = glowSprite('rgba(255,255,255,0.95)', 2)
    strobe.position.y = 0.8
    airliner.add(strobe)
    scene.add(airliner)
  }

  // ---------- stars, moon, sun, clouds ----------
  const starGeo = track(new THREE.BufferGeometry())
  {
    const pts = new Float32Array(350 * 3)
    const sr = rng(99)
    for (let i = 0; i < 350; i++) {
      const a = sr() * Math.PI * 2
      const el = sr() * Math.PI * 0.42 + 0.12
      const rad = 285
      pts[i * 3] = Math.cos(a) * Math.cos(el) * rad
      pts[i * 3 + 1] = Math.sin(el) * rad
      pts[i * 3 + 2] = Math.sin(a) * Math.cos(el) * rad
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  }
  const starMat = track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, fog: false, sizeAttenuation: false }))
  scene.add(new THREE.Points(starGeo, starMat))
  const moon = glowSprite('rgba(235,240,255,1)', 30)
  const sunSprite = glowSprite('rgba(255,238,180,1)', 40)
  moon.material.fog = false
  sunSprite.material.fog = false
  scene.add(moon, sunSprite)
  const clouds: THREE.Sprite[] = []
  for (let i = 0; i < 5; i++) {
    const cl = glowSprite('rgba(255,255,255,0.55)', 1)
    cl.scale.set(46 + r() * 30, 15 + r() * 8, 1)
    cl.material.fog = false
    scene.add(cl)
    clouds.push(cl)
  }

  // ---------- weather particles ----------
  const precipGeo = track(new THREE.BufferGeometry())
  {
    const pp = new Float32Array(700 * 3)
    const pr = rng(7)
    for (let i = 0; i < 700; i++) {
      pp[i * 3] = (pr() - 0.5) * 180
      pp[i * 3 + 1] = pr() * 70
      pp[i * 3 + 2] = (pr() - 0.5) * 180
    }
    precipGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3))
  }
  const precipMat = track(new THREE.PointsMaterial({ color: 0x9db8e8, size: 1.6, transparent: true, opacity: 0, sizeAttenuation: false, depthWrite: false }))
  scene.add(new THREE.Points(precipGeo, precipMat))
  let flashTimer = 0

  // ---------- camera: cinematic intro, then a gentle drag-steerable orbit ----------
  let azimuth = -0.7
  let azVel = 0
  let dragging = false
  let lastX = 0
  const INTRO_S = 3.2
  let introT = opts.reducedMotion ? INTRO_S : 0
  const radius = () => (camera.aspect < 0.85 ? 104 : 88)
  function placeCamera() {
    const k = Math.min(1, introT / INTRO_S)
    const e = 1 - (1 - k) * (1 - k) * (1 - k)
    const rad = radius() * (2.3 - 1.3 * e)
    const height = 130 - 84 * e
    const az = azimuth - 1.2 * (1 - e)
    camera.position.set(Math.cos(az) * rad, height, Math.sin(az) * rad)
    camera.lookAt(0, 4, 0)
  }
  // tap-to-select: a raycast picks the citizen under a quick, still tap so the
  // hub can open its chat/brain — dragging still orbits the camera as before
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let downX = 0, downY = 0, downMoved = 0, downAt = 0
  function pickCitizen(cx: number, cy: number) {
    if (!opts.onSelectCitizen || !citizens.length) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    ndc.x = ((cx - rect.left) / rect.width) * 2 - 1
    ndc.y = -((cy - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(citizens.map((c) => c.rig.group), true)
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object
      while (o) {
        const id = o.userData?.npcId as string | undefined
        if (id) {
          const c = citizens.find((z) => z.npcId === id)
          if (c) opts.onSelectCitizen(id, c.brain.name, c.brain.emoji)
          return
        }
        o = o.parent
      }
    }
  }
  function onDown(e: PointerEvent) {
    dragging = true
    lastX = e.clientX
    downX = e.clientX; downY = e.clientY; downMoved = 0; downAt = performance.now()
    canvas.setPointerCapture(e.pointerId)
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return
    const dx = e.clientX - lastX
    lastX = e.clientX
    downMoved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY)
    azVel = dx * 0.004
    azimuth += azVel
  }
  function onUp(e?: PointerEvent) {
    dragging = false
    if (e && downMoved < 12 && performance.now() - downAt < 400) pickCitizen(e.clientX, e.clientY)
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
  let prevT = 0
  const startT = performance.now()

  function animateWorld(tSec: number, dt: number, dark: number, weather: Weather) {
    // downtown build-up in reveal order
    const flicker = 0.9 + 0.1 * Math.sin(tSec * 3.1)
    for (const b of blds) {
      b.mats[0].emissiveIntensity = dark * flicker
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
    floodGlows.forEach((g2) => { g2.material.opacity = dark * 0.9 })
    beacons.forEach((bc, i) => {
      ;(bc.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.7 * Math.abs(Math.sin(tSec * 2 + i * 2))
    })
    if (craneGroup) craneGroup.rotation.y = Math.sin(tSec * 0.3) * 0.15
    if (goldMat) goldMat.emissiveIntensity = dark * 0.8

    // monument — YOUR chosen character, idling on its plinth + a glowing ring
    monument.group.rotation.y = Math.sin(tSec * 0.18) * 0.5
    monument.pose({ tSec, running: false, airborne: false, sliding: false, dead: false })
    monument.update(dt)
    monument.setGlow(0.35 + dark * 0.45)
    ringMat.opacity = 0.28 + dark * 0.4 + Math.sin(tSec * 2) * 0.08

    // living citizens roam the plaza on their own
    updateCitizens(tSec, dt)

    // traffic
    for (const car of cars) {
      const range = 160
      const p = (((tSec * car.v + car.off) % (range * 2)) + range * 2) % (range * 2) - range
      const along = car.dir * p
      const lane = 2.6 * car.dir
      if (car.axis === 'z') car.g.position.set(lane, 0, along)
      else car.g.position.set(along, 0, -lane)
      car.head.material.opacity = dark
    }

    // metro
    if (trainCars.length) {
      const emis = trainCars[0].material as THREE.MeshLambertMaterial
      emis.emissiveIntensity = dark * 0.7
      trainCars.forEach((car, i) => {
        const a = tSec * 0.14 - i * 0.082
        car.position.set(Math.cos(a) * 46, 8.4, Math.sin(a) * 46)
        car.rotation.y = -a - Math.PI / 2
      })
    }

    // harbor ship
    if (ship) {
      ship.position.z += shipDir * dt * 2.2
      if (ship.position.z > 70) shipDir = -1
      if (ship.position.z < -70) shipDir = 1
      ship.rotation.y = shipDir === 1 ? Math.PI / 2 : -Math.PI / 2
      ship.position.y = Math.sin(tSec * 1.1) * 0.12
    }

    // sky traffic
    if (balloon) {
      const a = tSec * 0.045
      balloon.position.set(Math.cos(a) * 66, 30 + Math.sin(tSec * 0.5) * 2, Math.sin(a) * 66)
    }
    if (heli && rotor && heliBeacon) {
      const a = tSec * 0.18 + 2
      heli.position.set(Math.cos(a) * 58, 40, Math.sin(a) * 58)
      heli.rotation.y = -a - Math.PI / 2
      rotor.rotation.y = tSec * 22
      heliBeacon.material.opacity = 0.4 + 0.6 * Math.abs(Math.sin(tSec * 4))
    }
    const dayness = 1 - dark
    birdMat.opacity = dayness * (weather === 'clear' ? 0.9 : 0.3)
    {
      const a = tSec * 0.06
      birds.position.set(Math.cos(a) * 74, 32 + Math.sin(tSec * 0.8) * 3, Math.sin(a) * 74)
    }
    if (airliner) {
      const p = ((tSec * 14) % 520) - 260
      airliner.position.set(p, 92, -60 + p * 0.15)
      const strobe = airliner.children[2] as THREE.Sprite
      strobe.material.opacity = Math.abs(Math.sin(tSec * 5)) > 0.85 ? 1 : 0.1
    }

    // clouds drift in a slow ring
    clouds.forEach((cl, i) => {
      const a = tSec * 0.008 + (i / clouds.length) * Math.PI * 2
      cl.position.set(Math.cos(a) * 130, 62 + i * 5, Math.sin(a) * 130)
      cl.material.opacity = (weather === 'clear' ? 0.35 : 0.6) - dark * 0.18
    })

    // fireflies — park sparkle after dark
    if (fireflyMat && fireflyGeo) {
      fireflyMat.opacity = dark * (0.5 + 0.5 * Math.abs(Math.sin(tSec * 1.3)))
      fireflyGeo.attributes.position.needsUpdate = false
    }

    // precipitation
    const precip = weather === 'rain' || weather === 'storm' ? 'rain' : weather === 'snow' ? 'snow' : null
    precipMat.opacity = precip ? (precip === 'rain' ? 0.55 : 0.8) : 0
    precipMat.color.set(precip === 'snow' ? 0xffffff : 0x9db8e8)
    if (precip) {
      const pos = precipGeo.attributes.position
      const fall = precip === 'rain' ? 55 : 8
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - fall * dt
        if (y < 0) y = 70
        if (precip === 'snow') pos.setX(i, pos.getX(i) + Math.sin(tSec * 1.5 + i) * dt * 2)
        pos.setY(i, y)
      }
      pos.needsUpdate = true
    }
    // storm lightning
    if (weather === 'storm') {
      if (flashTimer <= 0 && Math.random() < dt * 0.18) flashTimer = 0.14
    }
    flashTimer = Math.max(0, flashTimer - dt)
    flashLight.intensity = flashTimer > 0 ? 3.4 : 0
  }

  function frame(t: number) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (!visible) return
    const dt = Math.min(0.05, (t - prevT) / 1000 || 0.016)
    prevT = t
    const now = new Date()
    const hour = now.getHours() + now.getMinutes() / 60
    const sky = skyAt(hour)
    const weather = weatherNow()
    // rain and storm mute the daylight
    const dark = Math.min(1, sky.dark + (weather === 'rain' ? 0.12 : weather === 'storm' ? 0.28 : 0))
    const tSec = (t - startT) / 1000

    if (Math.abs(dark - lastTint) > 0.01) {
      tintDome(sky.top, sky.low)
      lastTint = dark
    }
    ;(scene.fog as THREE.Fog).color.copy(sky.low).multiplyScalar(weather === 'clear' ? 0.7 : 0.5)
    ambient.intensity = 0.85 - dark * 0.62
    sun.intensity = Math.max(0.05, 1.15 * (1 - dark) * (weather === 'clear' ? 1 : 0.6))
    plazaLamp.intensity = dark * 26
    starMat.opacity = weather === 'clear' ? dark * 0.9 : dark * 0.15

    const sf = (hour - 6) / 12
    sunSprite.visible = sf > -0.04 && sf < 1.04 && weather !== 'storm'
    if (sunSprite.visible) {
      sunSprite.position.set(Math.cos(Math.PI * (1 - sf)) * 240, Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, sf))) * 170 + 6, -110)
    }
    const mf = ((hour + 24 - 18) % 24) / 12
    moon.visible = mf > -0.04 && mf < 1.04 && dark > 0.2
    if (moon.visible) {
      moon.position.set(Math.cos(Math.PI * (1 - mf)) * 240, Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, mf))) * 170 + 6, -110)
    }

    animateWorld(tSec, dt, dark, weather)

    if (introT < INTRO_S) introT += dt
    if (!dragging) {
      azVel *= 0.95
      azimuth += azVel + 0.0012
    }
    placeCamera()

    // adaptive quality: if the device can't hold ~25fps with bloom, drop it
    if (fxOn && dt > 0.04) {
      if (++slowFrames > 90) fxOn = false
    } else if (slowFrames > 0 && dt < 0.03) slowFrames--
    if (fxOn) composer.render()
    else renderer.render(scene, camera)
  }

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    renderer.setSize(rect.width, rect.height, false)
    composer.setSize(rect.width, rect.height)
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

  return {
    // Photo Mode: render a fresh frame and read it back synchronously
    capture: () => {
      try {
        if (fxOn && !opts.reducedMotion) composer.render()
        else renderer.render(scene, camera)
        return canvas.toDataURL('image/png')
      } catch {
        return null
      }
    },
    setAvatar,
    stop: () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      monument.dispose()
      for (const c of citizens) { saveBrain(c.brain); c.rig.dispose() } // persist session memories
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
      composer.dispose()
      renderer.dispose()
    },
  }
}
