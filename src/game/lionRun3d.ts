/**
 * Lion Run 3D — the endless runner, now a third-person night sprint.
 *
 * Three lanes through a neon canyon: swipe left/right to change lane, tap
 * (or swipe up) to jump, double-tap for a double jump. Vault the barriers,
 * dodge the walls, grab amber XP orbs. One hit and you're WASTED.
 *
 * Same integration contract as the 2D engine (onStart consumes a play token,
 * onOver reports the result); onScore feeds the DOM HUD. Returns null when
 * WebGL is unavailable so the caller can fall back to the 2D runner.
 */
import * as THREE from 'three'
import { buildLion } from './lionModel'
import type { RunResult } from './lionRun'

export type Run3DHandle = { destroy: () => void }

type Obstacle = { mesh: THREE.Mesh; lane: number; kind: 'bar' | 'wall' | 'stack'; z: number; alive: boolean }
type Orb = { holder: THREE.Group; lane: number; z: number; alive: boolean }

const LANE_X = [-3, 0, 3]

export function startLionRun3D(
  canvas: HTMLCanvasElement,
  cb: { onStart: () => void; onOver: (r: RunResult) => void; onScore?: (score: number, coins: number) => void },
): Run3DHandle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x07061a)
  scene.fog = new THREE.Fog(0x140f2e, 30, 130)
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
  // scrolling lane dashes
  const dashMat = track(new THREE.MeshBasicMaterial({ color: 0xffb454 }))
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

  // ---------- neon canyon: instanced towers on both sides ----------
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
  const neonColors = [0xff4fa3, 0x00e5c3, 0x8f7bff, 0x4fd6ff]
  const neonStripGeo = track(new THREE.BoxGeometry(0.25, 1, 0.25))
  const neonStrips: { mesh: THREE.Mesh; idx: number }[] = []
  for (let i = 0; i < 8; i++) {
    const mat = track(new THREE.MeshBasicMaterial({ color: neonColors[i % 4] }))
    const strip = new THREE.Mesh(neonStripGeo, mat)
    scene.add(strip)
    neonStrips.push({ mesh: strip, idx: i * 3 })
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
  const moonCv = document.createElement('canvas')
  moonCv.width = moonCv.height = 64
  {
    const c = moonCv.getContext('2d')!
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30)
    g.addColorStop(0, 'rgba(235,240,255,1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 64)
  }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: track(new THREE.CanvasTexture(moonCv)), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  moon.scale.setScalar(18)
  moon.position.set(-24, 55, -160)
  scene.add(moon)

  // ---------- the runner ----------
  const rig = buildLion()
  rig.group.rotation.y = Math.PI / 2 // face down the road (-z)
  rig.group.scale.setScalar(0.5)
  rig.maneMat.color.set(0xffb454)
  rig.maneMat.emissiveIntensity = 0.35
  rig.bodyMat.color.set(0x3a2410)
  scene.add(rig.group)

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
  const orbGlowTex = (() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const c = cv.getContext('2d')!
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30)
    g.addColorStop(0, 'rgba(255,214,120,0.9)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 64)
    return track(new THREE.CanvasTexture(cv))
  })()
  const orbs: Orb[] = []
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

  // ---------- game state ----------
  let state: 'ready' | 'run' | 'dead' = 'ready'
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

  function score() {
    return Math.floor(dist / 2) + coins * 10
  }

  function startOrJump() {
    if (state === 'ready') {
      state = 'run'
      cb.onStart()
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
  }

  // swipe detection: horizontal swipe = lane, upward swipe or tap = jump
  let px = 0
  let py = 0
  let pt = 0
  function onDown(e: PointerEvent) {
    e.preventDefault()
    px = e.clientX
    py = e.clientY
    pt = performance.now()
  }
  function onUp(e: PointerEvent) {
    const dx = e.clientX - px
    const dy = e.clientY - py
    const fast = performance.now() - pt < 500
    if (fast && Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1)
    else startOrJump()
  }
  function onKey(e: KeyboardEvent) {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); startOrJump() }
    if (e.code === 'ArrowLeft') { e.preventDefault(); move(-1) }
    if (e.code === 'ArrowRight') { e.preventDefault(); move(1) }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey)

  function spawnWave() {
    while (nextSpawnZ > -180) {
      const z = nextSpawnZ
      const roll = Math.random()
      const freeLanes = [0, 1, 2]
      if (roll < 0.34) {
        // one full-width-ish bar row: jump it
        const l2 = Math.floor(Math.random() * 3)
        spawnObstacle(l2, 'bar', z)
      } else if (roll < 0.72) {
        // wall + maybe a crate: dodge
        const l2 = Math.floor(Math.random() * 3)
        spawnObstacle(l2, 'wall', z)
        freeLanes.splice(freeLanes.indexOf(l2), 1)
        if (elapsed > 15 && Math.random() < 0.5) {
          const l3 = freeLanes[Math.floor(Math.random() * freeLanes.length)]
          spawnObstacle(l3, 'stack', z)
          freeLanes.splice(freeLanes.indexOf(l3), 1)
        }
      } else {
        // orb arc in a random lane
        const l2 = Math.floor(Math.random() * 3)
        for (let k = 0; k < 4; k++) spawnOrb(l2, z - k * 2.2)
      }
      nextSpawnZ -= 16 + Math.random() * 14 + speed * 0.35
    }
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (t - prevT) / 1000 || 0.016)
    prevT = t
    const tSec = t / 1000

    if (state === 'run') {
      elapsed += dt
      speed = Math.min(34, 16 + elapsed * 0.55)
      const dz = speed * dt
      dist += dz

      // physics
      vy -= 24 * dt
      lionY = Math.max(0, lionY + vy * dt)
      if (lionY === 0 && vy < 0) { vy = 0; jumps = 0 }
      lionX += (LANE_X[lane] - lionX) * Math.min(1, dt * 11)

      // world scroll — move everything toward the camera and recycle
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
        else if (Math.abs(orb.z) < 0.9 && orb.lane === lane && lionY < 2.2) {
          orb.alive = false
          scene.remove(orb.holder)
          coins++
          navigator.vibrate?.(8)
        }
      }
      for (const d of dashes) {
        d.position.z += dz
        if (d.position.z > 4) d.position.z -= 24 * 9
      }
      towerData.forEach((td) => {
        td.z += dz * 0.92 // slight parallax
        if (td.z > 10) td.z -= 26 * 12
      })
      placeTowers()
      neonStrips.forEach((ns) => {
        const td = towerData[ns.idx]
        ns.mesh.position.set(td.x + (td.x < 0 ? 3.1 : -3.1), td.h * 0.5, td.z)
        ns.mesh.scale.y = td.h * 0.8
      })

      // collision at the lion's plane
      for (const o of obstacles) {
        if (!o.alive || Math.abs(o.z) > 0.8 || o.lane !== lane) continue
        const clears = o.kind === 'bar' ? lionY > 1.05 : o.kind === 'stack' ? lionY > 2.5 : false
        if (!clears) {
          state = 'dead'
          shakeT = 0.5
          navigator.vibrate?.([60, 40, 120])
          const result: RunResult = { score: score(), coins, distanceM: Math.round(dist / 4) }
          setTimeout(() => cb.onOver(result), 550)
          break
        }
      }

      const s = score()
      if (s !== shownScore) {
        shownScore = s
        cb.onScore?.(s, coins)
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

    // camera follow with crash shake
    shakeT = Math.max(0, shakeT - dt)
    const shake = shakeT > 0 ? Math.sin(tSec * 70) * shakeT * 0.6 : 0
    camera.position.set(lionX * 0.5 + shake, 5.6 + lionY * 0.25, 11.5)
    camera.lookAt(lionX * 0.55, 1.3 + lionY * 0.35, -14)
    scene.fog!.color.set(state === 'dead' && shakeT > 0.2 ? 0x481420 : 0x140f2e)

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
      canvas.removeEventListener('pointerup', onUp)
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
