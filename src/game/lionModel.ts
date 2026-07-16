/**
 * The low-poly lion rig shared by the city monument and the 3D runner.
 * Built from primitives so there's no model file to load; callers animate
 * through the returned references (breathing body, looking head, swaying
 * tail, galloping legs).
 */
import * as THREE from 'three'

export type LionRig = {
  group: THREE.Group
  body: THREE.Mesh
  headGroup: THREE.Group
  tail: THREE.Mesh
  legs: THREE.Mesh[]
  bodyMat: THREE.MeshLambertMaterial
  maneMat: THREE.MeshLambertMaterial
  mane: THREE.Mesh
  flower: THREE.Group
}

/** A lioness hides the mane and wears a little flower; a lion shows the mane. */
export function setLionFemale(rig: LionRig, female: boolean) {
  rig.mane.visible = !female
  rig.flower.visible = female
}

export function buildLion(opts?: { female?: boolean }): LionRig {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xc98a4b, emissive: 0xffa64d, emissiveIntensity: 0 })
  const maneMat = new THREE.MeshLambertMaterial({ color: 0x7a4a1c, emissive: 0xcc7a26, emissiveIntensity: 0 })
  const bellyMat = new THREE.MeshLambertMaterial({ color: 0xe8c79a })
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0e })
  const muzzleMat = new THREE.MeshLambertMaterial({ color: 0xf0d6ad })

  // ---- torso: a real-animal silhouette from chest (front) + haunch (rear) +
  // barrel + a lighter underbelly (+x = front, -x = rear, ±z = sides) ----
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12), bodyMat)
  body.scale.set(1.75, 0.95, 1.02)
  body.position.set(0, 1.35, 0)
  group.add(body)
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.82, 14, 10), bodyMat)
  chest.scale.set(1.1, 1.05, 1.05)
  chest.position.set(1.0, 1.24, 0)
  group.add(chest)
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), bodyMat)
  haunch.scale.set(1.02, 1.12, 1.12)
  haunch.position.set(-1.05, 1.46, 0)
  group.add(haunch)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), bellyMat)
  belly.scale.set(1.7, 0.55, 0.9)
  belly.position.set(0, 0.98, 0)
  group.add(belly)

  // ---- articulated legs: thigh (pivots at the hip) → shin (bent knee) → paw ----
  const thighGeo = new THREE.CylinderGeometry(0.2, 0.16, 0.6, 8).translate(0, -0.3, 0)
  const shinGeo = new THREE.CylinderGeometry(0.14, 0.11, 0.55, 8).translate(0, -0.275, 0)
  const pawGeo = new THREE.SphereGeometry(0.17, 8, 6)
  const legs: THREE.Mesh[] = []
  const legDefs: [number, number, boolean][] = [
    [0.9, 0.52, true], [0.9, -0.52, true], [-0.95, 0.58, false], [-0.95, -0.58, false],
  ]
  for (const [lx, lz, front] of legDefs) {
    const thigh = new THREE.Mesh(thighGeo, bodyMat) // origin at the hip
    thigh.position.set(lx, 1.05, lz)
    const shin = new THREE.Mesh(shinGeo, bodyMat)
    shin.position.set(0, -0.58, 0)
    shin.rotation.x = front ? 0.32 : -0.32 // knee bend (front/hind opposite)
    const paw = new THREE.Mesh(pawGeo, darkMat)
    paw.scale.set(1, 0.65, 1.25)
    paw.position.set(0, -0.54, front ? 0.14 : -0.05)
    shin.add(paw)
    thigh.add(shin)
    group.add(thigh)
    legs.push(thigh)
  }

  // ---- neck connecting the shoulders to the head ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 0.95, 10), bodyMat)
  neck.position.set(1.42, 1.92, 0)
  neck.rotation.z = -0.62
  group.add(neck)

  const headGroup = new THREE.Group()
  // fuller mane: a base volume + a ring of fur tufts (children of `mane` so the
  // lioness toggle hides them all together)
  const mane = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05), maneMat)
  mane.scale.set(1.05, 1.12, 0.82)
  headGroup.add(mane)
  const tuftGeo = new THREE.ConeGeometry(0.3, 0.62, 5)
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2
    const spike = new THREE.Mesh(tuftGeo, maneMat)
    spike.position.set(Math.cos(a) * 0.98, Math.sin(a) * 0.98, -0.12)
    spike.rotation.z = a - Math.PI / 2
    mane.add(spike)
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), bodyMat)
  head.scale.set(1, 0.96, 1.05)
  head.position.z = 0.5
  headGroup.add(head)
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), muzzleMat)
  muzzle.scale.set(1, 0.82, 1.1)
  muzzle.position.set(0, -0.16, 1.04)
  headGroup.add(muzzle)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), darkMat)
  nose.scale.set(1.3, 0.8, 1)
  nose.position.set(0, -0.02, 1.42)
  headGroup.add(nose)
  const eyeGeo = new THREE.SphereGeometry(0.085, 8, 6)
  for (const ex of [-0.25, 0.25]) {
    const eye = new THREE.Mesh(eyeGeo, darkMat)
    eye.position.set(ex, 0.18, 0.96)
    headGroup.add(eye)
  }
  const earGeo = new THREE.SphereGeometry(0.2, 8, 6)
  for (const ex of [-0.52, 0.52]) {
    const ear = new THREE.Mesh(earGeo, bodyMat)
    ear.scale.set(1, 1.15, 0.55)
    ear.position.set(ex, 0.84, 0.16)
    headGroup.add(ear)
  }
  headGroup.position.set(1.78, 2.5, 0)
  headGroup.rotation.y = Math.PI / 2
  group.add(headGroup)

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 1.85, 6), bodyMat)
  tail.position.set(-1.98, 1.82, 0)
  tail.rotation.z = 0.8
  group.add(tail)
  const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), maneMat)
  tuft.position.set(-2.55, 2.42, 0)
  group.add(tuft)

  // a little flower for the lioness (shown when female, hidden for a lion)
  const flower = new THREE.Group()
  const petalMat = new THREE.MeshLambertMaterial({ color: 0xff8fc8 })
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), petalMat)
    const a = (i / 5) * Math.PI * 2
    petal.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22)
    flower.add(petal)
  }
  flower.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0xffe14d })))
  flower.position.set(0.55, 0.72, 0.32)
  headGroup.add(flower)

  const rig: LionRig = { group, body, headGroup, tail, legs, bodyMat, maneMat, mane, flower }
  setLionFemale(rig, !!opts?.female)
  return rig
}

/** Dispose every geometry/material under the rig (textures not used). */
export function disposeLion(rig: LionRig) {
  rig.group.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose()
  })
}
