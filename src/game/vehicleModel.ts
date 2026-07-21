/**
 * Procedural low-poly vehicles for Lion Run — a car, a motorbike and a truck.
 *
 * These are built from three.js primitives (no GLB to download, no bundle
 * bloat, offline-safe) so a player can "drive" instead of run. They expose the
 * bits the character rig needs: spinnable `wheels`, `bodyMats` the cosmetic
 * skins recolour, and `glowMats` (head/tail lights) for the x2 aura glow.
 *
 * Every vehicle is built FRONT-FACING -z (down the road, same as the animals
 * after their faceYaw), sits on the ground (wheel bottoms at y=0), and fits a
 * lane (≤ ~2 units wide). The rig in characterModel spins the wheels, pitches
 * the nose up on a jump and squashes it on a slide.
 */
import * as THREE from 'three'

export type VehicleType = 'car' | 'bike' | 'truck' | 'plane' | 'heli'

export type VehicleRig = {
  group: THREE.Group
  /** wheels rolling about X — the rig spins these while moving. */
  wheels: THREE.Mesh[]
  /** rotors/propellers — the rig spins each about its axis (heli/plane). */
  rotors: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; rate: number }[]
  /** main coachwork — recoloured by the cosmetic skin. */
  bodyMats: THREE.MeshStandardMaterial[]
  /** lights — driven emissive for the x2-coins glow. */
  glowMats: THREE.MeshStandardMaterial[]
  dispose: () => void
}

// A wheel: a short cylinder laid on its side (axis along X) so it rolls about X.
function makeWheel(radius: number, width: number, tyreMat: THREE.Material, geos: THREE.BufferGeometry[]): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radius, radius, width, 16)
  g.rotateZ(Math.PI / 2) // Y-axis → X-axis: now it rolls forward about X
  geos.push(g)
  const w = new THREE.Mesh(g, tyreMat)
  return w
}

export function buildVehicle(type: VehicleType): VehicleRig {
  const group = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const bodyMats: THREE.MeshStandardMaterial[] = []
  const glowMats: THREE.MeshStandardMaterial[] = []
  const wheels: THREE.Mesh[] = []
  const rotors: VehicleRig['rotors'] = []

  const track = <T extends THREE.Material>(m: T, kind?: 'body' | 'glow'): T => {
    mats.push(m)
    if (kind === 'body') bodyMats.push(m as unknown as THREE.MeshStandardMaterial)
    else if (kind === 'glow') glowMats.push(m as unknown as THREE.MeshStandardMaterial)
    return m
  }
  const box = (w: number, h: number, d: number) => { const g = new THREE.BoxGeometry(w, h, d); geos.push(g); return g }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    group.add(m)
    return m
  }

  // shared materials
  const tyreMat = track(new THREE.MeshStandardMaterial({ color: 0x14151b, roughness: 0.9, metalness: 0.1 }))
  const hubMat = track(new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.4, metalness: 0.7 }))
  const glassMat = track(new THREE.MeshStandardMaterial({ color: 0x0e2436, roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.72 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0xfff2c4, emissive: 0xffe9a8, emissiveIntensity: 0.6, roughness: 0.4 }), 'glow')
  const tailMat = track(new THREE.MeshStandardMaterial({ color: 0xff3b46, emissive: 0xff2a38, emissiveIntensity: 0.5, roughness: 0.5 }), 'glow')
  const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0xd83a4a, roughness: 0.35, metalness: 0.55 }), 'body')

  const wheelWithHub = (radius: number, width: number, x: number, y: number, z: number) => {
    const w = makeWheel(radius, width, tyreMat, geos)
    w.position.set(x, y, z)
    group.add(w)
    wheels.push(w)
    const capGeo = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width + 0.02, 10)
    capGeo.rotateZ(Math.PI / 2); geos.push(capGeo)
    const cap = new THREE.Mesh(capGeo, hubMat)
    w.add(cap) // spins with the wheel
    return w
  }

  if (type === 'car') {
    const r = 0.4
    // chassis + swept cabin
    const chassis = add(box(1.7, 0.55, 3.3), bodyMat, 0, r + 0.28, 0)
    chassis.geometry.translate(0, 0, 0)
    add(box(1.5, 0.5, 1.7), bodyMat, 0, r + 0.72, 0.2) // cabin
    add(box(1.42, 0.44, 1.5), glassMat, 0, r + 0.74, 0.2) // greenhouse glass
    add(box(1.72, 0.16, 3.34), track(new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.6, metalness: 0.3 })), 0, r + 0.02, 0) // sill
    // lights
    add(box(0.34, 0.16, 0.08), headMat, -0.55, r + 0.32, -1.66)
    add(box(0.34, 0.16, 0.08), headMat, 0.55, r + 0.32, -1.66)
    add(box(0.34, 0.14, 0.08), tailMat, -0.55, r + 0.4, 1.66)
    add(box(0.34, 0.14, 0.08), tailMat, 0.55, r + 0.4, 1.66)
    // wheels
    wheelWithHub(r, 0.26, -0.8, r, -1.05)
    wheelWithHub(r, 0.26, 0.8, r, -1.05)
    wheelWithHub(r, 0.26, -0.8, r, 1.1)
    wheelWithHub(r, 0.26, 0.8, r, 1.1)
  } else if (type === 'truck') {
    const r = 0.5
    // cab up front, tall cargo box behind
    add(box(1.95, 1.15, 1.5), bodyMat, 0, r + 0.6, -1.05) // cab
    add(box(1.7, 0.55, 1.3), glassMat, 0, r + 1.0, -1.15) // windscreen band
    add(box(2.0, 1.7, 2.7), track(new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.55, metalness: 0.2 })), 0, r + 0.95, 0.95) // trailer
    add(box(2.02, 0.18, 2.72), bodyMat, 0, r + 0.12, 0.95) // trailer skirt (accent colour)
    // grille + lights
    add(box(0.36, 0.2, 0.1), headMat, -0.62, r + 0.28, -1.82)
    add(box(0.36, 0.2, 0.1), headMat, 0.62, r + 0.28, -1.82)
    add(box(0.3, 0.16, 0.1), tailMat, -0.7, r + 0.4, 2.3)
    add(box(0.3, 0.16, 0.1), tailMat, 0.7, r + 0.4, 2.3)
    // 6 wheels (front axle + rear dual-ish)
    for (const z of [-1.15, 0.35, 1.5]) {
      wheelWithHub(r, 0.32, -0.86, r, z)
      wheelWithHub(r, 0.32, 0.86, r, z)
    }
  } else if (type === 'bike') {
    // motorbike + a simple rider so it doesn't look empty
    const r = 0.46
    add(box(0.34, 0.28, 1.9), bodyMat, 0, r + 0.3, 0) // frame spine
    add(box(0.5, 0.34, 0.7), bodyMat, 0, r + 0.5, -0.15) // fuel tank
    add(box(0.5, 0.14, 0.5), track(new THREE.MeshStandardMaterial({ color: 0x14151b, roughness: 0.8 })), 0, r + 0.56, 0.55) // seat
    // handlebars
    const barGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8); barGeo.rotateZ(Math.PI / 2); geos.push(barGeo)
    add(barGeo, hubMat, 0, r + 0.7, -0.72)
    add(box(0.22, 0.14, 0.1), headMat, 0, r + 0.5, -0.92) // headlight
    add(box(0.2, 0.12, 0.08), tailMat, 0, r + 0.5, 0.92) // taillight
    // rider (torso + head + arms), skin-coloured jacket
    add(box(0.5, 0.7, 0.42), bodyMat, 0, r + 1.05, 0.18) // torso
    const headGeo = new THREE.SphereGeometry(0.26, 12, 10); geos.push(headGeo)
    add(headGeo, track(new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.3, metalness: 0.6 })), 0, r + 1.6, 0.02) // helmet
    add(box(0.66, 0.16, 0.16), bodyMat, 0, r + 1.15, -0.35) // arms reaching bars
    // 2 wheels
    wheelWithHub(r, 0.2, 0, r, -0.85)
    wheelWithHub(r, 0.2, 0, r, 0.9)
  } else if (type === 'plane') {
    // small prop plane — fuselage down z, wings across x, nose propeller
    const y = 0.9
    const fuseGeo = new THREE.CylinderGeometry(0.42, 0.32, 3.2, 14); fuseGeo.rotateX(Math.PI / 2); geos.push(fuseGeo)
    add(fuseGeo, bodyMat, 0, y, 0.1)
    const noseGeo = new THREE.ConeGeometry(0.42, 0.7, 14); noseGeo.rotateX(-Math.PI / 2); geos.push(noseGeo)
    add(noseGeo, bodyMat, 0, y, -1.75)
    add(box(3.9, 0.12, 0.95), bodyMat, 0, y - 0.05, 0.1) // main wings
    add(box(1.5, 0.1, 0.55), bodyMat, 0, y + 0.35, 1.5) // tailplane
    add(box(0.12, 0.7, 0.6), bodyMat, 0, y + 0.5, 1.55) // vertical fin
    add(box(0.7, 0.34, 0.9), glassMat, 0, y + 0.38, -0.35) // canopy
    add(box(0.2, 0.14, 0.08), headMat, 0, y - 0.1, -2.02) // landing light
    // spinning propeller at the nose (blades in the XY plane, spin about Z)
    const prop = new THREE.Group()
    prop.position.set(0, y, -2.12)
    const spinMat = track(new THREE.MeshStandardMaterial({ color: 0x20222b, roughness: 0.5, metalness: 0.6 }))
    const b1 = new THREE.Mesh(box(0.14, 1.7, 0.05), spinMat)
    const b2 = new THREE.Mesh(box(1.7, 0.14, 0.05), spinMat)
    prop.add(b1, b2)
    const hubGeo = new THREE.SphereGeometry(0.16, 8, 8); geos.push(hubGeo)
    prop.add(new THREE.Mesh(hubGeo, hubMat))
    group.add(prop)
    rotors.push({ obj: prop, axis: 'z', rate: 26 })
  } else {
    // helicopter — cabin, tail boom, big main rotor + tail rotor
    const y = 0.95
    add(box(1.1, 1.05, 1.9), bodyMat, 0, y, -0.2) // cabin
    add(box(0.95, 0.6, 0.7), glassMat, 0, y + 0.05, -1.15) // cockpit glass
    const boomGeo = box(0.26, 0.26, 2.0)
    add(boomGeo, bodyMat, 0, y + 0.35, 1.55) // tail boom
    add(box(0.1, 0.7, 0.5), bodyMat, 0, y + 0.6, 2.45) // tail fin
    // skids
    add(box(0.1, 0.1, 1.7), track(new THREE.MeshStandardMaterial({ color: 0x20222b, roughness: 0.6, metalness: 0.5 })), -0.5, y - 0.75, -0.2)
    add(box(0.1, 0.1, 1.7), track(new THREE.MeshStandardMaterial({ color: 0x20222b, roughness: 0.6, metalness: 0.5 })), 0.5, y - 0.75, -0.2)
    add(box(0.24, 0.16, 0.1), headMat, 0, y - 0.1, -1.28) // nose light
    // main rotor on a mast (blades in the XZ plane, spin about Y)
    add(box(0.14, 0.4, 0.14), hubMat, 0, y + 0.75, -0.2) // mast
    const main = new THREE.Group()
    main.position.set(0, y + 1.0, -0.2)
    const rotorMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.5, metalness: 0.5 }))
    for (let i = 0; i < 3; i++) {
      const bl = new THREE.Mesh(box(4.6, 0.05, 0.24), rotorMat)
      bl.rotation.y = (i / 3) * Math.PI * 2
      main.add(bl)
    }
    const mhub = new THREE.SphereGeometry(0.18, 8, 8); geos.push(mhub)
    main.add(new THREE.Mesh(mhub, hubMat))
    group.add(main)
    rotors.push({ obj: main, axis: 'y', rate: 34 })
    // tail rotor (blades in XY plane, spin about Z)
    const tail = new THREE.Group()
    tail.position.set(0.18, y + 0.55, 2.5)
    const tb1 = new THREE.Mesh(box(0.08, 0.9, 0.05), rotorMat)
    const tb2 = new THREE.Mesh(box(0.9, 0.08, 0.05), rotorMat)
    tail.add(tb1, tb2)
    group.add(tail)
    rotors.push({ obj: tail, axis: 'z', rate: 46 })
  }

  function dispose() {
    for (const g of geos) g.dispose()
    for (const m of mats) m.dispose()
  }

  return { group, wheels, rotors, bodyMats, glowMats, dispose }
}
