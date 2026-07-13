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
}

export function buildLion(): LionRig {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xc98a4b, emissive: 0xffa64d, emissiveIntensity: 0 })
  const maneMat = new THREE.MeshLambertMaterial({ color: 0x7a4a1c, emissive: 0xcc7a26, emissiveIntensity: 0 })

  const body = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), bodyMat)
  body.scale.set(1.6, 1, 1)
  body.position.y = 1.35
  group.add(body)

  const legGeo = new THREE.CylinderGeometry(0.22, 0.19, 1.1)
  const legs: THREE.Mesh[] = []
  for (const [lx, lz] of [[-1.1, 0.5], [-1.1, -0.5], [1.1, 0.5], [1.1, -0.5]]) {
    const leg = new THREE.Mesh(legGeo, bodyMat)
    leg.position.set(lx, 0.55, lz)
    group.add(leg)
    legs.push(leg)
  }

  const headGroup = new THREE.Group()
  const mane = new THREE.Mesh(new THREE.DodecahedronGeometry(1), maneMat)
  mane.scale.set(1, 1, 0.75)
  headGroup.add(mane)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9), bodyMat)
  head.position.z = 0.42
  headGroup.add(head)
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xe6c497 }),
  )
  muzzle.scale.set(1, 0.75, 0.9)
  muzzle.position.set(0, -0.14, 0.96)
  headGroup.add(muzzle)
  const earGeo = new THREE.SphereGeometry(0.2, 6, 5)
  for (const ex of [-0.5, 0.5]) {
    const ear = new THREE.Mesh(earGeo, maneMat)
    ear.position.set(ex, 0.88, 0.2)
    headGroup.add(ear)
  }
  headGroup.position.set(1.7, 2.5, 0)
  headGroup.rotation.y = Math.PI / 2
  group.add(headGroup)

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 1.7), bodyMat)
  tail.position.set(-1.9, 1.7, 0)
  tail.rotation.z = 0.7
  group.add(tail)
  const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.19, 6, 5), maneMat)
  tuft.position.set(-2.45, 2.3, 0)
  group.add(tuft)

  return { group, body, headGroup, tail, legs, bodyMat, maneMat }
}

/** Dispose every geometry/material under the rig (textures not used). */
export function disposeLion(rig: LionRig) {
  rig.group.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose()
  })
}
