/**
 * Playable runner characters for Lion Run.
 *
 * THREE-free data module (mirrors `lionSkins.ts`) so the React hub (CityPage)
 * and LionRace can import the roster + unlock rules WITHOUT pulling three.js
 * into the main bundle — three only loads inside the lazy game chunk.
 *
 * Two kinds:
 *  - `procedural`  → the built-in primitive lion rig (`lionModel.buildLion`),
 *                    animated by code. This is the on-brand hero + lioness and
 *                    the guaranteed offline fallback.
 *  - `gltf`        → a lazy-loaded CC0 Quaternius model (public/models/*.glb)
 *                    with a real armature + skeletal Run/Idle/Jump/Death clips,
 *                    driven by an AnimationMixer.
 *
 * The hero lion carries an optional `gltfUpgrade` slot: drop a rigged
 * `public/models/lion.glb` (e.g. a realistic one from Sketchfab/Meshy) and the
 * hero auto-upgrades to it — no code change (see public/models/README.md).
 */

export type CharacterKind = 'procedural' | 'gltf' | 'vehicle'

/** Procedural vehicle body type (kind: 'vehicle') — built from primitives.
 *  car/bike/truck drive on the road; plane/heli (also `fly: true`) cruise the sky. */
export type VehicleType = 'car' | 'bike' | 'truck' | 'plane' | 'heli'

/** Clip-name hints. The builder matches case-insensitively and falls back to
 *  keyword matching (run→gallop/run, idle, jump, death…) so almost any rig works. */
export type CharClips = { run: string; idle: string; jump: string; death: string; walk?: string; slide?: string }

export type CharacterDef = {
  id: string
  name: string
  emoji: string
  kind: CharacterKind
  /** gltf model path served from /public (only for kind: 'gltf'). */
  url?: string
  /** optional realistic drop-in that upgrades a procedural character if present. */
  gltfUpgrade?: string
  /** procedural lioness (hide mane, show flower). */
  female?: boolean
  /** world-units tall after auto-normalization (gltf only). */
  targetHeight?: number
  /** Y rotation (radians) so the model faces down the road (-z). */
  faceYaw?: number
  /** clip-name hints (gltf). */
  clips?: CharClips
  /** gltf material names the 6 cosmetic skins recolour (coat). */
  bodyMats?: string[]
  /** attach a procedural mane to the head bone (turns a big-cat rig into a lion). */
  mane?: boolean
  /** a flying character (e.g. dragon) — hovers above the ground. */
  fly?: boolean
  /** procedural vehicle body (kind: 'vehicle') — you DRIVE it: +speed, high jump. */
  vehicle?: VehicleType
  /** ambient-only (roams the world but hidden from the playable picker). */
  ambient?: boolean
  /** does the Fire/Ice/Neon/Gold/Shadow skin picker apply to this character? */
  skinnable: boolean
  /** player level required to run as this character (0 = always available). */
  unlockLevel: number
  blurb: string
  /** asset attribution/licence (shown in the picker + CREDITS). */
  credit?: string
}

// Every Quaternius "Animated Animal Pack" model shares one AnimalArmature with
// identical clip names, so one map covers the whole pack.
const QUAT: CharClips = { run: 'Gallop', idle: 'Idle', jump: 'Gallop_Jump', death: 'Death', walk: 'Walk' }
// Bipeds (humans/robot) — CharacterArmature / Human Armature clip names.
const HUMAN: CharClips = { run: 'Run', idle: 'Idle', jump: 'Jump', death: 'Death', walk: 'Walk' }
// Flying dragon — only has flying clips, so run/idle/jump all map to flight.
const DRAGON: CharClips = { run: 'Fast_Flying', idle: 'Flying_Idle', jump: 'Fast_Flying', death: 'Death' }
// Generic flyer (bat/bird) — a single Flying clip drives everything.
const FLYER: CharClips = { run: 'Flying', idle: 'Flying', jump: 'Flying', death: 'Death' }
const QUAT_CREDIT = 'Quaternius · CC0'

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'lion', name: 'Leo the Lion', emoji: '🦁', kind: 'gltf', url: '/models/wolf.glb',
    gltfUpgrade: '/models/lion.glb', // drop a realistic rigged lion here → replaces the base + mane
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], mane: true, targetHeight: 1.7, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 0, credit: QUAT_CREDIT,
    blurb: 'The king — a real animated 3D lion. Auto-upgrades to a photoreal model if one is installed.',
  },
  {
    id: 'lioness', name: 'Lioness', emoji: '🦁', kind: 'gltf', url: '/models/wolf.glb', female: true,
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.6, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 0, credit: QUAT_CREDIT,
    blurb: 'Fast, fearless, maneless.',
  },
  {
    // clean, fully-animated white astronaut (dressed, futuristic, lightweight)
    id: 'astronaut', name: 'Astronaut', emoji: '👩‍🚀', kind: 'gltf', url: '/models/astronaut.glb',
    clips: { ...HUMAN, slide: 'Duck' }, bodyMats: [], targetHeight: 1.8, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 0, credit: QUAT_CREDIT,
    blurb: 'A futuristic astronaut in white — clean, fully animated (run/jump/slide).',
  },
  {
    id: 'wolf', name: 'Wolf', emoji: '🐺', kind: 'gltf', url: '/models/wolf.glb',
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.7, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 2, blurb: 'Apex predator with a real skeletal gallop.', credit: QUAT_CREDIT,
  },
  {
    id: 'fox', name: 'Fox', emoji: '🦊', kind: 'gltf', url: '/models/fox.glb',
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.4, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 3, blurb: 'Small, quick and clever.', credit: QUAT_CREDIT,
  },
  {
    id: 'shiba', name: 'Shiba Inu', emoji: '🐕', kind: 'gltf', url: '/models/shiba.glb',
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.45, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 4, blurb: 'Good boy. Very fast good boy.', credit: QUAT_CREDIT,
  },
  {
    id: 'husky', name: 'Husky', emoji: '🐕‍🦺', kind: 'gltf', url: '/models/husky.glb',
    clips: QUAT, bodyMats: [], targetHeight: 1.5, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 5, blurb: 'Sled-dog stamina.', credit: QUAT_CREDIT,
  },
  {
    id: 'deer', name: 'Deer', emoji: '🦌', kind: 'gltf', url: '/models/deer.glb',
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.8, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 6, blurb: 'Bounding and graceful.', credit: QUAT_CREDIT,
  },
  {
    id: 'stag', name: 'Stag', emoji: '🦌', kind: 'gltf', url: '/models/stag.glb',
    clips: QUAT, bodyMats: [], targetHeight: 1.9, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 8, blurb: 'Antlered and majestic.', credit: QUAT_CREDIT,
  },
  {
    id: 'bull', name: 'Bull', emoji: '🐂', kind: 'gltf', url: '/models/bull.glb',
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.9, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 10, blurb: 'Unstoppable charge.', credit: QUAT_CREDIT,
  },
  {
    id: 'horse', name: 'Stallion', emoji: '🐎', kind: 'gltf', url: '/models/horse.glb',
    clips: QUAT, bodyMats: ['Main', 'Main_Light'], targetHeight: 2.0, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 12, blurb: 'Thunderous full-speed gallop.', credit: QUAT_CREDIT,
  },
  // ---- humans + characters (rigged bipeds, real Run/Idle/Jump/Death) ----
  {
    id: 'runner', name: 'Runner', emoji: '🧍', kind: 'gltf', url: '/models/runner.glb',
    clips: { ...HUMAN, slide: 'Roll' }, bodyMats: [], targetHeight: 1.8, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 7, blurb: 'A rugged human runner — dives into a roll to slide.', credit: QUAT_CREDIT,
  },
  {
    id: 'woman', name: 'Runner (F)', emoji: '🏃‍♀️', kind: 'gltf', url: '/models/woman.glb',
    clips: HUMAN, bodyMats: [], targetHeight: 1.75, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 8, blurb: 'A woman sprinter — full run / idle / jump cycle.', credit: QUAT_CREDIT,
  },
  {
    id: 'robot', name: 'Robot', emoji: '🤖', kind: 'gltf', url: '/models/robot.glb',
    clips: HUMAN, bodyMats: ['Main'], targetHeight: 1.8, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 9, blurb: 'Mechanical marathoner. Recolours with skins.', credit: QUAT_CREDIT,
  },
  {
    id: 'hero', name: 'Hero', emoji: '🦸', kind: 'gltf', url: '/models/hero.glb',
    clips: { ...HUMAN, slide: 'Duck' }, bodyMats: ['Main', 'Main_Light'], targetHeight: 1.75, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 11, blurb: 'Agile hero — real jump + a ducking slide.', credit: QUAT_CREDIT,
  },
  {
    id: 'adventurer', name: 'Adventurer', emoji: '🗺️', kind: 'gltf', url: '/models/adventurer.glb',
    clips: HUMAN, bodyMats: [], targetHeight: 1.85, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 14, blurb: 'A detailed explorer with a backpack.', credit: QUAT_CREDIT,
  },
  // ---- vehicles — you DRIVE these (faster + a HIGH JUMP over the big wall) ----
  // Real CC0 3D models (Quaternius) with the procedural vehicle as the instant
  // loading placeholder / offline fallback. Motorbike is procedural.
  {
    id: 'car', name: 'Speedster', emoji: '🚗', kind: 'gltf', url: '/models/car.glb', vehicle: 'car',
    bodyMats: ['Main'], targetHeight: 1.3, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 0, credit: QUAT_CREDIT,
    blurb: 'Drive a real 3D car — faster, and it high-jumps clean over the big walls.',
  },
  {
    id: 'bike', name: 'Street Bike', emoji: '🏍️', kind: 'vehicle', vehicle: 'bike',
    skinnable: true, unlockLevel: 4,
    blurb: 'A nimble motorbike — quick, and it launches high off a jump.',
  },
  {
    id: 'pickup', name: 'Pickup', emoji: '🛻', kind: 'gltf', url: '/models/pickup.glb', vehicle: 'truck',
    bodyMats: [], targetHeight: 1.7, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 6, credit: QUAT_CREDIT,
    blurb: 'A rugged 3D pickup — quick and clears the big walls.',
  },
  {
    id: 'truck', name: 'Big Rig', emoji: '🚚', kind: 'gltf', url: '/models/truck.glb', vehicle: 'truck',
    bodyMats: [], targetHeight: 2.4, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 9, credit: QUAT_CREDIT,
    blurb: 'A hefty armoured rig — barrels down the road and leaps the biggest walls.',
  },
  {
    id: 'police', name: 'Police Car', emoji: '🚓', kind: 'gltf', url: '/models/police.glb', vehicle: 'car',
    bodyMats: [], targetHeight: 1.3, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 11, credit: QUAT_CREDIT,
    blurb: 'Hit the siren — a fast 3D cruiser that clears the big walls.',
  },
  {
    id: 'taxi', name: 'Taxi', emoji: '🚕', kind: 'gltf', url: '/models/taxi.glb', vehicle: 'car',
    bodyMats: [], targetHeight: 1.3, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 3, credit: QUAT_CREDIT,
    blurb: 'Hail a cab — a speedy 3D taxi that leaps the big walls.',
  },
  {
    id: 'suv', name: 'SUV', emoji: '🚙', kind: 'gltf', url: '/models/suv.glb', vehicle: 'car',
    bodyMats: ['White'], targetHeight: 1.45, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 5, credit: QUAT_CREDIT,
    blurb: 'A chunky 3D SUV — drives fast and jumps the big walls.',
  },
  {
    id: 'sportscar', name: 'Sports Car', emoji: '🏎️', kind: 'gltf', url: '/models/sportscar.glb', vehicle: 'car',
    bodyMats: ['Orange'], targetHeight: 1.25, faceYaw: Math.PI,
    skinnable: true, unlockLevel: 7, credit: QUAT_CREDIT,
    blurb: 'A low-slung 3D sports car — blistering speed, clears the big walls.',
  },
  // ---- aircraft (procedural, FLYING vehicles) — cruise the sky, fastest of all ----
  {
    id: 'plane', name: 'Aeroplane', emoji: '✈️', kind: 'vehicle', vehicle: 'plane', fly: true,
    skinnable: true, unlockLevel: 13,
    blurb: 'Fly above the traffic — very fast. Tap to climb over the big walls.',
  },
  {
    id: 'heli', name: 'Helicopter', emoji: '🚁', kind: 'vehicle', vehicle: 'heli', fly: true,
    skinnable: true, unlockLevel: 18,
    blurb: 'Chopper the whole track — fastest ride. Climb to clear the big walls.',
  },
  // ---- dinosaurs (rigged, Run/Idle/Jump/Death) ----
  {
    id: 'raptor', name: 'Raptor', emoji: '🦎', kind: 'gltf', url: '/models/raptor.glb',
    clips: HUMAN, bodyMats: [], targetHeight: 1.8, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 13, blurb: 'Velociraptor — lightning-fast predator.', credit: QUAT_CREDIT,
  },
  {
    id: 'triceratops', name: 'Triceratops', emoji: '🦕', kind: 'gltf', url: '/models/triceratops.glb',
    clips: HUMAN, bodyMats: [], targetHeight: 2.0, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 15, blurb: 'Three-horned tank on the run.', credit: QUAT_CREDIT,
  },
  {
    id: 'trex', name: 'T-Rex', emoji: '🦖', kind: 'gltf', url: '/models/trex.glb',
    clips: HUMAN, bodyMats: [], targetHeight: 2.4, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 18, blurb: 'The king of the road. Earn your crown.', credit: QUAT_CREDIT,
  },
  {
    id: 'dragon', name: 'Dragon', emoji: '🐉', kind: 'gltf', url: '/models/dragon.glb',
    clips: DRAGON, bodyMats: ['Dragon_Main', 'Dragon_Secondary'], targetHeight: 1.9, faceYaw: Math.PI, fly: true,
    skinnable: true, unlockLevel: 20, blurb: 'A winged dragon that flies the track.', credit: QUAT_CREDIT,
  },
  {
    id: 'bat', name: 'Bat', emoji: '🦇', kind: 'gltf', url: '/models/bat.glb',
    clips: FLYER, bodyMats: ['Main'], targetHeight: 1.4, faceYaw: Math.PI, fly: true,
    skinnable: true, unlockLevel: 16, blurb: 'A night flyer that swoops the track.', credit: QUAT_CREDIT,
  },
  {
    id: 'wyvern', name: 'Wyvern', emoji: '🐲', kind: 'gltf', url: '/models/wyvern.glb',
    clips: DRAGON, bodyMats: ['Dragon_Main', 'Dragon_Secondary'], targetHeight: 2.0, faceYaw: Math.PI, fly: true,
    skinnable: true, unlockLevel: 22, blurb: 'An evolved dragon — apex of the skies.', credit: QUAT_CREDIT,
  },
  // ambient-only sky birds (roam the world, not in the picker)
  {
    id: 'bird', name: 'Bird', emoji: '🐦', kind: 'gltf', url: '/models/bird.glb',
    clips: FLYER, bodyMats: [], targetHeight: 0.7, faceYaw: Math.PI, fly: true, ambient: true,
    skinnable: false, unlockLevel: 99, blurb: 'Ambient sky bird.', credit: QUAT_CREDIT,
  },
]

/** Characters shown in the playable picker (excludes ambient sky-dressing). */
export const PLAYABLE_CHARACTERS = CHARACTERS.filter((c) => !c.ambient)

export const DEFAULT_CHARACTER = 'lion'

export function characterById(id?: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]
}

export function isCharacterUnlocked(def: CharacterDef, level: number): boolean {
  return level >= def.unlockLevel
}

/** A driven vehicle (car/bike/truck/plane/heli) — faster + high-jumps the big
 *  wall. True for both procedural (kind:'vehicle') and GLB-backed (kind:'gltf'
 *  with a `vehicle` field) rides. */
export function isVehicle(def: CharacterDef): boolean {
  return !!def.vehicle
}
