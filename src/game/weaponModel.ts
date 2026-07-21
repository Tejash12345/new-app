/**
 * Procedural 3D weapon models for the Lion Race attacks.
 *
 * Same philosophy as vehicleModel.ts — built from three.js primitives (no GLB,
 * no download, offline-safe) so each of the five attacks has a real 3D
 * projectile instead of a flat glow sprite: a missile, a lightning bolt, a
 * fireball, an ice crystal and a tornado funnel.
 *
 * `buildWeapon(kind)` returns the group + an optional preferred spin axis (the
 * engine spins it while it flies) + a dispose that frees the per-instance
 * geometry/material. Meant to be short-lived (one per attack), so it rebuilds
 * each fire rather than caching.
 */
import * as THREE from 'three'

export type WeaponKind = 'rocket' | 'bolt' | 'fire' | 'freeze' | 'tornado'

export type WeaponModel = {
  group: THREE.Group
  /** the engine rolls/spins the model about this axis as it travels. */
  spin?: { axis: 'x' | 'y' | 'z'; rate: number }
  dispose: () => void
}

// module-cached soft radial glow so repeated fires don't churn textures
let _glow: THREE.Texture | null = null
function glowTexture(): THREE.Texture {
  if (_glow) return _glow
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const c = cv.getContext('2d')!
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 64, 64)
  _glow = new THREE.CanvasTexture(cv)
  return _glow
}

export function buildWeapon(kind: WeaponKind): WeaponModel {
  const group = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  let spin: WeaponModel['spin']

  const track = <T extends THREE.Material>(m: T): T => { mats.push(m); return m }
  const geo = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g }
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); group.add(o); return o
  }
  // an additive glow sprite (aura/exhaust) tinted per weapon
  const glow = (color: number, scale: number, x = 0, y = 0, z = 0) => {
    const sm = track(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    const sp = new THREE.Sprite(sm)
    sp.scale.setScalar(scale)
    sp.position.set(x, y, z)
    group.add(sp)
    return sp
  }

  if (kind === 'rocket') {
    // a missile — nose faces -z (its travel direction when fired forward)
    const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0xd6dae2, roughness: 0.4, metalness: 0.6 }))
    const noseMat = track(new THREE.MeshStandardMaterial({ color: 0xff4a52, roughness: 0.4, metalness: 0.3, emissive: 0xff2a34, emissiveIntensity: 0.4 }))
    const finMat = track(new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.6, metalness: 0.4 }))
    const bodyGeo = geo(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 14)); bodyGeo.rotateX(Math.PI / 2)
    mesh(bodyGeo, bodyMat)
    const noseGeo = geo(new THREE.ConeGeometry(0.16, 0.42, 14)); noseGeo.rotateX(-Math.PI / 2)
    mesh(noseGeo, noseMat, 0, 0, -0.66)
    const finGeo = geo(new THREE.BoxGeometry(0.05, 0.34, 0.34))
    for (let i = 0; i < 3; i++) {
      const f = mesh(finGeo, finMat, 0, 0, 0.4)
      f.rotation.z = (i / 3) * Math.PI * 2
    }
    glow(0xff9a3c, 1.3, 0, 0, 0.7) // exhaust flare
    spin = { axis: 'z', rate: 12 }
  } else if (kind === 'bolt') {
    // a jagged lightning bolt (emissive zig-zag) + electric glow
    const boltMat = track(new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0x9fd0ff, emissiveIntensity: 1.2, roughness: 0.3 }))
    const seg = geo(new THREE.BoxGeometry(0.12, 0.42, 0.12))
    const offs = [[-0.12, 0.42], [0.12, 0.14], [-0.1, -0.14], [0.08, -0.42]] as [number, number][]
    for (const [x, y] of offs) {
      const s = mesh(seg, boltMat, x, y, 0)
      s.rotation.z = (x > 0 ? -1 : 1) * 0.5
    }
    glow(0xbfe0ff, 1.8)
    spin = { axis: 'y', rate: 3 }
  } else if (kind === 'fire') {
    // a spiky fireball — emissive core + jagged flames + additive glow
    const coreMat = track(new THREE.MeshStandardMaterial({ color: 0xff7a1e, emissive: 0xff5a10, emissiveIntensity: 1.1, roughness: 0.5 }))
    mesh(geo(new THREE.IcosahedronGeometry(0.32, 0)), coreMat)
    const flameMat = track(new THREE.MeshStandardMaterial({ color: 0xffc24a, emissive: 0xffab2e, emissiveIntensity: 0.9, roughness: 0.6 }))
    const spikeGeo = geo(new THREE.ConeGeometry(0.12, 0.4, 6))
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const s = mesh(spikeGeo, flameMat, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0)
      s.rotation.z = a - Math.PI / 2
    }
    glow(0xff7a2a, 2.2)
    spin = { axis: 'z', rate: 5 }
  } else if (kind === 'freeze') {
    // an ice crystal — an elongated octahedron + smaller shards + frosty glow
    const iceMat = track(new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x7fd0ff, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85 }))
    const core = mesh(geo(new THREE.OctahedronGeometry(0.34, 0)), iceMat)
    core.scale.set(0.7, 0.7, 1.5)
    const shardGeo = geo(new THREE.OctahedronGeometry(0.16, 0))
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      mesh(shardGeo, iceMat, Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0)
    }
    glow(0x9fdcff, 1.9)
    spin = { axis: 'z', rate: 4 }
  } else {
    // a tornado funnel — stacked open cones, widest at the top; spins about Y
    const funMat = track(new THREE.MeshStandardMaterial({ color: 0xc3d2e6, emissive: 0x8fa6c4, emissiveIntensity: 0.3, roughness: 0.7, transparent: true, opacity: 0.5, side: THREE.DoubleSide }))
    const rings = [[1.7, 2.0, 2.6], [1.2, 1.6, 1.2], [0.7, 1.2, -0.2], [0.35, 0.9, -1.3]] as [number, number, number][]
    for (const [rTop, h, y] of rings) {
      const g = geo(new THREE.ConeGeometry(rTop, h, 14, 1, true))
      mesh(g, funMat, 0, y, 0)
    }
    glow(0xb8c8de, 3.2, 0, 0.6, 0)
    spin = { axis: 'y', rate: 16 }
  }

  function dispose() {
    for (const g of geos) g.dispose()
    for (const m of mats) m.dispose()
  }

  return { group, spin, dispose }
}
