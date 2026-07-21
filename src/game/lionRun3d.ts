/**
 * Lion Run 3D — the endless runner, a cinematic third-person night sprint.
 *
 * Three lanes through a neon canyon: swipe left/right to change lane, tap
 * (or swipe up) to jump, tap again for a double jump. Vault the barriers,
 * dodge the walls, grab amber XP orbs. One hit and you're WASTED.
 *
 * Mobile-first input: the canvas takes touch-action none + pointer capture,
 * and swipes fire the moment the threshold is crossed (not on release), so
 * lane changes feel instant on phones and the browser can never steal the
 * gesture for a scroll.
 *
 * The run climbs STAGES every 400m — each stage re-grades the whole canyon
 * (sky, fog, neon, road markings), speeds the world up and introduces new
 * obstacle patterns. Cinematics: fly-around start swoop, FOV that widens
 * with speed, camera bank into lane changes, orb-collect bursts, slow-mo
 * crash with shake.
 *
 * Same integration contract as the 2D engine (onStart consumes a play token,
 * onOver reports the result); onScore/onStage feed the DOM HUD. Returns null
 * when WebGL is unavailable so the caller can fall back to the 2D runner.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildCharacter, type CharacterRig } from './characterModel'
import { buildWeapon } from './weaponModel'
import { characterById, isVehicle } from '../lib/characters'
import { skinById } from '../lib/lionSkins'
import { haptic } from '../lib/prefs'
import type { RunResult } from './lionRun'

export type AttackKind = 'rocket' | 'bolt' | 'fire' | 'freeze' | 'tornado'
export type Run3DHandle = {
  destroy: () => void
  // race extras (no-ops in solo): start on a synced countdown + take hits
  begin: () => void
  injectAttack: (kind: AttackKind) => void
  // Asphalt-Nitro-style rival: show the opponent's lion racing in this scene,
  // placed from their broadcast distance/lane; and a launch VFX when I attack
  setGhost: (distanceM: number, lane: number, alive: boolean, female?: boolean, skin?: string, character?: string) => void
  fireFx: (kind: AttackKind) => void
  // switch MY lion between lion / lioness live (from the race gender toggle)
  setSelfFemale: (female: boolean) => void
  // change MY lion's skin live (recolor + signature trail)
  setSkin: (skinId: string) => void
  // switch MY character live (lion/lioness/wolf/fox/…) — rebuilds the runner
  setSelfCharacter: (character: string) => void
}
export type Run3DOpts = {
  // a shared seed makes the obstacle/orb track identical on both racers'
  // devices so a friend race is fair (same climate + hazards at every metre)
  seed?: number
  // race mode: don't self-start on tap (a synced countdown calls begin())
  race?: boolean
  // the opponent's name, floated above their ghost lion in a race
  oppName?: string
  // render the player's runner as a lioness (no mane + a flower)
  female?: boolean
  // cosmetic skin id (recolor + trail) — see lib/lionSkins
  skin?: string
  // playable character id (lion/lioness/wolf/fox/…) — see lib/characters
  character?: string
}

type Obstacle = { mesh: THREE.Mesh; lane: number; kind: 'bar' | 'wall' | 'stack' | 'gate' | 'megawall'; z: number; alive: boolean; passed?: boolean }
type Orb = { holder: THREE.Group; lane: number; z: number; alive: boolean }
type Burst = { sprite: THREE.Sprite; t: number }
// floating pickups: 4 power-ups + a Mario-Kart item box + a ground boost pad
type PickKind = 'magnet' | 'shield' | 'jet' | 'x2' | 'box' | 'boost'
type Pickup = { grp: THREE.Group; kind: PickKind; lane: number; z: number; alive: boolean; bob: number }
// live HUD snapshot for the React layer (power-up timers, combo, shield)
export type HudState = {
  score: number
  coins: number
  combo: number
  mult: number
  shield: boolean
  powerups: { kind: 'magnet' | 'jet' | 'x2' | 'boost'; tLeft: number }[]
}

const LANE_X = [-3, 0, 3]
const STAGE_LEN = 400 // metres per stage

// per-stage world grade: sky, fog, road dashes, neon palette, name.
// `day` (0 night → 1 daylight) drives ambient light / star + neon fade, and
// `rain` toggles the storm downpour — so a long run sweeps through real
// weather: midnight → dawn → bright morning → downpour → storm → golden day.
const STAGES = [
  { name: 'MIDNIGHT', bg: 0x07061a, fog: 0x140f2e, dash: 0xffb454, neon: [0xff4fa3, 0x00e5c3, 0x8f7bff, 0x4fd6ff], day: 0, rain: false },
  { name: 'DAWN', bg: 0x2a1c46, fog: 0x6e4a52, dash: 0xffd678, neon: [0xff8fb0, 0xffd678, 0xff8f6a, 0xffb454], day: 0.4, rain: false },
  { name: 'MORNING', bg: 0x8ec9ff, fog: 0xcfe6ff, dash: 0xffffff, neon: [0x6fd0ff, 0xffd678, 0x9be0a8, 0x8ec9ff], day: 1, rain: false },
  { name: 'DOWNPOUR', bg: 0x2a3242, fog: 0x49566a, dash: 0xcfe0ff, neon: [0x4fa0ff, 0xcfe0ff, 0x4fa0ff, 0x9db8e8], day: 0.55, rain: true },
  { name: 'STORM', bg: 0x0a0e1e, fog: 0x1c2a4e, dash: 0xcfe0ff, neon: [0x4fa0ff, 0xffffff, 0x4fa0ff, 0x9db8e8], day: 0.2, rain: true },
  { name: 'GOLDEN DAY', bg: 0x7ec0ff, fog: 0xe6f2ff, dash: 0xffd678, neon: [0xffd678, 0xffb454, 0xffd678, 0x9be0a8], day: 1, rain: false },
]

// small deterministic PRNG (mulberry32) so a seeded race lays down the exact
// same track on both devices
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function startLionRun3D(
  canvas: HTMLCanvasElement,
  cb: {
    onStart: () => void
    onOver: (r: RunResult & { stage?: number }) => void
    onScore?: (score: number, coins: number) => void
    onStage?: (stage: number, name: string) => void
    // race telemetry: fires every frame with live distance/lane/alive so the
    // caller can broadcast it to the opponent (throttled by the caller)
    onProgress?: (distanceM: number, lane: number, alive: boolean) => void
    // rich HUD: power-up timers, combo streak, shield — for the on-screen HUD
    onHud?: (h: HudState) => void
    // Mario-Kart item box grabbed → caller grants a random weapon (race)
    onItemBox?: () => void
  },
  opts: Run3DOpts = {},
): Run3DHandle | null {
  // deterministic in a seeded race, plain Math.random for solo runs
  const rand = opts.seed != null ? mulberry32(opts.seed) : Math.random
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  // phones: cap DPR a touch lower than desktop so shadows + PBR stay smooth
  const lowEnd = (navigator.hardwareConcurrency || 4) <= 4
  renderer.setPixelRatio(Math.min(lowEnd ? 1.5 : 2, window.devicePixelRatio || 1))
  // cinematic colour grading — ACES filmic tone-map turns the flat neon into a
  // photographed look; the sRGB output space keeps colours true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  // soft real-time shadows ground the lion in the world (skipped on weak phones)
  const shadows = !lowEnd
  if (shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
  }

  const scene = new THREE.Scene()
  const bgColor = new THREE.Color(STAGES[0].bg)
  const fogColor = new THREE.Color(STAGES[0].fog)
  scene.background = bgColor
  scene.fog = new THREE.Fog(fogColor.getHex(), 30, 130)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 300)

  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x }

  // image-based lighting: a built-in room environment (no file to download) gives
  // every PBR surface realistic soft reflections + fill light. Free, offline-safe.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = envRT.texture
    scene.environmentIntensity = 0.35 // subtle — the scene is a neon night, not a studio
    disposables.push({ dispose: () => { envRT.dispose(); pmrem.dispose() } })
  } catch { /* PMREM unsupported → lights still light the scene */ }

  // ---------- bloom post-processing (cinematic neon glow on lights/orbs/FX) ----------
  let composer: EffectComposer | null = null
  let bloomOn = false
  try {
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.6, 0.6))
    bloomOn = true
  } catch { composer = null; bloomOn = false }

  // ---------- lights (intensities lerp with the stage's day factor) ----------
  const ambient = new THREE.AmbientLight(0x8f86c8, 0.55)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xffd9a0, 0.9)
  key.position.set(6, 14, 8)
  if (shadows) {
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 60
    key.shadow.camera.left = -12; key.shadow.camera.right = 12
    key.shadow.camera.top = 14; key.shadow.camera.bottom = -14
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.02
    // the lion barely moves in Z (world scrolls past), so aim the shadow box at it
    key.target.position.set(0, 0, -2)
    scene.add(key.target)
  }
  scene.add(key)
  // cool rim/back light — carves a cinematic edge on the lion for a realer look
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6)
  rim.position.set(-5, 7, -12)
  scene.add(rim)

  // ---------- road ----------
  const road = new THREE.Mesh(
    track(new THREE.PlaneGeometry(11, 260)),
    // wet-asphalt PBR: slightly glossy so the neon + shadows read on it
    track(new THREE.MeshStandardMaterial({ color: 0x131120, roughness: 0.55, metalness: 0.15 })),
  )
  road.rotation.x = -Math.PI / 2
  road.position.z = -100
  if (shadows) road.receiveShadow = true
  scene.add(road)
  const shoulderMat = track(new THREE.MeshStandardMaterial({ color: 0x1e1b30, roughness: 0.7, metalness: 0.1 }))
  for (const sx of [-6.4, 6.4]) {
    const sh = new THREE.Mesh(track(new THREE.PlaneGeometry(1.6, 260)), shoulderMat)
    sh.rotation.x = -Math.PI / 2
    sh.position.set(sx, 0.01, -100)
    scene.add(sh)
  }
  const dashMat = track(new THREE.MeshBasicMaterial({ color: STAGES[0].dash }))
  const dashGeo = track(new THREE.PlaneGeometry(0.22, 2))
  const dashes: THREE.Mesh[] = []
  for (const lx of [-1.5, 1.5]) {
    for (let i = 0; i < 24; i++) {
      const d = new THREE.Mesh(dashGeo, dashMat)
      d.rotation.x = -Math.PI / 2
      d.position.set(lx, 0.02, -i * 9)
      scene.add(d)
      dashes.push(d)
    }
  }

  // ---------- neon canyon: instanced towers + colored edge strips ----------
  const nightTex = (() => {
    const cv = document.createElement('canvas')
    cv.width = 64
    cv.height = 128
    const c = cv.getContext('2d')!
    c.fillStyle = '#0c0a1c'
    c.fillRect(0, 0, 64, 128)
    for (let col = 0; col < 4; col++) {
      for (let rw = 0; rw < 9; rw++) {
        if ((col * 13 + rw * 7) % 3 === 0) {
          c.fillStyle = `rgba(255,196,110,${0.5 + ((col + rw) % 5) * 0.1})`
          c.fillRect(7 + col * 14, 8 + rw * 13, 9, 8)
        }
      }
    }
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    return track(t)
  })()
  const towerMat = track(new THREE.MeshLambertMaterial({
    color: 0x16142e,
    emissive: 0xffc46e,
    emissiveMap: nightTex,
    emissiveIntensity: 0.9,
  }))
  const towerGeo = track(new THREE.BoxGeometry(6, 1, 6))
  const towers = new THREE.InstancedMesh(towerGeo, towerMat, 26)
  scene.add(towers)
  const towerData = Array.from({ length: 26 }, (_, i) => ({
    x: (i % 2 === 0 ? -1 : 1) * (10.5 + Math.abs(Math.sin(i * 7)) * 5),
    z: -i * 12,
    h: 8 + Math.abs(Math.sin(i * 13)) * 22,
  }))
  const towerMtx = new THREE.Matrix4()
  function placeTowers() {
    towerData.forEach((td, i) => {
      towerMtx.makeScale(1, td.h, 1).setPosition(td.x, td.h / 2, td.z)
      towers.setMatrixAt(i, towerMtx)
    })
    towers.instanceMatrix.needsUpdate = true
  }
  placeTowers()
  const neonStripGeo = track(new THREE.BoxGeometry(0.25, 1, 0.25))
  const neonStrips: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; idx: number }[] = []
  for (let i = 0; i < 8; i++) {
    const mat = track(new THREE.MeshBasicMaterial({ color: STAGES[0].neon[i % 4] }))
    const strip = new THREE.Mesh(neonStripGeo, mat)
    scene.add(strip)
    neonStrips.push({ mesh: strip, mat, idx: i * 3 })
  }

  // stars + moon
  const starGeo = track(new THREE.BufferGeometry())
  {
    const pts = new Float32Array(160 * 3)
    for (let i = 0; i < 160; i++) {
      pts[i * 3] = (Math.sin(i * 91) * 0.5) * 220
      pts[i * 3 + 1] = 25 + Math.abs(Math.sin(i * 37)) * 90
      pts[i * 3 + 2] = -60 - Math.abs(Math.sin(i * 53)) * 140
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  }
  const starMat = track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, transparent: true, opacity: 0.8, sizeAttenuation: false }))
  scene.add(new THREE.Points(starGeo, starMat))
  const softGlowTex = (color: string) => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const c = cv.getContext('2d')!
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 64)
    return track(new THREE.CanvasTexture(cv))
  }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTex('rgba(235,240,255,1)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  moon.scale.setScalar(18)
  moon.position.set(-24, 55, -160)
  scene.add(moon)

  // a warm sun that fades IN toward daylight (opposite the moon)
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTex('rgba(255,244,214,1)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  sun.scale.setScalar(30)
  sun.position.set(34, 62, -170)
  scene.add(sun)

  // ---------- real sky: a gradient dome that follows the climate palette ----------
  // A big inverted sphere with a horizon→zenith gradient reads as real depth
  // instead of a flat colour. Colours are pushed from the live stage bg/fog
  // each frame (incl. the attack screen-flash), so night/dawn/morning/storm all
  // grade smoothly. Kept behind everything and re-centred on the camera.
  const skyTop = new THREE.Color(STAGES[0].bg).multiplyScalar(0.72)
  const skyBottom = new THREE.Color(STAGES[0].fog)
  const skyMat = track(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: skyTop }, bottom: { value: skyBottom }, offset: { value: 12 }, expo: { value: 0.7 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vW; uniform vec3 top; uniform vec3 bottom; uniform float offset; uniform float expo; void main(){ float h = normalize(vW + vec3(0.0, offset, 0.0)).y; float t = pow(max(h,0.0), expo); gl_FragColor = vec4(mix(bottom, top, clamp(t,0.0,1.0)), 1.0); }',
  }))
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(280, 24, 16)), skyMat)
  sky.renderOrder = -1
  sky.frustumCulled = false
  scene.add(sky)

  // ---------- drifting clouds (puffy by day, dark + heavy in a storm) ----------
  const cloudTex = (() => {
    const cv = document.createElement('canvas')
    cv.width = 128; cv.height = 64
    const c = cv.getContext('2d')!
    // a few overlapping soft blobs = one fluffy cloud
    for (const [cx, cy, r] of [[42, 40, 24], [66, 34, 28], [88, 42, 22], [56, 46, 26], [76, 48, 20]] as [number, number, number][]) {
      const g = c.createRadialGradient(cx, cy, 2, cx, cy, r)
      g.addColorStop(0, 'rgba(255,255,255,0.95)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill()
    }
    return track(new THREE.CanvasTexture(cv))
  })()
  const clouds: { sp: THREE.Sprite; mat: THREE.SpriteMaterial; drift: number }[] = []
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.2, depthWrite: false, fog: false, color: 0xffffff })
    const sp = new THREE.Sprite(mat)
    const w = 34 + (i % 4) * 12
    sp.scale.set(w, w * 0.5, 1)
    sp.position.set(-130 + (i * 47) % 260, 34 + (i % 5) * 11, -80 - (i * 37) % 170)
    sp.renderOrder = 0
    clouds.push({ sp, mat, drift: 2.2 + (i % 3) * 1.4 })
    scene.add(sp)
  }
  const cloudDay = new THREE.Color(0xffffff)
  const cloudStorm = new THREE.Color(0x2b3140)
  const cloudTmp = new THREE.Color()

  // stage-3 rain
  const rainGeo = track(new THREE.BufferGeometry())
  {
    const rp = new Float32Array(300 * 3)
    for (let i = 0; i < 300; i++) {
      rp[i * 3] = (Math.sin(i * 31) * 0.5) * 40
      rp[i * 3 + 1] = Math.abs(Math.sin(i * 17)) * 30
      rp[i * 3 + 2] = -Math.abs(Math.sin(i * 23)) * 60
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3))
  }
  const rainMat = track(new THREE.PointsMaterial({ color: 0x9db8e8, size: 1.4, transparent: true, opacity: 0, sizeAttenuation: false, depthWrite: false }))
  scene.add(new THREE.Points(rainGeo, rainMat))

  // ---------- speed lines: warp streaks that fade in at high velocity ----------
  const speedLineMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }))
  const speedLineGeo = track(new THREE.BoxGeometry(0.06, 0.06, 3))
  const speedLines: THREE.Mesh[] = []
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(speedLineGeo, speedLineMat)
    m.position.set((i % 2 ? 1 : -1) * (4.5 + (i % 4) * 1.5), 0.8 + (i % 5) * 1.7, -10 - ((i * 5) % 90))
    scene.add(m)
    speedLines.push(m)
  }

  // ---------- the runner + grounding blob shadow ----------
  let myCharId = opts.character || 'lion'
  // driving a car/bike/truck = a faster base speed + a HIGH JUMP over the big wall.
  // a plane/heli (a flying vehicle) cruises above the road, faster still, and
  // climbs (tap) to clear the BIG WALL that reaches up into its lane.
  let driving = isVehicle(characterById(myCharId))
  let flying = driving && !!characterById(myCharId).fly
  let mySkinId = opts.skin || 'classic'
  let myFemaleState = !!opts.female
  let rig = buildCharacter(characterById(myCharId), { female: myFemaleState })
  const mySkin = skinById(mySkinId)
  rig.setSkin(mySkin.body, mySkin.mane)
  rig.setGlow(0.35)
  let myTrail: string | null = mySkin.trail // skin's signature glow trail
  if (shadows) rig.enableShadows()
  scene.add(rig.group)
  function rebuildRig() {
    scene.remove(rig.group)
    rig.dispose()
    rig = buildCharacter(characterById(myCharId), { female: myFemaleState })
    const s = skinById(mySkinId)
    rig.setSkin(s.body, s.mane)
    rig.setGlow(0.35)
    myTrail = s.trail
    if (shadows) rig.enableShadows()
    scene.add(rig.group)
  }
  const shadow = new THREE.Mesh(
    track(new THREE.CircleGeometry(1.1, 16)),
    track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  scene.add(shadow)

  // ---------- opponent "ghost" lion (race) — placed from their live state ----------
  // the rival renders as a REAL character (their chosen one) — a lion by
  // default, rebuilt to their actual character + skin when their state arrives.
  // The floating name tag + position are what distinguish it from you.
  let ghostCharId = 'lion'
  let ghost = buildCharacter(characterById(ghostCharId), { phase: 1.7 })
  const gSkin = skinById('classic')
  ghost.setSkin(gSkin.body, gSkin.mane)
  ghost.setGlow(0.35)
  if (shadows) ghost.enableShadows()
  ghost.group.visible = false
  scene.add(ghost.group)
  function rebuildGhost() {
    const wasVisible = ghost.group.visible
    scene.remove(ghost.group)
    ghost.dispose()
    ghost = buildCharacter(characterById(ghostCharId), { phase: 1.7 })
    const s = skinById(ghostSkinId || 'classic')
    ghost.setSkin(s.body, s.mane)
    ghost.setGlow(0.35)
    ghost.setFemale(ghostFemale)
    if (shadows) ghost.enableShadows()
    ghost.group.visible = wasVisible
    scene.add(ghost.group)
  }
  const ghostShadow = new THREE.Mesh(
    track(new THREE.CircleGeometry(1.1, 16)),
    track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })),
  )
  ghostShadow.rotation.x = -Math.PI / 2
  ghostShadow.position.y = 0.02
  ghostShadow.visible = false
  scene.add(ghostShadow)
  // floating name tag above the rival lion
  let ghostLabel: THREE.Sprite | null = null
  if (opts.oppName) {
    const cv = document.createElement('canvas')
    cv.width = 256; cv.height = 64
    const c = cv.getContext('2d')!
    const name = `🦁 ${opts.oppName.slice(0, 12)}`
    c.font = 'bold 30px Inter, sans-serif'
    c.textAlign = 'center'; c.textBaseline = 'middle'
    const w = c.measureText(name).width + 36
    c.fillStyle = 'rgba(6,8,20,0.6)'
    c.beginPath(); c.roundRect(128 - w / 2, 12, w, 40, 20); c.fill()
    c.fillStyle = '#8ee7ff'
    c.fillText(name, 128, 33)
    const tex = track(new THREE.CanvasTexture(cv))
    tex.colorSpace = THREE.SRGBColorSpace
    ghostLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }))
    ghostLabel.scale.set(4, 1, 1)
    ghostLabel.visible = false
    scene.add(ghostLabel)
  }
  let ghostDistM = 0
  let ghostLane = 1
  let ghostAlive = false
  let ghostSeen = false
  let ghostFemale = false
  let ghostSkinId = ''
  let ghostX = 0
  let ghostZ = -8

  // ---------- GTA-style road traffic: a pack running ON the road ahead ----------
  // Humans + animals run/walk down the road ahead of you and drift within a band
  // so you never catch them (no fake collisions). Gated off on weak phones.
  // ground runners are snapped to the 3 lanes so they can jump/duck the REAL
  // obstacles in their lane; flyers (dragon/bat/bird) weave through the sky.
  // mix cars/bikes/trucks + a plane/heli into the traffic alongside animals & people
  const ROAMER_SPECIES = ['car', 'runner', 'bike', 'deer', 'truck', 'wolf', 'plane', 'heli', 'raptor', 'dragon', 'bat', 'bird', 'hero', 'woman', 'robot', 'wyvern']
  const roamerCount = lowEnd ? 0 : 8
  type Roamer = { rig: CharacterRig; lane: number; x: number; z: number; vz: number; y: number; vy: number; slideT: number; gait: 'walk' | 'run'; animSpeed: number; fly: boolean; isVeh: boolean; flyBase: number; flyX: number }
  const roamers: Roamer[] = []
  for (let i = 0; i < roamerCount; i++) {
    const def = characterById(ROAMER_SPECIES[i % ROAMER_SPECIES.length])
    const r = buildCharacter(def, { phase: i * 1.1 })
    if (shadows) r.enableShadows()
    r.group.visible = false
    scene.add(r.group)
    const fly = !!def.fly
    const lane = i % 3
    roamers.push({
      rig: r, lane, x: fly ? (lane - 1) * 3 : LANE_X[lane], z: -26 - i * 13,
      vz: (i % 2 ? 1 : -1) * (2 + (i % 3) * 1.4), y: fly ? 6 : 0, vy: 0,
      slideT: 0, gait: i % 4 === 0 ? 'walk' : 'run', animSpeed: 0.85 + (i % 4) * 0.16,
      fly, isVeh: !!def.vehicle, flyBase: 4.5 + (i % 3) * 2.2, flyX: (lane - 1) * 3,
    })
  }

  // ---------- animated attack VFX ----------
  type Fx = { update: (dt: number, tSec: number) => boolean; cleanup: () => void }
  const fxList: Fx[] = []
  let flashT = 0
  const flashColor = new THREE.Color(0xffffff)
  let rollT = 0
  let rollDir = 1
  const glowCache = new Map<string, THREE.Texture>()
  const glowTex = (color: string) => {
    let t = glowCache.get(color)
    if (!t) { t = softGlowTex(color); glowCache.set(color, t) }
    return t
  }
  function screenFlash(hex: number, dur: number) { flashColor.set(hex); flashT = Math.max(flashT, dur) }
  function burst(x: number, y: number, z: number, color: string, size: number, dur: number) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    sp.position.set(x, y, z)
    scene.add(sp)
    let t = 0
    fxList.push({
      update: (dt) => { t += dt; sp.scale.setScalar(size * (0.4 + (t / dur) * 2.2)); sp.material.opacity = Math.max(0, 1 - t / dur); return t < dur },
      cleanup: () => { scene.remove(sp); sp.material.dispose() },
    })
  }
  // a soft dust puff kicked up behind the running lion (drifts back + up, fades)
  function dustPuff(x: number) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(196,168,128,0.55)'), transparent: true, depthWrite: false, opacity: 0.5 }))
    sp.position.set(x + (rand() - 0.5) * 0.6, 0.3, 1.1)
    scene.add(sp)
    let t = 0
    fxList.push({
      update: (dt2) => {
        t += dt2
        sp.position.z += 5 * dt2
        sp.position.y += 0.5 * dt2
        sp.scale.setScalar(0.7 + t * 3.2)
        sp.material.opacity = Math.max(0, 0.5 - t / 0.4)
        return t < 0.4
      },
      cleanup: () => { scene.remove(sp); sp.material.dispose() },
    })
  }
  // the skin's signature glow trail — an additive streak dropped at the lion
  function trailPuff(x: number, y: number, color: string) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    sp.position.set(x, y, 0.4)
    sp.scale.setScalar(1.5)
    scene.add(sp)
    let t = 0
    fxList.push({
      update: (dt2) => {
        t += dt2
        sp.position.z += 7 * dt2
        sp.scale.setScalar(1.5 - t * 1.8)
        sp.material.opacity = Math.max(0, 1 - t / 0.35)
        return t < 0.35
      },
      cleanup: () => { scene.remove(sp); sp.material.dispose() },
    })
  }
  function rocketIn(lane: number, zStop: number, onArrive: () => void) {
    const w = buildWeapon('rocket')
    w.group.rotation.y = Math.PI // nose faces +z — it flies in toward the player
    w.group.scale.setScalar(1.5)
    const trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,150,60,0.9)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    trail.scale.setScalar(2.4)
    trail.position.z = 0.7 // trails behind the nose
    w.group.add(trail)
    w.group.position.set(LANE_X[lane], 1.5, -95)
    scene.add(w.group)
    let done = false
    fxList.push({
      update: (dt) => {
        w.group.position.z += 150 * dt
        w.group.rotation.z += dt * 18
        if (w.group.position.z >= zStop && !done) {
          done = true
          burst(LANE_X[lane], 1.3, zStop, 'rgba(255,140,50,0.95)', 2.6, 0.5)
          shakeT = Math.max(shakeT, 0.4)
          onArrive()
          return false
        }
        return true
      },
      cleanup: () => { scene.remove(w.group); trail.material.dispose(); w.dispose() },
    })
  }
  function tornadoIn(lane: number) {
    const w = buildWeapon('tornado')
    w.group.position.set(LANE_X[lane], 0.4, -60)
    scene.add(w.group)
    fxList.push({
      update: (dt, tSec) => {
        w.group.position.z += 24 * dt
        w.group.rotation.y = tSec * 13
        const s = 1 + Math.sin(tSec * 11) * 0.14
        w.group.scale.set(s, 1, s)
        return w.group.position.z < 9
      },
      cleanup: () => { scene.remove(w.group); w.dispose() },
    })
  }

  // ---------- obstacle + orb pools ----------
  const barMat = track(new THREE.MeshStandardMaterial({ color: 0xffb454, emissive: 0xffb454, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.3 }))
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0x8a2f3c, emissive: 0xff4655, emissiveIntensity: 0.2, roughness: 0.6, metalness: 0.1 }))
  const crateMat = track(new THREE.MeshStandardMaterial({ color: 0x7a4e26, roughness: 0.85, metalness: 0.05 }))
  const barGeo = track(new THREE.BoxGeometry(2.6, 1, 0.5))
  const wallGeo = track(new THREE.BoxGeometry(2.7, 3.6, 0.7))
  const stackGeo = track(new THREE.BoxGeometry(2.4, 2.4, 1.2))
  // an overhead gate you SLIDE under (swipe down) — jumping into it = crash
  const gateGeo = track(new THREE.BoxGeometry(2.7, 0.7, 0.6))
  const gateMat = track(new THREE.MeshStandardMaterial({ color: 0x2f6f8a, emissive: 0x33d6ff, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.4 }))
  // the BIG WALL — too tall to jump on foot (dodge it), but a driven vehicle's
  // high jump clears it clean (top ≈ 4.4; the car's jump apex ≈ 5.3 clears it)
  const megawallGeo = track(new THREE.BoxGeometry(2.7, 4.4, 0.9))
  const megawallMat = track(new THREE.MeshStandardMaterial({ color: 0x5a2a6a, emissive: 0x9b3fb5, emissiveIntensity: 0.28, roughness: 0.6, metalness: 0.15 }))
  const obstacles: Obstacle[] = []

  const orbGeo = track(new THREE.SphereGeometry(0.32, 10, 8))
  const orbMat = track(new THREE.MeshBasicMaterial({ color: 0xffd678 }))
  const orbGlowTex = softGlowTex('rgba(255,214,120,0.9)')
  const orbs: Orb[] = []
  const bursts: Burst[] = []
  function spawnOrb(lane: number, z: number) {
    const holder = new THREE.Group()
    holder.add(new THREE.Mesh(orbGeo, orbMat))
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.scale.setScalar(1.6)
    holder.add(glow)
    holder.position.set(LANE_X[lane], 1.1, z)
    scene.add(holder)
    orbs.push({ holder, lane, z, alive: true })
  }
  function spawnObstacle(lane: number, kind: Obstacle['kind'], z: number) {
    const geo = kind === 'bar' ? barGeo : kind === 'wall' ? wallGeo : kind === 'gate' ? gateGeo : kind === 'megawall' ? megawallGeo : stackGeo
    const mat = kind === 'bar' ? barMat : kind === 'wall' ? wallMat : kind === 'gate' ? gateMat : kind === 'megawall' ? megawallMat : crateMat
    const mesh = new THREE.Mesh(geo, mat)
    const y = kind === 'bar' ? 0.5 : kind === 'wall' ? 1.8 : kind === 'gate' ? 2.7 : kind === 'megawall' ? 2.2 : 1.2
    mesh.position.set(LANE_X[lane], y, z)
    if (shadows && (kind === 'wall' || kind === 'stack' || kind === 'megawall')) { mesh.castShadow = true; mesh.receiveShadow = true }
    scene.add(mesh)
    obstacles.push({ mesh, lane, kind, z, alive: true })
  }

  // ---------- pickups: power-ups, item boxes, boost pads ----------
  const emojiCache = new Map<string, THREE.Texture>()
  function emojiTex(e: string) {
    let t = emojiCache.get(e)
    if (t) return t
    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const c = cv.getContext('2d')!
    c.font = '46px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(e, 32, 37)
    t = track(new THREE.CanvasTexture(cv))
    t.colorSpace = THREE.SRGBColorSpace
    emojiCache.set(e, t)
    return t
  }
  const PICK_EMOJI: Record<PickKind, string> = { magnet: '🧲', shield: '🛡️', jet: '🚀', x2: '✨', box: '❓', boost: '⏩' }
  const PICK_GLOW: Record<PickKind, string> = {
    magnet: 'rgba(255,90,90,0.9)', shield: 'rgba(90,220,255,0.9)', jet: 'rgba(255,150,60,0.9)',
    x2: 'rgba(255,214,120,0.95)', box: 'rgba(180,120,255,0.95)', boost: 'rgba(90,240,200,0.95)',
  }
  const pickups: Pickup[] = []
  function spawnPickup(lane: number, kind: PickKind, z: number) {
    const grp = new THREE.Group()
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(PICK_GLOW[kind]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.scale.setScalar(kind === 'boost' ? 2.8 : 2.2)
    grp.add(glow)
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex(PICK_EMOJI[kind]), transparent: true, depthWrite: false }))
    icon.scale.setScalar(1.5)
    grp.add(icon)
    grp.position.set(LANE_X[lane], kind === 'boost' ? 0.6 : 1.5, z)
    scene.add(grp)
    pickups.push({ grp, kind, lane, z, alive: true, bob: rand() * 6 })
  }

  // ---------- power-up visuals worn by the runner ----------
  const shieldBubble = new THREE.Mesh(
    track(new THREE.SphereGeometry(1.9, 18, 12)),
    track(new THREE.MeshBasicMaterial({ color: 0x5adcff, transparent: true, opacity: 0.2, depthWrite: false })),
  )
  shieldBubble.visible = false
  scene.add(shieldBubble)
  const magnetRing = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.7, 0.13, 8, 24)),
    track(new THREE.MeshBasicMaterial({ color: 0xff5a6e, transparent: true, opacity: 0.7, depthWrite: false })),
  )
  magnetRing.rotation.x = -Math.PI / 2
  magnetRing.visible = false
  scene.add(magnetRing)
  const jetFlame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,150,60,0.95)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  jetFlame.visible = false
  scene.add(jetFlame)
  function collectBurst(x: number, y: number, z: number) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    sp.position.set(x, y, z)
    sp.scale.setScalar(1.4)
    scene.add(sp)
    bursts.push({ sprite: sp, t: 0 })
  }

  // ---------- game state ----------
  let state: 'ready' | 'swoop' | 'run' | 'dying' | 'dead' = 'ready'
  let raf = 0
  let prevT = 0
  let dist = 0
  let speed = 16
  let elapsed = 0
  let coins = 0
  let lane = 1
  let lionX = 0
  let lionY = 0
  let vy = 0
  let jumps = 0
  let nextSpawnZ = -60
  let shownScore = -1
  let shakeT = 0
  let swoopT = 0
  let dyingT = 0
  let stage = 1
  let stunT = 0 // seconds of "bolt" stun left (race attack): no steering + slowed
  // power-up timers (seconds) + one-shot shield + slide + combo streak
  let flyAlt = 4 // flying vehicles cruise here; a tap climbs, decays back down
  let magnetT = 0
  let jetT = 0
  let x2T = 0
  let boostT = 0
  let shield = false
  let slideT = 0
  let combo = 0
  let comboT = 0
  let dustT = 0 // throttle for the running dust trail
  let trailT = 0 // throttle for the skin's signature glow trail
  let fov = 55
  // adaptive: drop pixel ratio if the phone can't hold frame rate
  let slowFrames = 0
  let loweredDpr = false

  const distM = () => dist / 4
  const stageFor = () => Math.min(STAGES.length, 1 + Math.floor(distM() / STAGE_LEN))
  function score() {
    return Math.floor(dist / 2) + coins * 10
  }

  // kick off the run — from a tap in solo, or from the synced countdown
  // (begin()) in a race
  function begin() {
    if (state !== 'ready') return
    state = 'swoop'
    swoopT = 0
    cb.onStart()
    cb.onStage?.(1, STAGES[0].name)
  }
  function startOrJump() {
    if (state === 'ready') {
      // in a race the countdown starts everyone together — ignore taps
      if (!opts.race) begin()
      return
    }
    if (state !== 'run' || stunT > 0) return
    if (flying) {
      // a plane/heli climbs on a tap (to clear the big wall); it decays back to cruise
      flyAlt = Math.min(8.2, flyAlt + 2.6)
      haptic(14)
      return
    }
    if (jumps < 2) {
      // vehicles get a HIGH JUMP so they clear the big wall; on foot = normal
      vy = driving
        ? (jumps === 0 ? 16 : 11)
        : (jumps === 0 ? 9.4 : 8.2)
      jumps++
      haptic(driving ? 18 : 12)
    }
  }
  function move(dir: -1 | 1) {
    if (state !== 'run' || stunT > 0) return
    lane = Math.max(0, Math.min(2, lane + dir))
    haptic(8)
  }
  // swipe DOWN → slide under overhead gates for ~0.6s
  function slide() {
    if (state !== 'run' || stunT > 0) return
    if (flying) { flyAlt = Math.max(1.6, flyAlt - 2.2); haptic(8); return } // dive
    if (jetT > 0 || slideT > 0) return
    slideT = 0.6
    haptic(8)
  }
  // combo streak multiplies coin value (x2 at 10, x3 at 20); the ✨ power-up
  // stacks on top
  const comboMult = () => (combo >= 20 ? 3 : combo >= 10 ? 2 : 1)
  function addCoin(n = 1) {
    coins += n * (x2T > 0 ? 2 : 1) * comboMult()
    combo++
    comboT = 2.5
  }
  function activatePickup(kind: PickKind, lane2: number) {
    haptic(16)
    burst(LANE_X[lane2], 1.6, 0, PICK_GLOW[kind], 2.2, 0.45)
    if (kind === 'magnet') magnetT = 8
    else if (kind === 'shield') shield = true
    else if (kind === 'jet') { jetT = 5; jumps = 0 }
    else if (kind === 'x2') x2T = 10
    else if (kind === 'boost') { boostT = 1.8; screenFlash(0x5af0c8, 0.15) }
    else if (kind === 'box') { addCoin(3); cb.onItemBox?.() } // race: grants a random weapon
  }
  // weaving past an obstacle one lane over = a near-miss whoosh + bonus
  function nearMiss(oLane: number) {
    burst(LANE_X[oLane], 1.5, 0.5, 'rgba(255,255,255,0.9)', 1.4, 0.28)
    addCoin(1)
    haptic(5)
  }
  function reportHud() {
    const pu: HudState['powerups'] = []
    if (magnetT > 0) pu.push({ kind: 'magnet', tLeft: magnetT })
    if (jetT > 0) pu.push({ kind: 'jet', tLeft: jetT })
    if (x2T > 0) pu.push({ kind: 'x2', tLeft: x2T })
    if (boostT > 0) pu.push({ kind: 'boost', tLeft: boostT })
    cb.onHud?.({ score: score(), coins, combo, mult: comboMult(), shield, powerups: pu })
  }
  // an attack from the opponent lands on THIS runner (race only), each with a
  // distinct animation
  function injectAttack(kind: AttackKind) {
    if (state !== 'run') return
    haptic(30)
    if (kind === 'bolt') {
      // thunder: a 3D lightning bolt strikes down + white flash + shake + stun
      stunT = Math.max(stunT, 1.2)
      screenFlash(0xffffff, 0.42)
      shakeT = Math.max(shakeT, 0.5)
      weaponBurstAt('bolt', lionX, 3.4, -1.5, 0.45)
      burst(lionX, 3.4, -2, 'rgba(200,225,255,0.95)', 2.6, 0.4)
      haptic([40, 30, 40])
      return
    }
    if (kind === 'freeze') {
      // ice: a 3D ice crystal + longer, heavier slow + blue frost flash
      stunT = Math.max(stunT, 1.8)
      screenFlash(0x8fdcff, 0.55)
      weaponBurstAt('freeze', lionX, 1.8, -2.5, 0.6)
      burst(lionX, 1.6, -3, 'rgba(150,220,255,0.9)', 3, 0.6)
      return
    }
    if (kind === 'tornado') {
      // twister: blocks two lanes + spins the camera
      rollT = 0.9
      rollDir = rand() < 0.5 ? -1 : 1
      const open = Math.floor(rand() * 3)
      for (let l = 0; l < 3; l++) if (l !== open) spawnObstacle(l, 'wall', -52)
      tornadoIn(Math.floor(rand() * 3))
      screenFlash(0x9db8e8, 0.25)
      return
    }
    if (kind === 'fire') {
      // fireball: a 3D fireball hurls in + a low flame wall to JUMP + orange burst
      spawnObstacle(lane, 'bar', -44)
      weaponBurstAt('fire', LANE_X[lane], 1.0, -44, 0.6)
      burst(LANE_X[lane], 0.9, -44, 'rgba(255,95,30,0.95)', 2.8, 0.6)
      screenFlash(0xff5a1e, 0.3)
      return
    }
    // rocket: streaks in and explodes on a wall dropped in your lane — dodge it
    spawnObstacle(lane, 'wall', -42)
    rocketIn(lane, -42, () => {})
    screenFlash(0xff8a3a, 0.18)
  }
  // spawn a 3D weapon model at a point that pops in, spins and fades out
  // (used when an attack LANDS on this runner)
  function weaponBurstAt(kind: AttackKind, x: number, y: number, z: number, dur: number) {
    const w = buildWeapon(kind)
    w.group.position.set(x, y, z)
    scene.add(w.group)
    let t = 0
    fxList.push({
      update: (dt) => {
        t += dt
        const pop = Math.min(1, t / 0.1)
        const fade = t > dur - 0.15 ? Math.max(0, (dur - t) / 0.15) : 1
        w.group.scale.setScalar((0.5 + pop * 0.9) * (0.7 + fade * 0.3))
        if (w.spin) w.group.rotation[w.spin.axis] += dt * w.spin.rate
        else w.group.rotation.y += dt * 8
        return t < dur
      },
      cleanup: () => { scene.remove(w.group); w.dispose() },
    })
  }
  // I fired at the opponent — a real 3D projectile streaks from my lion to their ghost
  function fireFx(kind: AttackKind) {
    const color = kind === 'bolt' ? 'rgba(190,225,255,0.95)'
      : kind === 'freeze' ? 'rgba(150,220,255,0.95)'
      : kind === 'fire' ? 'rgba(255,120,40,0.95)'
      : kind === 'tornado' ? 'rgba(200,215,235,0.95)'
      : 'rgba(255,170,80,0.95)'
    const w = buildWeapon(kind)
    const trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    trail.scale.setScalar(1.7)
    trail.position.z = 0.5
    w.group.add(trail)
    const fromV = new THREE.Vector3(lionX, 1.5, 0.4)
    const toV = new THREE.Vector3(ghostX, 1.5, ghostZ)
    w.group.position.copy(fromV)
    scene.add(w.group)
    let t = 0
    const dur = 0.5
    fxList.push({
      update: (dt) => {
        t += dt
        const k = Math.min(1, t / dur)
        w.group.position.lerpVectors(fromV, toV, k)
        if (w.spin) w.group.rotation[w.spin.axis] += dt * w.spin.rate
        else w.group.rotation.z += dt * 10
        if (k >= 1) { burst(toV.x, 1.4, toV.z, color, 1.8, 0.4); return false }
        return true
      },
      cleanup: () => { scene.remove(w.group); trail.material.dispose(); w.dispose() },
    })
    haptic(15)
  }
  function setGhost(distanceM: number, lane2: number, alive: boolean, female?: boolean, skin?: string, character?: string) {
    ghostSeen = true
    ghostDistM = distanceM
    ghostLane = Math.max(0, Math.min(2, lane2))
    ghostAlive = alive
    if (character !== undefined && character !== ghostCharId) {
      ghostCharId = character
      rebuildGhost() // reapplies current skin + female to the new character
    }
    if (female !== undefined && female !== ghostFemale) {
      ghostFemale = female
      ghost.setFemale(female)
    }
    if (skin !== undefined && skin !== ghostSkinId) {
      ghostSkinId = skin
      const s = skinById(skin)
      ghost.setSkin(s.body, s.mane)
    }
  }
  function setSelfFemale(female: boolean) { myFemaleState = female; rig.setFemale(female) }
  function setSkin(skinId: string) {
    mySkinId = skinId
    const s = skinById(skinId)
    rig.setSkin(s.body, s.mane)
    myTrail = s.trail
  }
  function setSelfCharacter(character: string) {
    if (character === myCharId) return
    myCharId = character
    driving = isVehicle(characterById(myCharId))
    flying = driving && !!characterById(myCharId).fly
    flyAlt = 4
    rebuildRig() // reapplies current skin + gender to the new runner
  }

  // ---------- mobile-first input ----------
  // Swipes trigger mid-gesture the moment the threshold is crossed; taps
  // resolve on release. touch-action none + pointer capture keep the
  // browser from ever turning the gesture into a scroll.
  canvas.style.touchAction = 'none'
  let gestureId = -1
  let gx0 = 0
  let gy0 = 0
  let gt0 = 0
  let gestureUsed = false
  function onDown(e: PointerEvent) {
    e.preventDefault()
    gestureId = e.pointerId
    gx0 = e.clientX
    gy0 = e.clientY
    gt0 = performance.now()
    gestureUsed = false
    try { canvas.setPointerCapture(e.pointerId) } catch { /* fine */ }
  }
  function onMove(e: PointerEvent) {
    if (e.pointerId !== gestureId || gestureUsed) return
    const dx = e.clientX - gx0
    const dy = e.clientY - gy0
    if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      move(dx > 0 ? 1 : -1)
      gestureUsed = true
    } else if (dy < -34 && Math.abs(dy) > Math.abs(dx)) {
      startOrJump()
      gestureUsed = true
    } else if (dy > 34 && Math.abs(dy) > Math.abs(dx)) {
      slide() // swipe down = slide under gates
      gestureUsed = true
    }
  }
  function onUp(e: PointerEvent) {
    if (e.pointerId !== gestureId) return
    gestureId = -1
    if (!gestureUsed && performance.now() - gt0 < 450) startOrJump()
  }
  function onCancel(e: PointerEvent) {
    if (e.pointerId === gestureId) gestureId = -1
  }
  function onKey(e: KeyboardEvent) {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); startOrJump() }
    if (e.code === 'ArrowLeft') { e.preventDefault(); move(-1) }
    if (e.code === 'ArrowRight') { e.preventDefault(); move(1) }
    if (e.code === 'ArrowDown') { e.preventDefault(); slide() }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey)

  function spawnWave() {
    while (nextSpawnZ > -180) {
      const z = nextSpawnZ
      // difficulty is keyed to TRACK POSITION (not the player's wall-clock
      // stage) so a seeded race lays the same hazards for both runners
      const sStage = Math.min(STAGES.length, 1 + Math.floor((-z / 4) / STAGE_LEN))
      const roll = rand()
      const freeLanes = [0, 1, 2]
      if (roll < 0.30) {
        const l2 = Math.floor(rand() * 3)
        spawnObstacle(l2, 'bar', z)
        // stage 4+: bars come in pairs across two lanes
        if (sStage >= 4 && rand() < 0.5) {
          freeLanes.splice(freeLanes.indexOf(l2), 1)
          spawnObstacle(freeLanes[Math.floor(rand() * freeLanes.length)], 'bar', z)
        }
      } else if (roll < 0.58) {
        const l2 = Math.floor(rand() * 3)
        // stage 3+: some walls become the BIG WALL — dodge it on foot, or clear
        // it with a driven vehicle's high jump
        const big = sStage >= 3 && rand() < 0.32
        spawnObstacle(l2, big ? 'megawall' : 'wall', z)
        freeLanes.splice(freeLanes.indexOf(l2), 1)
        // stage 2+: a crate stack narrows the escape to one lane (not behind a big wall)
        if (!big && sStage >= 2 && rand() < 0.35 + sStage * 0.08) {
          const l3 = freeLanes[Math.floor(rand() * freeLanes.length)]
          spawnObstacle(l3, 'stack', z)
          freeLanes.splice(freeLanes.indexOf(l3), 1)
        }
      } else if (roll < 0.72 && sStage >= 2) {
        // overhead gate(s) — SLIDE under them
        const l2 = Math.floor(rand() * 3)
        spawnObstacle(l2, 'gate', z)
        if (sStage >= 3 && rand() < 0.4) {
          freeLanes.splice(freeLanes.indexOf(l2), 1)
          spawnObstacle(freeLanes[Math.floor(rand() * freeLanes.length)], 'gate', z)
        }
      } else {
        const l2 = Math.floor(rand() * 3)
        for (let k = 0; k < 4; k++) spawnOrb(l2, z - k * 2.2)
      }
      // occasional pickup: power-up, Mario-Kart item box, or a boost pad
      if (rand() < 0.16) {
        const pr = rand()
        const kind: PickKind = pr < 0.2 ? 'magnet' : pr < 0.38 ? 'shield' : pr < 0.5 ? 'jet'
          : pr < 0.66 ? 'x2' : pr < 0.84 ? 'boost' : 'box'
        spawnPickup(Math.floor(rand() * 3), kind, z - 4)
      }
      // deterministic gap in a race (no wall-clock speed term); widen it with
      // track position so the faster later stages stay dodgeable
      const gapExtra = opts.seed != null ? 12 + sStage * 3 : speed * 0.35
      nextSpawnZ -= Math.max(12, 16 + rand() * 14 - sStage * 1.5) + gapExtra
    }
  }

  function crash() {
    state = 'dying'
    dyingT = 0
    shakeT = 0.55
    haptic([60, 40, 120])
  }

  function scrollWorld(dz: number, tSec: number) {
    nextSpawnZ += dz
    spawnWave()
    for (const o of obstacles) {
      if (!o.alive) continue
      const prevZ = o.z
      o.z += dz
      o.mesh.position.z = o.z
      if (!o.passed && prevZ < 0 && o.z >= 0) {
        o.passed = true
        if (state === 'run' && Math.abs(o.lane - lane) === 1) nearMiss(o.lane)
      }
      if (o.z > 6) { o.alive = false; scene.remove(o.mesh) }
    }
    for (const orb of orbs) {
      if (!orb.alive) continue
      orb.z += dz
      orb.holder.position.z = orb.z
      orb.holder.rotation.y = tSec * 3
      if (orb.z > 6) { orb.alive = false; scene.remove(orb.holder) }
    }
    for (const p of pickups) {
      if (!p.alive) continue
      p.z += dz
      p.grp.position.z = p.z
      if (p.kind !== 'boost') p.grp.position.y = 1.5 + Math.sin(tSec * 3 + p.bob) * 0.2 // bob
      p.grp.children[1] && (p.grp.rotation.y = tSec * 2)
      if (p.z > 6) { p.alive = false; scene.remove(p.grp) }
    }
    for (const d of dashes) {
      d.position.z += dz
      if (d.position.z > 4) d.position.z -= 24 * 9
    }
    for (const sl of speedLines) {
      sl.position.z += dz * 2.4 // stream past faster than the world for a warp feel
      if (sl.position.z > 12) sl.position.z -= 100
    }
    towerData.forEach((td) => {
      td.z += dz * 0.92
      if (td.z > 10) td.z -= 26 * 12
    })
    placeTowers()
    neonStrips.forEach((ns) => {
      const td = towerData[ns.idx]
      ns.mesh.position.set(td.x + (td.x < 0 ? 3.1 : -3.1), td.h * 0.5, td.z)
      ns.mesh.scale.y = td.h * 0.8
    })
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame)
    const rawDt = Math.min(0.05, (t - prevT) / 1000 || 0.016)
    prevT = t
    const tSec = t / 1000
    // slow-mo while dying — the crash lands, then WASTED
    const dt = state === 'dying' ? rawDt * 0.25 : rawDt

    if (state === 'swoop') {
      swoopT += rawDt
      const dz = (6 + 10 * Math.min(1, swoopT / 1.1)) * dt
      dist += dz
      scrollWorld(dz, tSec)
      if (swoopT >= 1.1) state = 'run'
    }

    if (state === 'run' || state === 'dying') {
      if (state === 'run') {
        elapsed += dt
        const ns = stageFor()
        if (ns !== stage) {
          stage = ns
          cb.onStage?.(stage, STAGES[stage - 1].name)
          haptic([30, 30, 30])
        }
        // keeps accelerating the further/longer you run — noticeably faster
        // deep into a run (per-stage jump + a steady time ramp), capped high.
        // driving is +30% (flying +55%) faster, with a higher ceiling
        const base = 16 + (stage - 1) * 4.8 + elapsed * 0.55
        speed = flying ? Math.min(80, base * 1.55) : driving ? Math.min(70, base * 1.3) : Math.min(54, base)
        if (stunT > 0) stunT = Math.max(0, stunT - dt)
      }
      // boost pad speeds you up; a bolt/freeze stun drags you down
      const dz = speed * (state === 'run' && stunT > 0 ? 0.32 : 1) * (boostT > 0 ? 1.6 : 1) * dt
      dist += dz
      // tick power-up / combo / slide timers
      if (state === 'run') {
        if (boostT > 0) boostT = Math.max(0, boostT - dt)
        if (magnetT > 0) magnetT = Math.max(0, magnetT - dt)
        if (x2T > 0) x2T = Math.max(0, x2T - dt)
        if (slideT > 0) slideT = Math.max(0, slideT - dt)
        if (comboT > 0) { comboT = Math.max(0, comboT - dt); if (comboT === 0) combo = 0 }
      }

      // vertical: flying vehicle cruises at flyAlt (taps climb, decays back);
      // the jetpack flies you up (no gravity); else normal jump/gravity
      if (flying && state === 'run') {
        flyAlt += (4 - flyAlt) * Math.min(1, dt * 0.9) // decay back to cruise
        lionY += (flyAlt - lionY) * Math.min(1, dt * 6)
        vy = 0
        jumps = 0
      } else if (jetT > 0 && state === 'run') {
        jetT = Math.max(0, jetT - dt)
        lionY += (5 - lionY) * Math.min(1, dt * 6)
        vy = 0
        jumps = 0
      } else {
        vy -= 24 * dt
        lionY = Math.max(0, lionY + vy * dt)
        if (lionY === 0 && vy < 0) { vy = 0; jumps = 0 }
      }
      lionX += (LANE_X[lane] - lionX) * Math.min(1, dt * 11)

      scrollWorld(dz, tSec)

      if (state === 'run') {
        // coin orbs — collected in your lane, or reeled in while the magnet's up
        for (const orb of orbs) {
          if (!orb.alive) continue
          if (magnetT > 0 && orb.z > -24 && orb.z < 5) {
            orb.holder.position.x += (lionX - orb.holder.position.x) * Math.min(1, dt * 5)
          }
          const inReach = orb.lane === lane || (magnetT > 0 && Math.abs(orb.holder.position.x - lionX) < 1.3)
          if (Math.abs(orb.z) > 1 || !inReach) continue
          orb.alive = false
          scene.remove(orb.holder)
          addCoin()
          collectBurst(lionX, 1.3, 0)
          haptic(6)
        }
        // power-ups / item boxes / boost pads — grabbed by lane (any height)
        for (const p of pickups) {
          if (!p.alive || Math.abs(p.z) > 1.4 || p.lane !== lane) continue
          p.alive = false
          scene.remove(p.grp)
          activatePickup(p.kind, p.lane)
        }
        // collisions — the jetpack flies over everything; a shield eats one hit;
        // bars = jump, gates = slide, walls/stacks = dodge
        if (jetT === 0) {
          for (const o of obstacles) {
            if (!o.alive || Math.abs(o.z) > 0.8 || o.lane !== lane) continue
            const clears = flying
              // a plane/heli skims over ground hazards; only the BIG WALL
              // reaches its lane — climb (tap) above it to clear
              ? (o.kind === 'megawall' ? lionY > 4.3 : true)
              : driving
              // a car/bike/truck high-jumps bars, walls and the big wall; slides gates
              ? (o.kind === 'bar' ? lionY > 1.05
                : o.kind === 'stack' ? lionY > 2.5
                : o.kind === 'gate' ? slideT > 0
                : o.kind === 'wall' ? lionY > 3.5
                : o.kind === 'megawall' ? lionY > 4.3
                : false)
              // on foot: jump bars/stacks, slide gates, DODGE walls + the big wall
              : (o.kind === 'bar' ? lionY > 1.05
                : o.kind === 'stack' ? lionY > 2.5
                : o.kind === 'gate' ? slideT > 0
                : false)
            if (!clears) {
              if (shield) {
                shield = false
                o.alive = false
                scene.remove(o.mesh)
                burst(lionX, 1.5, 0, 'rgba(90,220,255,0.95)', 3.2, 0.5)
                screenFlash(0x5adcff, 0.22)
                shakeT = Math.max(shakeT, 0.3)
                haptic(30)
              } else {
                crash()
              }
              break
            }
          }
        }
        const s = score()
        if (s !== shownScore) {
          shownScore = s
          cb.onScore?.(s, coins)
        }
        reportHud()
        cb.onProgress?.(distM(), lane, true)
      }
    }

    if (state === 'dying') {
      dyingT += rawDt
      if (dyingT > 0.55) {
        state = 'dead'
        const result: RunResult & { stage: number } = { score: score(), coins, distanceM: Math.round(distM()), stage }
        setTimeout(() => cb.onOver(result), 150)
      }
    }

    // stage theme cross-fade
    const theme = STAGES[stage - 1]
    bgColor.lerp(new THREE.Color(theme.bg), Math.min(1, rawDt * 1.4))
    fogColor.lerp(new THREE.Color(theme.fog), Math.min(1, rawDt * 1.4))
    scene.background = bgColor
    ;(scene.fog as THREE.Fog).color.copy(state === 'dying' ? new THREE.Color(0x481420) : fogColor)
    dashMat.color.lerp(new THREE.Color(theme.dash), Math.min(1, rawDt * 1.4))
    neonStrips.forEach((ns, i) => ns.mat.color.lerp(new THREE.Color(theme.neon[i % 4]), Math.min(1, rawDt * 1.4)))
    // climate: fade lights up toward daylight, stars/moon/neon down; rain per stage
    const k = Math.min(1, rawDt * 1.4)
    const day = theme.day
    ambient.intensity += (0.5 + day * 0.95 - ambient.intensity) * k
    key.intensity += (0.85 + day * 0.55 - key.intensity) * k
    starMat.opacity += (0.8 * (1 - day) - starMat.opacity) * k
    const moonMat = moon.material as THREE.SpriteMaterial
    moonMat.opacity += ((1 - day) - moonMat.opacity) * k
    towerMat.emissiveIntensity += (0.9 * (1 - day * 0.7) - towerMat.emissiveIntensity) * k
    rainMat.opacity += ((theme.rain ? 0.6 : 0) - rainMat.opacity) * Math.min(1, rawDt * 2)
    // sun fades in with daylight; dome stays centred on the camera
    const sunMat = sun.material as THREE.SpriteMaterial
    sunMat.opacity += (day - sunMat.opacity) * k
    sky.position.copy(camera.position)
    // sky gradient follows the live climate palette (+ any attack screen-flash)
    const skyFlash = flashT > 0 ? Math.min(0.85, flashT * 2.2) : 0
    skyTop.copy(bgColor).multiplyScalar(0.72)
    skyBottom.copy(bgColor).lerp(fogColor, 0.5)
    if (skyFlash > 0) { skyTop.lerp(flashColor, skyFlash); skyBottom.lerp(flashColor, skyFlash) }
    // clouds: white + puffy by day, dark + heavy in a storm, sparse at night
    const cloudOpacity = theme.rain ? 0.92 : 0.2 + day * 0.62
    cloudTmp.copy(cloudStorm).lerp(cloudDay, theme.rain ? Math.min(day, 0.4) : day)
    for (const cl of clouds) {
      cl.sp.position.x += cl.drift * rawDt
      if (cl.sp.position.x > 140) cl.sp.position.x -= 280
      cl.mat.opacity += (cloudOpacity - cl.mat.opacity) * k
      cl.mat.color.lerp(cloudTmp, k)
    }
    // attack screen-flash (thunder white / fire orange / freeze blue) fades out
    if (flashT > 0) {
      flashT = Math.max(0, flashT - rawDt)
      scene.background = bgColor.clone().lerp(flashColor, Math.min(0.85, flashT * 2.2))
    }
    // speed lines fade + stretch with velocity (and blast during a boost pad)
    const warp = Math.max(0, Math.min(0.7, (speed - 28) / 22)) + (boostT > 0 ? 0.5 : 0)
    speedLineMat.opacity += (Math.min(0.85, warp) - speedLineMat.opacity) * Math.min(1, rawDt * 5)
    const stretch = 1 + warp * 4 + (boostT > 0 ? 4 : 0)
    for (const sl of speedLines) sl.scale.z = stretch
    if (rainMat.opacity > 0.02) {
      const pos = rainGeo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - 34 * rawDt
        if (y < 0) y = 30
        pos.setY(i, y)
      }
      pos.needsUpdate = true
    }

    // orb-collect bursts
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]
      b.t += rawDt
      b.sprite.scale.setScalar(1.4 + b.t * 6)
      b.sprite.material.opacity = Math.max(0, 1 - b.t / 0.35)
      if (b.t > 0.35) {
        scene.remove(b.sprite)
        b.sprite.material.dispose()
        bursts.splice(i, 1)
      }
    }

    // character pose — gallop, lean into lane changes, tuck in the air, slide.
    // (procedural rig = code-driven; gltf rig = AnimationMixer clip crossfade)
    const sliding = slideT > 0
    rig.group.position.set(lionX, lionY, 0)
    rig.group.rotation.z = (LANE_X[lane] - lionX) * -0.06
    const airborne = lionY > 0.05
    rig.pose({ tSec, running: state === 'run' || state === 'swoop', airborne, sliding, dead: state === 'dying' || state === 'dead' })
    rig.update(rawDt)
    // power-up auras + x2 mane glow
    shieldBubble.visible = shield
    if (shield) {
      shieldBubble.position.set(lionX, lionY + 0.9, 0)
      ;(shieldBubble.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(tSec * 6) * 0.06
    }
    magnetRing.visible = magnetT > 0
    if (magnetT > 0) {
      magnetRing.position.set(lionX, 0.3, 0)
      magnetRing.rotation.z = tSec * 3
      magnetRing.scale.setScalar(1 + Math.sin(tSec * 8) * 0.12)
    }
    jetFlame.visible = jetT > 0
    if (jetT > 0) {
      jetFlame.position.set(lionX, lionY - 0.6, 0.2)
      jetFlame.scale.setScalar(1.8 + Math.sin(tSec * 30) * 0.5)
    }
    rig.setGlow(x2T > 0 ? 0.9 : 0.35)
    // grounding shadow shrinks while airborne
    shadow.position.x = lionX
    const sh = Math.max(0.35, 1 - lionY * 0.28)
    shadow.scale.setScalar(sh)
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * sh

    // ---- rival ghost lion: placed from their broadcast distance/lane ----
    if (ghostSeen) {
      const show = ghostAlive
      ghost.group.visible = show
      ghostShadow.visible = show
      if (ghostLabel) ghostLabel.visible = show
      // ahead of me = negative z; clamp to a visible band so a runaway leader
      // still shows at the horizon and a straggler sits just behind
      const targetZ = Math.max(-62, Math.min(7, -(ghostDistM - distM()) * 4))
      ghostZ += (targetZ - ghostZ) * Math.min(1, rawDt * 6)
      ghostX += (LANE_X[ghostLane] - ghostX) * Math.min(1, rawDt * 8)
      ghost.group.position.set(ghostX, 0, ghostZ)
      ghost.group.rotation.z = (LANE_X[ghostLane] - ghostX) * -0.06
      ghost.pose({ tSec, running: true, airborne: false, sliding: false, dead: !ghostAlive })
      ghost.update(rawDt)
      ghostShadow.position.set(ghostX, 0.02, ghostZ)
      if (ghostLabel) ghostLabel.position.set(ghostX, 3.5, ghostZ)
    }

    // ---- running dust trail (kicked up while grounded) ----
    if (state === 'run' && lionY < 0.4 && jetT === 0) {
      dustT -= rawDt
      if (dustT <= 0) { dustT = 0.1; dustPuff(lionX) }
    }
    // ---- skin's signature glow trail (streams behind the lion at any height) ----
    if (state === 'run' && myTrail) {
      trailT -= rawDt
      if (trailT <= 0) { trailT = 0.05; trailPuff(lionX, lionY + 0.9, myTrail) }
    }

    // ---- road traffic: humans + animals running the road ahead of you ----
    // They drift within a band [-120,-7] so they stay AHEAD (no collisions) and
    // occasionally hop. Math.random (NOT the seeded PRNG) → seeded races stay synced.
    if (roamers.length && (state === 'run' || state === 'swoop' || state === 'dying')) {
      for (const r of roamers) {
        r.z += r.vz * rawDt
        if (r.z > -7) r.vz = -Math.abs(r.vz)
        else if (r.z < -120) r.vz = Math.abs(r.vz)
        if (r.fly) {
          // flyers weave through the sky over the road, no gravity
          r.y = r.flyBase + Math.sin(tSec * 1.6 + r.z * 0.05) * 1.4
          r.x = r.flyX + Math.sin(tSec * 0.7 + r.z * 0.03) * 1.7
        } else {
          // react to REAL obstacles in this lane: jump bars/walls, duck gates
          // (ground vehicles just drive — no hopping)
          if (r.slideT > 0) r.slideT -= rawDt
          if (!r.isVeh && r.y === 0 && r.slideT <= 0) {
            for (const o of obstacles) {
              if (!o.alive || o.lane !== r.lane) continue
              if (o.z > r.z - 6 && o.z < r.z + 1.5) {
                if (o.kind === 'gate') r.slideT = 0.55
                else if (o.kind === 'bar' || o.kind === 'stack') r.vy = 7 // hop the jumpable ones
                // walls/big-walls: can't clear on foot — just keep running
                break
              }
            }
          }
          r.vy -= 22 * rawDt
          r.y = Math.max(0, r.y + r.vy * rawDt)
          if (r.y === 0 && r.vy < 0) r.vy = 0
        }
      }
    }
    for (const r of roamers) {
      r.rig.group.visible = r.rig.ready()
      r.rig.group.position.set(r.x, r.y, r.z)
      r.rig.pose({ tSec: tSec * r.animSpeed + r.z * 0.11, running: true, walk: r.gait === 'walk', airborne: !r.fly && r.y > 0.1, sliding: r.slideT > 0, dead: false })
      r.rig.update(rawDt * r.animSpeed)
    }

    // ---- animated attack VFX ----
    for (let i = fxList.length - 1; i >= 0; i--) {
      if (!fxList[i].update(rawDt, tSec)) { fxList[i].cleanup(); fxList.splice(i, 1) }
    }

    // camera: fly-around swoop into a speed-pumped chase cam with crash shake
    shakeT = Math.max(0, shakeT - rawDt)
    const shake = shakeT > 0 ? Math.sin(tSec * 70) * shakeT * 0.6 : 0
    const targetFov = 55 + Math.max(0, speed - 16) * 0.5 + (boostT > 0 ? 12 : 0)
    fov += (Math.min(70, targetFov) - fov) * Math.min(1, rawDt * 3)
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    if (state === 'ready' || state === 'swoop') {
      const k = state === 'ready' ? 0 : Math.min(1, swoopT / 1.1)
      const e = 1 - (1 - k) * (1 - k) * (1 - k)
      const ang = -2.1 * (1 - e) // side-front → behind
      camera.position.set(Math.sin(ang) * 10 + lionX * 0.5, 3.4 + 2.2 * e, Math.cos(ang) * 11.5)
      camera.lookAt(lionX, 1.6, e * -14)
    } else {
      camera.position.set(lionX * 0.5 + shake, 5.6 + lionY * 0.25, 11.5)
      camera.lookAt(lionX * 0.55, 1.3 + lionY * 0.35, -14)
    }
    // tornado disorient: roll the camera for its duration (after lookAt)
    if (rollT > 0) {
      rollT = Math.max(0, rollT - rawDt)
      camera.rotation.z += Math.sin(tSec * 9) * rollT * 0.35 * rollDir
    }

    // adaptive pixel ratio for weaker phones
    if (!loweredDpr && rawDt > 0.045) {
      if (++slowFrames > 60) {
        loweredDpr = true
        renderer.setPixelRatio(1)
        bloomOn = false // drop bloom too on weak phones
      }
    } else if (slowFrames > 0 && rawDt < 0.03) slowFrames--

    if (bloomOn && composer) composer.render()
    else renderer.render(scene, camera)
  }

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    renderer.setSize(rect.width, rect.height, false)
    composer?.setSize(rect.width, rect.height)
    camera.aspect = rect.width / rect.height
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  if (canvas.parentElement) ro.observe(canvas.parentElement)
  resize()
  spawnWave()
  raf = requestAnimationFrame(frame)

  return {
    destroy: () => {
      cancelAnimationFrame(raf)
      rig.dispose()
      ghost.dispose()
      for (const r of roamers) r.rig.dispose()
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
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
      composer?.dispose()
      renderer.dispose()
    },
    begin,
    injectAttack,
    setGhost,
    fireFx,
    setSelfFemale,
    setSkin,
    setSelfCharacter,
  }
}
