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

export type CharacterKind = 'procedural' | 'gltf'

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
    clips: HUMAN, bodyMats: [], targetHeight: 1.85, faceYaw: Math.PI,
    skinnable: false, unlockLevel: 7, blurb: 'A human sprinter — full biped run cycle.', credit: QUAT_CREDIT,
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
]

export const DEFAULT_CHARACTER = 'lion'

export function characterById(id?: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]
}

export function isCharacterUnlocked(def: CharacterDef, level: number): boolean {
  return level >= def.unlockLevel
}
