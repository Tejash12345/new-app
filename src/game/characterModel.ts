/**
 * Character rig adapter for Lion Run.
 *
 * One `CharacterRig` interface the runner engine drives, backed by EITHER:
 *  - the procedural primitive lion (`lionModel.buildLion`) — animated by code,
 *    behaves exactly as the original hand-tuned lion (hero, lioness, fallback);
 *  - a lazy-loaded glTF model (Quaternius CC0, or a realistic drop-in) with a
 *    real skeleton + AnimationMixer clips (Gallop/Idle/Jump/Death).
 *
 * The engine never touches `.legs`/`.bodyMat` directly any more — it calls
 * `pose()`, `update()`, `setSkin()`, `setGlow()`, `setFemale()`. So both rig
 * kinds are fully interchangeable and every existing feature (skins, lioness,
 * rival ghost, shadows, glow trails, VFX) keeps working.
 *
 * GLBs are cached once per URL and cloned per instance (SkeletonUtils) with
 * per-instance materials, so player + rival can wear different skins without
 * bleeding, and nothing precached bloats the app (see vite PWA globPatterns).
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { buildLion, setLionFemale, disposeLion, type LionRig } from './lionModel'
import type { CharacterDef, CharClips } from '../lib/characters'

/** Per-frame pose request from the engine. */
export type PoseInput = {
  tSec: number
  running: boolean
  airborne: boolean
  sliding: boolean
  dead: boolean
  walk?: boolean
}

export type CharacterRig = {
  group: THREE.Group
  /** drive the animation (procedural leg-swing OR mixer clip crossfade). */
  pose: (o: PoseInput) => void
  /** advance the AnimationMixer (no-op for the procedural rig). */
  update: (dt: number) => void
  /** cosmetic skin recolour (coat + mane); mane ignored for non-lions. */
  setSkin: (bodyHex: number, maneHex: number) => void
  /** emissive glow strength (x2-coins aura); 0.35 idle → 0.9 boosted. */
  setGlow: (intensity: number) => void
  /** lion ⇄ lioness (procedural only; no-op for gltf). */
  setFemale: (female: boolean) => void
  /** enable shadow casting on every mesh. */
  enableShadows: () => void
  /** true once a gltf model has finished loading (always true for procedural). */
  ready: () => boolean
  dispose: () => void
}

// ---------------------------------------------------------------------------
// GLTF cache — load a URL once, clone per instance.
// ---------------------------------------------------------------------------
type Loaded = { scene: THREE.Object3D; animations: THREE.AnimationClip[] }
const _cache = new Map<string, Promise<Loaded>>()
let _loader: GLTFLoader | null = null

function loadGLTF(url: string): Promise<Loaded> {
  const hit = _cache.get(url)
  if (hit) return hit
  const p = new Promise<Loaded>((resolve, reject) => {
    _loader = _loader || new GLTFLoader()
    _loader.load(url, (g) => resolve({ scene: g.scene, animations: g.animations }), undefined, reject)
  })
  _cache.set(url, p)
  return p
}

/** Warm the cache for a character so it's ready by the time the game starts. */
export function preloadCharacterModel(url?: string) {
  if (url) loadGLTF(url).catch(() => {})
}

// Memoized HEAD probe for optional drop-in models (avoids repeat 404s).
const _probe = new Map<string, Promise<boolean>>()
function modelExists(url: string): Promise<boolean> {
  const hit = _probe.get(url)
  if (hit) return hit
  const p = fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)
  _probe.set(url, p)
  return p
}

/** Resolve a logical clip (run/idle/jump/death/walk) to a real AnimationClip,
 *  preferring the def's hint then falling back to keywords — robust to any rig. */
function pickClip(clips: THREE.AnimationClip[], want: keyof CharClips, hint?: string): THREE.AnimationClip | null {
  const norm = (s: string) => s.toLowerCase().replace(/^.*\|/, '') // strip "Armature|" prefix
  if (hint) {
    const h = norm(hint)
    const exact = clips.find((c) => norm(c.name) === h) || clips.find((c) => norm(c.name).includes(h))
    if (exact) return exact
  }
  const kw: Record<string, string[]> = {
    run: ['gallop', 'run', 'sprint'],
    idle: ['idle'],
    jump: ['gallop_jump', 'jump', 'leap', 'hop'],
    death: ['death', 'die', 'dead', 'hit'],
    walk: ['walk'],
    slide: ['duck', 'slide', 'roll', 'crouch'],
  }
  for (const k of kw[want] || [want]) {
    const c = clips.find((cl) => norm(cl.name).includes(k))
    if (c) return c
  }
  return null
}

// ---------------------------------------------------------------------------
// buildCharacter
// ---------------------------------------------------------------------------
export function buildCharacter(def: CharacterDef, opts?: { female?: boolean; phase?: number }): CharacterRig {
  const group = new THREE.Group()
  const phase = opts?.phase || 0
  const female0 = !!(opts?.female || def.female) // lioness def OR explicit override
  let shadowsWanted = false

  // ---- procedural core (the lion/lioness AND the placeholder/fallback) ----
  let lion: LionRig | null = null
  function buildProc(female: boolean) {
    const l = buildLion({ female })
    l.group.rotation.y = Math.PI / 2 // face down the road (-z)
    l.group.scale.setScalar(0.5)
    if (shadowsWanted) l.group.traverse((o) => { (o as THREE.Mesh).castShadow = true })
    group.add(l.group)
    lion = l
  }

  // ---- gltf state ----
  let mixer: THREE.AnimationMixer | null = null
  let inner: THREE.Object3D | null = null // the model (for slide crouch)
  const actions: Partial<Record<keyof CharClips, THREE.AnimationAction | null>> = {}
  let current: THREE.AnimationAction | null = null
  const bodyMats: THREE.MeshStandardMaterial[] = []
  const maneMats: THREE.MeshStandardMaterial[] = [] // attached lion mane (recoloured by skin maneHex)
  const clonedMats: THREE.Material[] = []
  const clonedGeoms: THREE.BufferGeometry[] = []
  let pendingSkin: [number, number] | null = null
  let pendingGlow: number | null = null
  let loaded = false

  function play(name: keyof CharClips, o?: { once?: boolean; fade?: number }) {
    const a = actions[name]
    if (!a || a === current) return
    const fade = o?.fade ?? 0.18
    a.reset()
    if (o?.once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
    a.enabled = true
    a.fadeIn(fade)
    a.play()
    if (current) current.fadeOut(fade)
    current = a
  }

  function setupGLTF(res: Loaded, withMane = false) {
    // swap the procedural placeholder out for the real model
    if (lion) { group.remove(lion.group); disposeLion(lion); lion = null }

    const model = skeletonClone(res.scene)
    const wantMats = new Set((def.bodyMats || []).map((s) => s.toLowerCase()))
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!(m as unknown as { isMesh?: boolean }).isMesh) return
      m.frustumCulled = false // skinned bounds drift → don't cull mid-animation
      if (shadowsWanted) m.castShadow = true
      // clone geometry per instance so the engine's destroy() can dispose it
      // without corrupting the shared cached model used for replays.
      const geo = (m.geometry as THREE.BufferGeometry).clone()
      m.geometry = geo
      clonedGeoms.push(geo)
      const src = Array.isArray(m.material) ? m.material : [m.material]
      const cloned = src.map((mm) => {
        const c = (mm as THREE.Material).clone()
        clonedMats.push(c)
        const std = c as THREE.MeshStandardMaterial
        if ((std as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial &&
            wantMats.has((std.name || '').toLowerCase())) {
          bodyMats.push(std)
        }
        return c
      })
      m.material = Array.isArray(m.material) ? cloned : cloned[0]
    })

    // auto-normalize: centre on X/Z, plant feet at y=0, scale to targetHeight.
    // Skinned meshes store a tiny bind-pose geometry (the real size comes from
    // the skeleton), so Box3.setFromObject under-measures — measure the BONE
    // world positions instead, falling back to the mesh box for rigid models.
    model.updateWorldMatrix(true, true)
    const box = new THREE.Box3()
    const bones: THREE.Object3D[] = []
    model.traverse((o) => { if ((o as unknown as { isBone?: boolean }).isBone) bones.push(o) })
    if (bones.length) {
      const v = new THREE.Vector3()
      for (const b of bones) box.expandByPoint(b.getWorldPosition(v))
    } else {
      box.setFromObject(model)
    }
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    model.position.set(-centre.x, -box.min.y, -centre.z)
    const s = size.y > 0 ? (def.targetHeight || 1.7) / size.y : 1
    const holder = new THREE.Group()
    holder.scale.setScalar(s)
    holder.rotation.y = def.faceYaw ?? Math.PI
    if (def.fly) holder.position.y = (def.targetHeight || 1.7) * 0.7 // hover above the ground
    holder.add(model)
    group.add(holder)
    inner = model

    // mixer + clip actions
    mixer = new THREE.AnimationMixer(model)
    const hint: CharClips = def.clips || { run: 'Gallop', idle: 'Idle', jump: 'Gallop_Jump', death: 'Death' }
    ;(['run', 'idle', 'jump', 'death', 'walk', 'slide'] as (keyof CharClips)[]).forEach((k) => {
      const clip = pickClip(res.animations, k, hint[k])
      actions[k] = clip ? mixer!.clipAction(clip) : null
    })

    // attach a mane to the head bone (lion) — sized from the bone's world scale
    if (withMane) {
      let headBone: THREE.Object3D | null = null
      model.traverse((o) => { if (!headBone && (o as unknown as { isBone?: boolean }).isBone && /head/i.test(o.name || '')) headBone = o })
      if (!headBone) model.traverse((o) => { if (!headBone && (o as unknown as { isBone?: boolean }).isBone && /neck/i.test(o.name || '')) headBone = o })
      if (headBone) {
        const hb: THREE.Object3D = headBone
        group.updateWorldMatrix(true, true)
        const ws = hb.getWorldScale(new THREE.Vector3())
        const mane = buildMane()
        mane.scale.setScalar(((def.targetHeight || 1.7) * 0.4) / (ws.x || 1))
        hb.add(mane)
      }
    }
    loaded = true

    // apply any skin/glow requested before the model finished loading
    if (pendingSkin) setSkin(pendingSkin[0], pendingSkin[1])
    if (pendingGlow != null) setGlow(pendingGlow)
    play('idle', { fade: 0 })
  }

  // ---- decide what to build ----
  if (def.kind === 'gltf' && def.url) {
    buildProc(female0) // brief placeholder (usually preloaded → instant swap)
    const baseUrl = def.url
    if (def.gltfUpgrade) {
      // hero lion: prefer a dropped-in realistic model, else the base rig + mane
      const up = def.gltfUpgrade
      modelExists(up).then((ok) => {
        loadGLTF(ok ? up : baseUrl).then((r) => setupGLTF(r, !ok && !!def.mane)).catch(() => {})
      })
    } else {
      loadGLTF(baseUrl).then((r) => setupGLTF(r, !!def.mane)).catch(() => {})
    }
  } else {
    buildProc(female0)
    // optional realistic drop-in upgrade for a procedural hero
    if (def.gltfUpgrade) {
      const url = def.gltfUpgrade
      modelExists(url).then((ok) => { if (ok) loadGLTF(url).then((r) => setupGLTF(r, false)).catch(() => {}) })
    }
  }

  // ---- interface impl ----
  function pose(o: PoseInput) {
    if (lion) {
      // exact original procedural gallop (phase offset de-syncs player vs ghost)
      lion.legs.forEach((leg, i) => {
        leg.rotation.x = o.airborne ? 0.5 : Math.sin(o.tSec * 14 + (i % 2) * Math.PI + phase) * 0.7
      })
      lion.body.scale.y = o.sliding ? 0.5 : 1 + (o.airborne ? 0.04 : Math.sin(o.tSec * 14 + phase) * 0.04)
      lion.tail.rotation.x = Math.sin(o.tSec * 8 + phase) * 0.3
      lion.headGroup.rotation.y = Math.PI / 2
      return
    }
    if (!mixer) return
    if (o.dead) play('death', { once: true, fade: 0.12 })
    else if (o.sliding && actions.slide) play('slide')
    else if (o.airborne && actions.jump) play('jump')
    else if (!o.running && actions.idle) play('idle')
    else if (o.walk && actions.walk) play('walk')
    else play('run')
    // if there's no dedicated slide/duck clip, crouch/pitch the model instead
    if (inner) {
      const proc = o.sliding && !actions.slide
      inner.rotation.x += ((proc ? -0.85 : 0) - inner.rotation.x) * 0.3
      inner.scale.y += ((proc ? 0.55 : 1) - inner.scale.y) * 0.3
    }
  }

  function update(dt: number) { if (mixer) mixer.update(dt) }

  function setSkin(bodyHex: number, maneHex: number) {
    if (lion) { lion.bodyMat.color.setHex(bodyHex); lion.maneMat.color.setHex(maneHex); return }
    pendingSkin = [bodyHex, maneHex]
    for (const m of bodyMats) m.color.setHex(bodyHex)
    for (const m of maneMats) m.color.setHex(maneHex)
  }

  function setGlow(intensity: number) {
    if (lion) { lion.maneMat.emissiveIntensity = intensity; return }
    pendingGlow = intensity
    for (const m of bodyMats) { m.emissive.copy(m.color); m.emissiveIntensity = intensity }
    for (const m of maneMats) { m.emissive.copy(m.color); m.emissiveIntensity = intensity }
  }

  // a procedural lion mane (flattened volume + a ring of fur tufts) attached to
  // the head bone so it animates with the model — turns a big-cat rig into a lion.
  function buildMane(): THREE.Group {
    const g = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a4a1c, roughness: 0.96, metalness: 0 })
    maneMats.push(mat); clonedMats.push(mat)
    const baseGeo = new THREE.DodecahedronGeometry(0.5); clonedGeoms.push(baseGeo)
    const base = new THREE.Mesh(baseGeo, mat)
    base.scale.set(1.05, 1.12, 0.82)
    g.add(base)
    const tuftGeo = new THREE.ConeGeometry(0.16, 0.36, 5); clonedGeoms.push(tuftGeo)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const t = new THREE.Mesh(tuftGeo, mat)
      t.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.05)
      t.rotation.z = a - Math.PI / 2
      g.add(t)
    }
    return g
  }

  function setFemale(female: boolean) {
    if (lion) setLionFemale(lion, female)
    // gltf animals have no gender variant → no-op
  }

  function enableShadows() {
    shadowsWanted = true
    group.traverse((o) => { const m = o as THREE.Mesh; if ((m as unknown as { isMesh?: boolean }).isMesh) m.castShadow = true })
  }

  function ready() { return def.kind !== 'gltf' || loaded }

  function dispose() {
    if (mixer) mixer.stopAllAction()
    if (lion) disposeLion(lion)
    // dispose only the per-instance clones; the cached source model is untouched
    for (const g of clonedGeoms) g.dispose()
    for (const m of clonedMats) m.dispose()
  }

  return { group, pose, update, setSkin, setGlow, setFemale, enableShadows, ready, dispose }
}
