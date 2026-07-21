/**
 * Procedural low-poly-but-realistic vehicles for Lion Run — car, motorbike,
 * truck, aeroplane and helicopter.
 *
 * Built from three.js primitives + EXTRUDED side-profile silhouettes (no GLB to
 * download, no bundle bloat, offline-safe). The car/truck bodies are real
 * extruded shapes (sloped hood, raked windshield, roof, trunk) rather than
 * stacked boxes, wrapped in glossy PBR paint that reflects the scene's
 * image-based lighting, with dark glass, chrome trim, wheel arches and lights —
 * so they read as actual vehicles.
 *
 * Every vehicle faces -z (down the road), sits on the ground (wheel bottoms at
 * y≈0), and fits a lane (≤ ~2 units wide). Exposes what the rig needs:
 * spinnable `wheels`, `rotors` (plane/heli), skin-recoloured `bodyMats`, and
 * emissive `glowMats` (lights).
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
  const box = (w: number, h: number, d: number, seg = 1) => { const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg); geos.push(g); return g }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m
  }

  // ---- shared PBR materials: glossy paint, dark glass, chrome, rubber ----
  const paintMat = track(new THREE.MeshStandardMaterial({ color: 0xd8323f, roughness: 0.28, metalness: 0.6 }), 'body')
  const glassMat = track(new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.55 }))
  const chromeMat = track(new THREE.MeshStandardMaterial({ color: 0xd7dce4, roughness: 0.18, metalness: 1 }))
  const trimMat = track(new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.5, metalness: 0.4 }))
  const tyreMat = track(new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.95, metalness: 0.05 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0xfff4cf, emissive: 0xffe9a8, emissiveIntensity: 0.7, roughness: 0.3 }), 'glow')
  const tailMat = track(new THREE.MeshStandardMaterial({ color: 0xff3b46, emissive: 0xff2a38, emissiveIntensity: 0.6, roughness: 0.4 }), 'glow')

  // Extrude a side profile (x = length, y = height) across `width`, oriented so
  // length runs along Z (front at -z) and the width is centred on X.
  const profile = (pts: [number, number][], width: number, bevel = 0.05): THREE.BufferGeometry => {
    const shape = new THREE.Shape()
    shape.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
    shape.closePath()
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1,
    })
    g.rotateY(-Math.PI / 2)   // length (X) → Z
    g.translate(width / 2, 0, 0) // centre the width on X
    g.computeVertexNormals()
    geos.push(g)
    return g
  }

  // A rubber tyre + chrome hub, rolling about X.
  const wheelWithHub = (radius: number, wdt: number, x: number, y: number, z: number) => {
    const tg = new THREE.CylinderGeometry(radius, radius, wdt, 20); tg.rotateZ(Math.PI / 2); geos.push(tg)
    const w = new THREE.Mesh(tg, tyreMat); w.position.set(x, y, z); group.add(w); wheels.push(w)
    const rimG = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, wdt + 0.02, 12); rimG.rotateZ(Math.PI / 2); geos.push(rimG)
    w.add(new THREE.Mesh(rimG, chromeMat))
    // spokes
    const spokeG = box(radius * 1.1, 0.05, 0.05);
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(spokeG, chromeMat); s.rotation.x = (i / 4) * Math.PI; w.add(s) }
    return w
  }
  // A dark fender arch tucked over a wheel.
  const arch = (x: number, y: number, z: number, r: number) => {
    const g = new THREE.TorusGeometry(r, 0.09, 8, 16, Math.PI); geos.push(g)
    const m = new THREE.Mesh(g, trimMat); m.position.set(x, y, z); m.rotation.y = Math.PI / 2; group.add(m); return m
  }

  if (type === 'car') {
    const W = 1.8
    // sedan side silhouette (x: front -2.1 → rear 2.1, y: height)
    const body = profile([
      [-2.1, 0.34], [-2.1, 0.56], [-1.98, 0.62], [-1.15, 0.72], [-0.9, 0.8],
      [-0.2, 1.4], [0.9, 1.42], [1.35, 0.92], [1.9, 0.84], [2.1, 0.78],
      [2.1, 0.5], [2.1, 0.34],
    ], W)
    add(body, paintMat)
    // dark glass greenhouse (inset), following the cabin outline
    const glass = profile([
      [-0.82, 0.82], [-0.2, 1.36], [0.88, 1.38], [1.28, 0.94], [-0.82, 0.82],
    ], W - 0.16)
    add(glass, glassMat, 0, 0.02, 0)
    // bumpers + rockers (chrome/trim)
    add(box(W + 0.06, 0.2, 0.3), chromeMat, 0, 0.5, -2.0)
    add(box(W + 0.06, 0.2, 0.3), chromeMat, 0, 0.5, 2.0)
    add(box(W + 0.08, 0.14, 3.2), trimMat, 0, 0.36, 0)
    // lights
    add(box(0.34, 0.16, 0.06), headMat, -0.6, 0.66, -2.08)
    add(box(0.34, 0.16, 0.06), headMat, 0.6, 0.66, -2.08)
    add(box(0.34, 0.14, 0.06), tailMat, -0.6, 0.74, 2.08)
    add(box(0.34, 0.14, 0.06), tailMat, 0.6, 0.74, 2.08)
    // side mirrors
    add(box(0.1, 0.12, 0.18), trimMat, -(W / 2 + 0.08), 0.98, -0.7)
    add(box(0.1, 0.12, 0.18), trimMat, (W / 2 + 0.08), 0.98, -0.7)
    // wheels + arches
    const r = 0.44
    for (const z of [-1.3, 1.3]) {
      wheelWithHub(r, 0.28, -0.86, r, z); wheelWithHub(r, 0.28, 0.86, r, z)
      arch(-0.86, r + 0.02, z, r + 0.08); arch(0.86, r + 0.02, z, r + 0.08)
    }
  } else if (type === 'truck') {
    const W = 2.0
    // cab-over rig cab (short + tall, raked screen)
    const cab = profile([
      [-1.15, 0.5], [-1.15, 1.9], [-1.05, 2.35], [0.35, 2.4], [0.5, 1.0], [0.5, 0.5],
    ], W)
    add(cab, paintMat, 0, 0, -1.0)
    // windscreen + door glass
    add(box(W - 0.2, 0.9, 0.08), glassMat, 0, 1.95, -2.12)
    add(box(0.08, 0.7, 1.0), glassMat, -(W / 2 - 0.02), 1.7, -1.15)
    add(box(0.08, 0.7, 1.0), glassMat, (W / 2 - 0.02), 1.7, -1.15)
    // chrome grille + bumper + twin exhaust stacks
    add(box(W - 0.3, 0.7, 0.12), chromeMat, 0, 0.95, -2.16)
    add(box(W + 0.05, 0.24, 0.34), chromeMat, 0, 0.55, -2.2)
    const stackG = new THREE.CylinderGeometry(0.1, 0.1, 1.7, 10); geos.push(stackG)
    add(stackG, chromeMat, -(W / 2 + 0.02), 1.45, -0.2)
    add(stackG, chromeMat, (W / 2 + 0.02), 1.45, -0.2)
    // trailer / box body (fixed light coachwork so skins recolour the cab)
    const trailerMat = track(new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.5, metalness: 0.25 }))
    add(box(W, 1.9, 3.0), trailerMat, 0, 1.55, 1.15)
    add(box(W + 0.04, 0.16, 3.0), paintMat, 0, 0.5, 1.15) // painted skirt
    // lights
    add(box(0.32, 0.2, 0.08), headMat, -0.7, 0.72, -2.22)
    add(box(0.32, 0.2, 0.08), headMat, 0.7, 0.72, -2.22)
    add(box(0.3, 0.16, 0.08), tailMat, -0.7, 0.7, 2.66)
    add(box(0.3, 0.16, 0.08), tailMat, 0.7, 0.7, 2.66)
    // wheels: front axle + rear tandem
    const r = 0.5
    for (const z of [-1.35, 0.4, 1.5]) {
      wheelWithHub(r, 0.34, -0.88, r, z); wheelWithHub(r, 0.34, 0.88, r, z)
      arch(-0.88, r + 0.02, z, r + 0.1); arch(0.88, r + 0.02, z, r + 0.1)
    }
  } else if (type === 'bike') {
    // sport motorbike + a leaning rider
    const r = 0.46
    add(box(0.32, 0.26, 1.7, 2), paintMat, 0, r + 0.34, 0) // frame spine
    // faired tank/tail (two tapered wedges)
    add(profile([[-0.55, 0.0], [-0.35, 0.4], [0.2, 0.42], [0.45, 0.0]], 0.5), paintMat, 0, r + 0.35, -0.15)
    add(box(0.46, 0.12, 0.5), trimMat, 0, r + 0.6, 0.5) // seat
    const barGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.56, 8); barGeo.rotateZ(Math.PI / 2); geos.push(barGeo)
    add(barGeo, chromeMat, 0, r + 0.72, -0.72)
    add(box(0.26, 0.2, 0.12), headMat, 0, r + 0.52, -0.92) // headlight cowl
    add(box(0.2, 0.12, 0.06), tailMat, 0, r + 0.5, 0.92)
    // rider (helmet + jacket + arms)
    add(box(0.5, 0.72, 0.44, 2), paintMat, 0, r + 1.08, 0.16) // torso
    const helm = new THREE.SphereGeometry(0.26, 14, 12); geos.push(helm)
    add(helm, chromeMat, 0, r + 1.62, 0.0)
    add(box(0.62, 0.16, 0.16), paintMat, 0, r + 1.18, -0.36) // arms to bars
    add(box(0.24, 0.5, 0.24), trimMat, 0, r + 0.7, 0.55) // upper legs
    // wheels (fat rear)
    wheelWithHub(r, 0.18, 0, r, -0.85)
    wheelWithHub(r, 0.24, 0, r, 0.9)
  } else if (type === 'plane') {
    const y = 0.95
    // smooth fuselage: nose cone + tube + tapered tail
    const fuse = new THREE.CylinderGeometry(0.4, 0.34, 3.0, 18); fuse.rotateX(Math.PI / 2); geos.push(fuse)
    add(fuse, paintMat, 0, y, 0.15)
    const nose = new THREE.SphereGeometry(0.4, 16, 12); geos.push(nose)
    add(nose, paintMat, 0, y, -1.35).scale.set(1, 1, 1.4)
    const tailCone = new THREE.ConeGeometry(0.34, 0.7, 14); tailCone.rotateX(Math.PI / 2); geos.push(tailCone)
    add(tailCone, paintMat, 0, y + 0.05, 1.9)
    // swept wings + tail surfaces
    add(profile([[-0.55, 0], [0.55, 0], [0.35, 0.1], [-0.35, 0.1]], 4.0), paintMat, 0, y - 0.06, 0.1)
    add(box(1.5, 0.1, 0.5), paintMat, 0, y + 0.35, 1.7) // tailplane
    add(box(0.12, 0.7, 0.6), paintMat, 0, y + 0.5, 1.75) // fin
    add(box(0.72, 0.34, 0.9), glassMat, 0, y + 0.36, -0.4) // canopy
    add(box(0.22, 0.14, 0.08), headMat, 0, y - 0.12, -1.7) // landing light
    // spinning propeller (blades in XY plane, spin about Z)
    const prop = new THREE.Group(); prop.position.set(0, y, -1.9)
    const spinMat = track(new THREE.MeshStandardMaterial({ color: 0x1c1e26, roughness: 0.5, metalness: 0.6 }))
    prop.add(new THREE.Mesh(box(0.14, 1.8, 0.05), spinMat), new THREE.Mesh(box(1.8, 0.14, 0.05), spinMat))
    const hubG = new THREE.SphereGeometry(0.16, 10, 10); geos.push(hubG)
    prop.add(new THREE.Mesh(hubG, chromeMat))
    group.add(prop)
    rotors.push({ obj: prop, axis: 'z', rate: 26 })
  } else {
    // helicopter — cabin, tail boom, main + tail rotor
    const y = 0.95
    const cabG = new THREE.SphereGeometry(0.85, 18, 14); geos.push(cabG)
    add(cabG, paintMat, 0, y, -0.35).scale.set(0.8, 0.95, 1.3) // rounded cabin
    add(box(0.95, 0.55, 0.7), glassMat, 0, y + 0.05, -1.05) // cockpit glass
    add(box(0.26, 0.26, 2.0), paintMat, 0, y + 0.35, 1.5) // tail boom
    add(box(0.1, 0.75, 0.5), paintMat, 0, y + 0.62, 2.4) // tail fin
    for (const sx of [-0.5, 0.5]) add(box(0.1, 0.1, 1.8), trimMat, sx, y - 0.78, -0.3) // skids
    add(box(0.9, 0.1, 0.1), trimMat, 0, y - 0.82, -0.9)
    add(box(0.24, 0.16, 0.1), headMat, 0, y - 0.12, -1.42) // nose light
    // main rotor (blades in XZ plane, spin about Y)
    add(box(0.14, 0.42, 0.14), chromeMat, 0, y + 0.85, -0.35) // mast
    const main = new THREE.Group(); main.position.set(0, y + 1.08, -0.35)
    const rotorMat = track(new THREE.MeshStandardMaterial({ color: 0x24262f, roughness: 0.5, metalness: 0.5 }))
    for (let i = 0; i < 3; i++) { const bl = new THREE.Mesh(box(4.8, 0.05, 0.26), rotorMat); bl.rotation.y = (i / 3) * Math.PI * 2; main.add(bl) }
    const mh = new THREE.SphereGeometry(0.18, 10, 10); geos.push(mh)
    main.add(new THREE.Mesh(mh, chromeMat))
    group.add(main); rotors.push({ obj: main, axis: 'y', rate: 34 })
    // tail rotor
    const tail = new THREE.Group(); tail.position.set(0.2, y + 0.55, 2.45)
    tail.add(new THREE.Mesh(box(0.08, 0.95, 0.05), rotorMat), new THREE.Mesh(box(0.95, 0.08, 0.05), rotorMat))
    group.add(tail); rotors.push({ obj: tail, axis: 'z', rate: 46 })
  }

  function dispose() {
    for (const g of geos) g.dispose()
    for (const m of mats) m.dispose()
  }

  return { group, wheels, rotors, bodyMats, glowMats, dispose }
}
