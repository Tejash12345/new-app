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
import { buildLion } from './lionModel'
import type { RunResult } from './lionRun'

export type Run3DHandle = { destroy: () => void }

type Obstacle = { mesh: THREE.Mesh; lane: number; kind: 'bar' | 'wall' | 'stack'; z: number; alive: boolean }
type Orb = { holder: THREE.Group; lane: number; z: number; alive: boolean }
type Burst = { sprite: THREE.Sprite; t: number }

const LANE_X = [-3, 0, 3]
const STAGE_LEN = 400 // metres per stage

// per-stage world grade: sky, fog, road dashes, neon palette, name
const STAGES = [
  { name: 'MIDNIGHT', bg: 0x07061a, fog: 0x140f2e, dash: 0xffb454, neon: [0xff4fa3, 0x00e5c3, 0x8f7bff, 0x4fd6ff] },
  { name: 'CYBER', bg: 0x0a0418, fog: 0x2a0f3e, dash: 0x00e5c3, neon: [0x00f0ff, 0xff2fd6, 0x00f0ff, 0xff2fd6] },
  { name: 'STORM', bg: 0x0a0e1e, fog: 0x1c2a4e, dash: 0xcfe0ff, neon: [0x4fa0ff, 0xffffff, 0x4fa0ff, 0x9db8e8] },
  { name: 'INFERNO', bg: 0x160608, fog: 0x3e1210, dash: 0xff7b3a, neon: [0xff7b3a, 0xff4646, 0xffb454, 0xff4646] },
  { name: 'GOLDEN DAWN', bg: 0x241536, fog: 0x6e3a2a, dash: 0xffd678, neon: [0xffd678, 0xffb454, 0xffd678, 0xffb454] },
]

export function startLionRun3D(
  canvas: HTMLCanvasElement,
  cb: {
    onStart: () => void
    onOver: (r: RunResult & { stage?: number }) => void
    onScore?: (score: number, coins: number) => void
    onStage?: (stage: number, name: string) => void
  },
): Run3DHandle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))

  const scene = new THREE.Scene()
  const bgColor = new THREE.Color(STAGES[0].bg)
  const fogColor = new THREE.Color(STAGES[0].fog)
  scene.background = bgColor
  scene.fog = new THREE.Fog(fogColor.getHex(), 30, 130)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 300)

  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x }

  // ---------- lights ----------
  scene.add(new THREE.AmbientLight(0x8f86c8, 0.55))
  const key = new THREE.DirectionalLight(0xffd9a0, 0.9)
  key.position.set(6, 14, 8)
  scene.add(key)

  // ---------- road ----------
  const road = new THREE.Mesh(
    track(new THREE.PlaneGeometry(11, 260)),
    track(new THREE.MeshLambertMaterial({ color: 0x131120 })),
  )
  road.rotation.x = -Math.PI / 2
  road.position.z = -100
  scene.add(road)
  const shoulderMat = track(new THREE.MeshLambertMaterial({ color: 0x1e1b30 }))
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
  scene.add(new THREE.Points(starGeo, track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, transparent: true, opacity: 0.8, sizeAttenuation: false }))))
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

  // ---------- the runner + grounding blob shadow ----------
  const rig = buildLion()
  rig.group.rotation.y = Math.PI / 2 // face down the road (-z)
  rig.group.scale.setScalar(0.5)
  rig.maneMat.color.set(0xffb454)
  rig.maneMat.emissiveIntensity = 0.35
  rig.bodyMat.color.set(0x3a2410)
  scene.add(rig.group)
  const shadow = new THREE.Mesh(
    track(new THREE.CircleGeometry(1.1, 16)),
    track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  scene.add(shadow)

  // ---------- obstacle + orb pools ----------
  const barMat = track(new THREE.MeshLambertMaterial({ color: 0xffb454, emissive: 0xffb454, emissiveIntensity: 0.25 }))
  const wallMat = track(new THREE.MeshLambertMaterial({ color: 0x8a2f3c, emissive: 0xff4655, emissiveIntensity: 0.2 }))
  const crateMat = track(new THREE.MeshLambertMaterial({ color: 0x7a4e26 }))
  const barGeo = track(new THREE.BoxGeometry(2.6, 1, 0.5))
  const wallGeo = track(new THREE.BoxGeometry(2.7, 3.6, 0.7))
  const stackGeo = track(new THREE.BoxGeometry(2.4, 2.4, 1.2))
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
    const geo = kind === 'bar' ? barGeo : kind === 'wall' ? wallGeo : stackGeo
    const mat = kind === 'bar' ? barMat : kind === 'wall' ? wallMat : crateMat
    const mesh = new THREE.Mesh(geo, mat)
    const y = kind === 'bar' ? 0.5 : kind === 'wall' ? 1.8 : 1.2
    mesh.position.set(LANE_X[lane], y, z)
    scene.add(mesh)
    obstacles.push({ mesh, lane, kind, z, alive: true })
  }
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
  let fov = 55
  // adaptive: drop pixel ratio if the phone can't hold frame rate
  let slowFrames = 0
  let loweredDpr = false

  const distM = () => dist / 4
  const stageFor = () => Math.min(STAGES.length, 1 + Math.floor(distM() / STAGE_LEN))
  function score() {
    return Math.floor(dist / 2) + coins * 10
  }

  function startOrJump() {
    if (state === 'ready') {
      state = 'swoop'
      swoopT = 0
      cb.onStart()
      cb.onStage?.(1, STAGES[0].name)
      return
    }
    if (state !== 'run') return
    if (jumps < 2) {
      vy = jumps === 0 ? 9.4 : 8.2
      jumps++
      navigator.vibrate?.(12)
    }
  }
  function move(dir: -1 | 1) {
    if (state !== 'run') return
    lane = Math.max(0, Math.min(2, lane + dir))
    navigator.vibrate?.(8)
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
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey)

  function spawnWave() {
    while (nextSpawnZ > -180) {
      const z = nextSpawnZ
      const roll = Math.random()
      const freeLanes = [0, 1, 2]
      if (roll < 0.34) {
        const l2 = Math.floor(Math.random() * 3)
        spawnObstacle(l2, 'bar', z)
        // stage 4+: bars come in pairs across two lanes
        if (stage >= 4 && Math.random() < 0.5) {
          freeLanes.splice(freeLanes.indexOf(l2), 1)
          spawnObstacle(freeLanes[Math.floor(Math.random() * freeLanes.length)], 'bar', z)
        }
      } else if (roll < 0.72) {
        const l2 = Math.floor(Math.random() * 3)
        spawnObstacle(l2, 'wall', z)
        freeLanes.splice(freeLanes.indexOf(l2), 1)
        // stage 2+: a crate stack narrows the escape to one lane
        if (stage >= 2 && Math.random() < 0.35 + stage * 0.08) {
          const l3 = freeLanes[Math.floor(Math.random() * freeLanes.length)]
          spawnObstacle(l3, 'stack', z)
          freeLanes.splice(freeLanes.indexOf(l3), 1)
        }
      } else {
        const l2 = Math.floor(Math.random() * 3)
        for (let k = 0; k < 4; k++) spawnOrb(l2, z - k * 2.2)
      }
      nextSpawnZ -= Math.max(12, 16 + Math.random() * 14 - stage * 1.5) + speed * 0.35
    }
  }

  function crash() {
    state = 'dying'
    dyingT = 0
    shakeT = 0.55
    navigator.vibrate?.([60, 40, 120])
  }

  function scrollWorld(dz: number, tSec: number) {
    nextSpawnZ += dz
    spawnWave()
    for (const o of obstacles) {
      if (!o.alive) continue
      o.z += dz
      o.mesh.position.z = o.z
      if (o.z > 6) { o.alive = false; scene.remove(o.mesh) }
    }
    for (const orb of orbs) {
      if (!orb.alive) continue
      orb.z += dz
      orb.holder.position.z = orb.z
      orb.holder.rotation.y = tSec * 3
      if (orb.z > 6) { orb.alive = false; scene.remove(orb.holder) }
    }
    for (const d of dashes) {
      d.position.z += dz
      if (d.position.z > 4) d.position.z -= 24 * 9
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
          navigator.vibrate?.([30, 30, 30])
        }
        speed = Math.min(38, 16 + (stage - 1) * 3.5 + elapsed * 0.35)
      }
      const dz = speed * dt
      dist += dz

      vy -= 24 * dt
      lionY = Math.max(0, lionY + vy * dt)
      if (lionY === 0 && vy < 0) { vy = 0; jumps = 0 }
      lionX += (LANE_X[lane] - lionX) * Math.min(1, dt * 11)

      scrollWorld(dz, tSec)

      if (state === 'run') {
        // orb pickup
        for (const orb of orbs) {
          if (!orb.alive || Math.abs(orb.z) > 0.9 || orb.lane !== lane || lionY > 2.2) continue
          orb.alive = false
          scene.remove(orb.holder)
          coins++
          collectBurst(LANE_X[orb.lane], 1.3, 0)
          navigator.vibrate?.(8)
        }
        // collision at the lion's plane
        for (const o of obstacles) {
          if (!o.alive || Math.abs(o.z) > 0.8 || o.lane !== lane) continue
          const clears = o.kind === 'bar' ? lionY > 1.05 : o.kind === 'stack' ? lionY > 2.5 : false
          if (!clears) { crash(); break }
        }
        const s = score()
        if (s !== shownScore) {
          shownScore = s
          cb.onScore?.(s, coins)
        }
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
    rainMat.opacity += ((stage === 3 ? 0.6 : 0) - rainMat.opacity) * Math.min(1, rawDt * 2)
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

    // lion pose — gallop, lean into lane changes, tuck in the air
    rig.group.position.set(lionX, lionY, 0)
    rig.group.rotation.z = (LANE_X[lane] - lionX) * -0.06
    const airborne = lionY > 0.05
    rig.legs.forEach((leg, i) => {
      leg.rotation.x = airborne ? 0.5 : Math.sin(tSec * 14 + (i % 2) * Math.PI) * 0.7
    })
    rig.body.scale.y = 1 + (airborne ? 0.04 : Math.sin(tSec * 14) * 0.04)
    rig.tail.rotation.x = Math.sin(tSec * 8) * 0.3
    rig.headGroup.rotation.y = Math.PI / 2
    // grounding shadow shrinks while airborne
    shadow.position.x = lionX
    const sh = Math.max(0.35, 1 - lionY * 0.28)
    shadow.scale.setScalar(sh)
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * sh

    // camera: fly-around swoop into a speed-pumped chase cam with crash shake
    shakeT = Math.max(0, shakeT - rawDt)
    const shake = shakeT > 0 ? Math.sin(tSec * 70) * shakeT * 0.6 : 0
    const targetFov = 55 + Math.max(0, speed - 16) * 0.5
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

    // adaptive pixel ratio for weaker phones
    if (!loweredDpr && rawDt > 0.045) {
      if (++slowFrames > 60) {
        loweredDpr = true
        renderer.setPixelRatio(1)
      }
    } else if (slowFrames > 0 && rawDt < 0.03) slowFrames--

    renderer.render(scene, camera)
  }

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    renderer.setSize(rect.width, rect.height, false)
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
      renderer.dispose()
    },
  }
}
