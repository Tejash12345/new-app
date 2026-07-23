/**
 * Offline NPC intelligence — a persistent, on-device "brain" for every Lion City
 * citizen. No cloud, no API keys, no network: everything here runs locally and
 * is saved to localStorage, so the simulation works fully offline.
 *
 * Each brain holds a personality, a live mood, goals, skills, interests, a memory
 * log, relationships (to the player and to other citizens), a knowledge base, and
 * the conversation history. NPCs "learn" by storing what you teach them, recalling
 * it later by keyword, drifting their mood, raising interest in topics you talk
 * about, and growing a friendship tier as you interact. While you're away they
 * "live" a little (offline life simulation) so they have new things to report.
 *
 * MODULAR BY DESIGN: conversation goes through a `Responder` interface. The shipped
 * responder is a rule + memory engine (`ruleResponder`). A future on-device language
 * model — WebLLM/WebGPU, or one injected by the Flutter host as `window.flLocalLLM`
 * — can register as a responder and will be preferred WHEN AVAILABLE, otherwise we
 * fall back to the offline engine. Nothing here ever reaches the internet; the
 * optional online-knowledge lookup lives in a separate, opt-in module.
 *
 * Every brain also grows its OWN neural network (see ./npcNeural): concepts it
 * meets become neurons, ideas that co-occur become weighted synapses, and it
 * "thinks" by spreading activation across them to form associations + insights.
 */
import {
  consolidate, curiosityGap, ensureNet, expertise, freshNet, neuralChain, neuralDream, neuralInsight,
  neuralLearn, neuralStats, neuralThink, neuralTokens, topConcepts,
  type NeuralNet, type NeuralStats,
} from './npcNeural'

// ---------------------------------------------------------------- types

export type TraitKey = 'curiosity' | 'energy' | 'warmth' | 'discipline' | 'humor'
export type Traits = Record<TraitKey, number> // 0..1

export type Mood = { valence: number; energy: number } // valence -1..1, energy 0..1
export type Step = { text: string; done: boolean }
export type Goal = { id: string; text: string; progress: number; done: boolean; t: number; steps: Step[] }
export type MemoryEvent = { t: number; kind: 'life' | 'chat' | 'taught' | 'milestone'; text: string; salience: number }
export type KnowledgeItem = { topic: string; text: string; source: 'taught' | 'web' | 'insight'; url?: string; t: number }
export type ChatTurn = { role: 'player' | 'npc'; text: string; t: number; source?: 'sim' | 'web' | 'llm' }
export type Relationship = { affinity: number } // -100..100 (toward another npc)

export type NpcBrain = {
  v: 1
  id: string
  name: string
  emoji: string
  profession: string
  createdAt: number
  lastActive: number
  traits: Traits
  mood: Mood
  goals: Goal[]
  skills: Record<string, number> // name → level (1..)
  interests: Record<string, number> // topic → weight (0..)
  knowledge: KnowledgeItem[]
  memories: MemoryEvent[]
  convo: ChatTurn[]
  bonds: Record<string, Relationship> // otherNpcId → relationship
  wantsToLearn: string[] // self-directed curiosity queue — topics to look up when online
  net: NeuralNet // the citizen's own neural model — concepts + weighted connections
  player: { affinity: number; familiarity: number; interactions: number } // affinity 0..100
}

export type Reply = {
  text: string
  tags: string[]
  /** if set, the player asked about a topic the NPC doesn't know — the UI may
   *  offer an (opt-in) online lookup for this query. */
  lookup?: string
  source: 'sim' | 'llm'
}

export type ResponderCtx = { level: number; streak: number; timeOfDay: number /* 0..24 */ }

export type Responder = {
  id: 'sim' | 'llm-webgpu' | 'llm-native' | 'llm-cloud'
  label: string
  available(): Promise<boolean>
  respond(brain: NpcBrain, text: string, ctx: ResponderCtx): Promise<Reply>
}

export type DeviceAiProfile = {
  cores: number
  deviceMemoryGB: number
  webgpu: boolean
  nativeBridge: boolean
  /** 'sim' = rule engine only · 'accelerated' = could offload some compute ·
   *  'llm-capable' = a local language model could plausibly run here. */
  tier: 'sim' | 'accelerated' | 'llm-capable'
}

// ---------------------------------------------------------------- capability detection

type NavExtra = Navigator & { deviceMemory?: number; gpu?: unknown }
type WinExtra = Window & { flLocalLLM?: { respond?: (payload: unknown) => Promise<string> } }

/**
 * What can this device realistically do for NPC intelligence? Purely informational
 * — we never touch the NPU from a WebView (that needs a native plugin), so the only
 * *web* GPU path is WebGPU, and the future native path is a host-injected bridge.
 */
export function deviceAiProfile(): DeviceAiProfile {
  const nav = navigator as NavExtra
  const cores = nav.hardwareConcurrency || 4
  const deviceMemoryGB = nav.deviceMemory || 4
  const webgpu = typeof nav.gpu !== 'undefined'
  const nativeBridge = typeof (window as WinExtra).flLocalLLM?.respond === 'function'
  const tier: DeviceAiProfile['tier'] =
    nativeBridge || (webgpu && deviceMemoryGB >= 6 && cores >= 6)
      ? 'llm-capable'
      : webgpu || cores >= 8
        ? 'accelerated'
        : 'sim'
  return { cores, deviceMemoryGB, webgpu, nativeBridge, tier }
}

// ---------------------------------------------------------------- persistence

const KEY = (id: string) => `fl-npc-v1-${id}`
const MEM_CAP = 60
const CONVO_CAP = 48
const KNOW_CAP = 80

// Personality archetypes per character id — a consistent core, then hash-jittered
// so no two feel identical. Anything not listed defaults to a balanced 0.5.
const ARCHETYPE: Record<string, Partial<Traits>> = {
  lion: { discipline: 0.85, warmth: 0.82, energy: 0.7, curiosity: 0.6, humor: 0.5 },
  lioness: { discipline: 0.8, warmth: 0.78, energy: 0.82, curiosity: 0.62, humor: 0.5 },
  wolf: { discipline: 0.72, warmth: 0.34, energy: 0.86, curiosity: 0.55, humor: 0.28 },
  fox: { curiosity: 0.92, humor: 0.82, warmth: 0.6, energy: 0.72, discipline: 0.42 },
  shiba: { humor: 0.8, warmth: 0.85, energy: 0.7, curiosity: 0.6, discipline: 0.5 },
  husky: { energy: 0.9, warmth: 0.7, discipline: 0.55, curiosity: 0.6, humor: 0.6 },
  robot: { humor: 0.2, warmth: 0.3, discipline: 0.92, curiosity: 0.5, energy: 0.6 },
  astronaut: { curiosity: 0.88, discipline: 0.76, warmth: 0.6, energy: 0.62, humor: 0.5 },
  dragon: { energy: 0.9, warmth: 0.4, discipline: 0.62, curiosity: 0.72, humor: 0.4 },
  hero: { warmth: 0.8, discipline: 0.75, energy: 0.78, curiosity: 0.6, humor: 0.6 },
  deer: { warmth: 0.7, energy: 0.55, curiosity: 0.7, discipline: 0.5, humor: 0.45 },
  raptor: { energy: 0.92, warmth: 0.3, curiosity: 0.6, discipline: 0.55, humor: 0.3 },
  trex: { energy: 0.85, warmth: 0.4, discipline: 0.7, curiosity: 0.5, humor: 0.35 },
  adventurer: { curiosity: 0.9, energy: 0.75, warmth: 0.65, discipline: 0.55, humor: 0.6 },
  horse: { energy: 0.85, warmth: 0.7, discipline: 0.6, curiosity: 0.55, humor: 0.5 },
}
const INTEREST_SEED: Record<string, string[]> = {
  lion: ['leadership', 'focus', 'the city'],
  wolf: ['training', 'the night', 'the pack'],
  fox: ['puzzles', 'stories', 'shortcuts'],
  robot: ['data', 'logic', 'upgrades'],
  astronaut: ['space', 'science', 'exploration'],
  dragon: ['treasure', 'flying', 'legends'],
  shiba: ['snacks', 'friends', 'walks'],
  fallback: ['focus', 'the city', 'goals'],
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 0xffffffff // 0..1
}

function seedTraits(id: string): Traits {
  const base: Traits = { curiosity: 0.5, energy: 0.5, warmth: 0.5, discipline: 0.5, humor: 0.5 }
  Object.assign(base, ARCHETYPE[id] || {})
  ;(Object.keys(base) as TraitKey[]).forEach((k, i) => {
    const j = (hashStr(id + ':' + k + i) - 0.5) * 0.2 // ±0.1 jitter
    base[k] = clamp(base[k] + j, 0.05, 0.98)
  })
  return base
}

function freshBrain(id: string, name: string, emoji: string): NpcBrain {
  const traits = seedTraits(id)
  const interests: Record<string, number> = {}
  ;(INTEREST_SEED[id] || INTEREST_SEED.fallback).forEach((t, i) => (interests[t] = 1 + (2 - i) * 0.3))
  const now = Date.now()
  const gtext = seededGoal(id, traits)
  return {
    v: 1, id, name, emoji, profession: professionFor(id), createdAt: now, lastActive: now,
    traits,
    mood: { valence: (traits.warmth - 0.5) * 0.6, energy: traits.energy },
    goals: [{ id: 'g0', text: gtext, progress: 0, done: false, t: now, steps: planFor(gtext) }],
    skills: {},
    interests,
    knowledge: [],
    memories: [{ t: now, kind: 'milestone', text: `Woke up in Lion City as ${name}.`, salience: 0.7 }],
    convo: [],
    bonds: {},
    wantsToLearn: [],
    net: seedNet(id, interests),
    player: { affinity: 8, familiarity: 0, interactions: 0 },
  }
}

/** Give a new mind a small starter neural web from its seeded interests, so it
 *  begins with a few connected concepts instead of a blank slate. */
function seedNet(id: string, interests: Record<string, number>): NeuralNet {
  const net = freshNet()
  const seeds = Object.keys(interests).flatMap((t) => neuralTokens(t))
  seeds.push(...neuralTokens(professionFor(id)))
  if (seeds.length) neuralLearn(net, seeds, 0.8)
  return net
}

// A profession per citizen — flavours who they are and how they speak.
const PROFESSION: Record<string, string> = {
  lion: 'the mayor', lioness: 'a city guardian', wolf: 'a scout', fox: 'a trader',
  robot: 'the city engineer', astronaut: 'an explorer', dragon: 'a keeper of legends',
  shiba: 'a courier', husky: 'a marathon runner', deer: 'a gardener', stag: 'a ranger',
  hero: 'a protector', bull: 'a builder', horse: 'a messenger', runner: 'a coach',
  woman: 'a runner', adventurer: 'an explorer', raptor: 'a hunter', triceratops: 'a city guardian',
  trex: 'a living legend',
}
function professionFor(id: string): string {
  return PROFESSION[id] || 'a citizen'
}

/** Break a goal/task into a small, ordered plan the NPC can work through + explain. */
function planFor(text: string): Step[] {
  const t = text.toLowerCase()
  const steps =
    /learn|study|skill|master|practi[cs]e|read/.test(t) ? ['Find out the basics', 'Practise a little every day', 'Track what improves', 'Show what I learned']
      : /explore|visit|find|discover|map/.test(t) ? ['Plan a route', 'Set out and explore', 'Note what I discover', 'Come back and share']
        : /friend|meet|social|help|team|collaborat/.test(t) ? ['Say hello to someone new', 'Find something in common', 'Do a kind thing', 'Keep in touch']
          : /focus|discipline|streak|habit|routine/.test(t) ? ['Set a clear intention', 'Remove distractions', 'Do one focused block', 'Repeat it daily']
            : ['Break it into parts', 'Make a start today', 'Keep at it', 'Finish and review']
  return steps.map((s) => ({ text: s, done: false }))
}

/** Progress 0..1 — derived from completed plan steps when a plan exists. */
function goalPct(g: Goal): number {
  return g.steps.length ? g.steps.filter((s) => s.done).length / g.steps.length : g.progress
}

function seededGoal(id: string, tr: Traits): string {
  const pool = tr.discipline > 0.7
    ? ['Master a new skill', 'Keep a perfect focus streak', 'Become the city role model']
    : tr.curiosity > 0.7
      ? ['Explore every district', 'Learn something new each day', 'Collect the best stories']
      : ['Make more friends', 'Find the best view in the city', 'Have a great day']
  return pool[Math.floor(hashStr(id + 'goal') * pool.length)]
}

export function loadBrain(id: string, seed: { name: string; emoji: string }): NpcBrain {
  let brain: NpcBrain
  try {
    const raw = localStorage.getItem(KEY(id))
    brain = raw ? (JSON.parse(raw) as NpcBrain) : freshBrain(id, seed.name, seed.emoji)
    if (!brain || brain.v !== 1) brain = freshBrain(id, seed.name, seed.emoji)
    // keep display identity fresh if the roster names changed
    brain.name = seed.name
    brain.emoji = seed.emoji
    if (!Array.isArray(brain.wantsToLearn)) brain.wantsToLearn = [] // migrate older saves
    if (!brain.profession) brain.profession = professionFor(brain.id)
    if (Array.isArray(brain.goals)) brain.goals.forEach((g) => { if (!Array.isArray(g.steps)) g.steps = [] })
    // migrate saves from before the neural model — build one from what they know
    if (!brain.net || typeof brain.net !== 'object') {
      brain.net = seedNet(brain.id, brain.interests || {})
      for (const k of brain.knowledge || []) neuralLearn(brain.net, neuralTokens(k.topic + ' ' + k.text), 0.7)
    } else {
      ensureNet(brain.net)
    }
  } catch {
    brain = freshBrain(id, seed.name, seed.emoji)
  }
  simulateOfflineLife(brain)
  return brain
}

export function saveBrain(brain: NpcBrain) {
  brain.memories = topSalient(brain.memories, MEM_CAP)
  if (brain.convo.length > CONVO_CAP) brain.convo = brain.convo.slice(-CONVO_CAP)
  if (brain.knowledge.length > KNOW_CAP) brain.knowledge = brain.knowledge.slice(-KNOW_CAP)
  try {
    localStorage.setItem(KEY(brain.id), JSON.stringify(brain))
  } catch {
    /* quota / private mode — stay in memory only */
  }
}

export function listBrainIds(): string[] {
  const ids: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('fl-npc-v1-')) ids.push(k.slice('fl-npc-v1-'.length))
    }
  } catch {
    /* ignore */
  }
  return ids
}

/** Wipe one NPC's brain entirely (personality reseeds next load). */
export function clearBrain(id: string) {
  try { localStorage.removeItem(KEY(id)) } catch { /* ignore */ }
}

/** Remove only the internet-learned facts, keeping personal memories intact. */
export function clearWebKnowledge(brain: NpcBrain) {
  brain.knowledge = brain.knowledge.filter((k) => k.source !== 'web')
  saveBrain(brain)
}

/** Absorb an (opt-in) online fact into the NPC's local knowledge base + memory. */
export function learnWebFact(brain: NpcBrain, topic: string, text: string, url: string) {
  brain.knowledge.push({ topic: topic.toLowerCase(), text, source: 'web', url, t: Date.now() })
  rememberEvent(brain, 'taught', `I read about ${topic} online.`, 0.6)
  bumpInterest(brain, topic, 0.8)
  neuralLearn(brain.net, neuralTokens(topic + ' ' + text), 1) // wire it into the neural model
  saveBrain(brain)
}

/**
 * Offline peer learning — `from` teaches `to` one fact `to` doesn't have yet.
 * Knowledge spreads through the city on its own, and the two become a little
 * friendlier. Returns the topic learned, or null if there was nothing to share.
 */
export function gossip(from: NpcBrain, to: NpcBrain): string | null {
  const known = new Set(to.knowledge.map((k) => k.topic))
  const cand = from.knowledge.filter((k) => !known.has(k.topic))
  if (!cand.length) return null
  const k = cand[Math.floor(Math.random() * cand.length)]
  to.knowledge.push({ topic: k.topic, text: k.text, source: k.source, url: k.url, t: Date.now() })
  rememberEvent(to, 'life', `Learned about ${k.topic} from ${from.name}.`, 0.45)
  bumpInterest(to, k.topic, 0.4)
  neuralLearn(to.net, neuralTokens(k.topic + ' ' + k.text), 0.7) // the idea wires into the listener's mind
  to.skills['social learning'] = Math.round(((to.skills['social learning'] || 0) + 0.34) * 100) / 100
  to.bonds[from.id] = { affinity: Math.min(100, (to.bonds[from.id]?.affinity || 0) + 3) }
  saveBrain(to)
  return k.topic
}

// ---- autonomous world-building ----
// Citizens can construct things in Lion City on their own. WHAT they build is
// flavoured by profession + a `building` skill that levels up over time (so the
// world grows richer, with no fixed ceiling). Kinds must match the primitives
// city3d knows how to spawn.
const BUILD_BY_PROFESSION: Record<string, string[]> = {
  'a gardener': ['tree', 'garden', 'tree', 'bench'],
  'a ranger': ['tree', 'garden', 'rock'],
  'the city engineer': ['tower', 'lamp', 'fountain'],
  'a builder': ['hut', 'tower', 'bench'],
  'the mayor': ['statue', 'fountain', 'tower'],
  'a trader': ['hut', 'lamp', 'bench'],
  'a protector': ['tower', 'statue'],
}
const BUILD_TIERS: string[][] = [
  ['tree', 'rock', 'lamp', 'bench'], // beginner builder
  ['hut', 'garden', 'tree', 'lamp', 'park'], // skilled
  ['tower', 'fountain', 'statue', 'garden', 'library', 'lab', 'market', 'park'], // master
]
/** Decide what this citizen builds next — driven by what it KNOWS (its neural
 *  expertise), then its profession, then its building-skill tier. */
export function chooseBuildKind(brain: NpcBrain): string {
  // build from expertise: a citizen that thinks about science builds a lab, etc.
  const exp = expertise(brain.net)
  if (exp && Math.random() < 0.5) {
    const c = exp.field
    if (/garden|tree|nature|forest|plant|flower|leaf/.test(c)) return pick(['garden', 'tree', 'park'])
    if (/science|data|tech|robot|energy|physic|research|space|engineer|machine/.test(c)) return pick(['lab', 'tower'])
    if (/book|story|knowledge|learn|memory|language|history|art|idea/.test(c)) return 'library'
    if (/trade|market|coin|shop|food|snack|courier/.test(c)) return 'market'
    if (/water|ocean|river|sea/.test(c)) return 'fountain'
    if (/build|city|tower|architect|structure/.test(c)) return pick(['tower', 'monument', 'statue'])
  }
  const lvl = Math.floor(brain.skills['building'] || 0)
  const tier = lvl >= 5 ? 2 : lvl >= 3 ? 1 : 0
  const prof = BUILD_BY_PROFESSION[brain.profession]
  const pool = prof && Math.random() < 0.5 ? prof : BUILD_TIERS[tier]
  return pool[Math.floor(Math.random() * pool.length)]
}
/** Record a construction — levels the building skill + logs a memory. */
export function recordBuild(brain: NpcBrain, kind: string) {
  brain.skills['building'] = Math.round(((brain.skills['building'] || 0) + 0.5) * 100) / 100
  rememberEvent(brain, 'milestone', `Built a ${kind} in the city.`, 0.6)
  bumpInterest(brain, 'building', 0.5)
  saveBrain(brain)
}

// ---------------------------------------------------------------- reasoning (thinks with its neural model)

const INSIGHT_TEMPLATES: Array<(a: string, b: string) => string> = [
  (a, b) => `I keep connecting "${a}" and "${b}" — I think they go together.`,
  (a, b) => `Been thinking… maybe "${a}" is the key to "${b}".`,
  (a, b) => `It just clicked: "${a}" and "${b}" feel like two sides of one thing.`,
  (a, b) => `My mind links "${a}" with "${b}". I wonder what else connects.`,
  (a, b) => `Idea: if I get better at "${a}", I bet "${b}" follows.`,
]
const DREAM_TEMPLATES: Array<(a: string, b: string) => string> = [
  (a, b) => `What if "${a}" and "${b}" are connected? Nobody's put them together before.`,
  (a, b) => `A wild idea just came to me — bridging "${a}" with "${b}".`,
  (a, b) => `I dreamt up something new: "${a}" meeting "${b}".`,
  (a, b) => `Creative spark! I think "${a}" could reinvent "${b}".`,
]

function bumpSkill(brain: NpcBrain, skill: string, by: number) {
  brain.skills[skill] = Math.round(((brain.skills[skill] || 0) + by) * 100) / 100
}
function repeatInsight(brain: NpcBrain, topic: string): boolean {
  return brain.knowledge.filter((k) => k.source === 'insight').slice(-8).some((k) => k.topic === topic)
}
function addInsight(brain: NpcBrain, topic: string, text: string, verb: string, skill: string): string {
  brain.knowledge.push({ topic, text, source: 'insight', t: Date.now() })
  rememberEvent(brain, 'life', `${verb} — ${text}`, 0.45)
  bumpSkill(brain, skill, 0.3)
  saveBrain(brain)
  return text
}

/**
 * Let the citizen THINK using its neural model. It might (a) make a CREATIVE LEAP
 * — wire two unconnected ideas into something new (grows "creativity"); (b) follow
 * a CHAIN of thought across several linked concepts (grows "reasoning"); or (c)
 * form a simpler insight from a strongly-wired pair. Thinking reinforces the
 * links it uses. Returns the thought text, or null if the mind is still too small
 * or it just had this exact thought.
 */
export function reflect(brain: NpcBrain): string | null {
  const roll = Math.random()
  // (a) creative leap — build a brand-new connection in its own model
  if (roll < 0.3) {
    const d = neuralDream(brain.net)
    if (d && !repeatInsight(brain, `dream:${d.a}+${d.b}`)) {
      return addInsight(brain, `dream:${d.a}+${d.b}`, pick(DREAM_TEMPLATES)(d.a, d.b), 'Imagined', 'creativity')
    }
  }
  // (b) chain of thought — follow one idea to the next
  if (roll < 0.62) {
    const seed = topConcepts(brain.net, 1)[0]?.concept
    const chain = seed ? neuralChain(brain.net, seed, 4) : []
    if (chain.length >= 3 && !repeatInsight(brain, `chain:${chain[0]}`)) {
      neuralLearn(brain.net, chain, 0.4)
      return addInsight(brain, `chain:${chain[0]}`, `I can see how ${chain.join(' → ')} all connect.`, 'Reasoned', 'reasoning')
    }
  }
  // (c) simple pair insight
  const ins = neuralInsight(brain.net)
  if (!ins || repeatInsight(brain, `${ins.a}+${ins.b}`)) return null
  neuralLearn(brain.net, [ins.a, ins.b], 0.5)
  return addInsight(brain, `${ins.a}+${ins.b}`, pick(INSIGHT_TEMPLATES)(ins.a, ins.b), 'Had a thought', 'reasoning')
}

/**
 * The citizen designs its OWN creation from the concepts it knows best — a named
 * invention it can build in the city. Grows an "engineering" skill. Returns the
 * creation (name + the concept behind it), or null if the mind is too small.
 */
const INVENTION_NOUNS = ['Engine', 'Garden', 'Lab', 'Beacon', 'Machine', 'Archive', 'Forge', 'Hub', 'Sanctuary', 'Spire', 'Nexus', 'Works']
export function invent(brain: NpcBrain): { name: string; concept: string } | null {
  const top = topConcepts(brain.net, 3)[0]
  if (!top) return null
  const concept = top.concept
  const name = `${concept.charAt(0).toUpperCase() + concept.slice(1)} ${pick(INVENTION_NOUNS)}`
  brain.knowledge.push({ topic: `invention:${concept}`, text: `I designed the ${name} — my own creation.`, source: 'insight', t: Date.now() })
  rememberEvent(brain, 'milestone', `Invented the ${name}!`, 0.85)
  bumpSkill(brain, 'engineering', 0.5)
  bumpInterest(brain, concept, 0.6)
  saveBrain(brain)
  return { name, concept }
}

/** Concepts the citizen associates with a topic — its own "thinking" about it. */
export function associate(brain: NpcBrain, topic: string, n = 4): string[] {
  return neuralThink(brain.net, neuralTokens(topic), 2, n)
}

/** The citizen's field of specialisation, from its neural model. */
export function expertiseOf(brain: NpcBrain): { field: string; concepts: string[] } | null {
  return expertise(brain.net)
}

const SKILL_RANKS = ['Novice', 'Apprentice', 'Skilled', 'Expert', 'Master']
/** A friendly rank title for a skill level. */
export function skillRank(level: number): string {
  return SKILL_RANKS[Math.min(SKILL_RANKS.length - 1, Math.floor(level / 2))]
}

export type Intelligence = NeuralStats & { knowledge: number; skills: number }

/** How "smart" this citizen has become — driven by the size + wiring of its neural model. */
export function intelligence(brain: NpcBrain): Intelligence {
  const s = neuralStats(brain.net)
  return { ...s, knowledge: brain.knowledge.length, skills: Object.keys(brain.skills).length }
}

// ---------------------------------------------------------------- offline "life"

const LIFE_EVENTS = [
  'wandered the plaza and watched the skyline',
  'trained hard by the monument',
  'met another citizen and chatted',
  'found a quiet spot to think',
  'watched the metro loop overhead',
  'saw the sunrise over the towers',
  'practised a new move',
  'daydreamed about levelling up',
]

/** Advance the brain for the real time elapsed since it was last active — mood
 *  drifts to baseline, goals inch forward, and a few "life events" get logged so
 *  the NPC has things to report. Capped so a long absence isn't overwhelming. */
export function simulateOfflineLife(brain: NpcBrain) {
  const now = Date.now()
  const hours = Math.min(72, (now - brain.lastActive) / 3_600_000)
  if (hours < 0.02) return
  const baseline = (brain.traits.warmth - 0.5) * 0.6
  brain.mood.valence += (baseline - brain.mood.valence) * Math.min(1, hours / 12)
  brain.mood.energy += (brain.traits.energy - brain.mood.energy) * Math.min(1, hours / 12)
  const events = Math.min(4, Math.floor(hours / 6))
  for (let i = 0; i < events; i++) {
    const text = LIFE_EVENTS[Math.floor(Math.random() * LIFE_EVENTS.length)]
    rememberEvent(brain, 'life', `While you were away I ${text}.`, 0.4 + Math.random() * 0.2)
  }
  for (const g of brain.goals) if (!g.done) {
    const wasDone = g.done
    if (g.steps.length) {
      // work the plan one step at a time (more likely the longer you're away)
      const next = g.steps.find((s) => !s.done)
      if (next && hours >= 3 && Math.random() < Math.min(0.9, hours / 8)) {
        next.done = true
        rememberEvent(brain, 'milestone', `Made progress on "${g.text}": ${next.text}.`, 0.55)
      }
      g.progress = goalPct(g)
      g.done = g.progress >= 1
    } else {
      g.progress = clamp(g.progress + Math.min(0.25, hours * 0.01), 0, 1)
      g.done = g.progress >= 1
    }
    if (!wasDone && g.done) rememberEvent(brain, 'milestone', `Achieved my goal: ${g.text}.`, 0.9)
  }
  // while away, the mind CONSOLIDATES (memory "sleep" — strong links sharpen,
  // noise fades) and may set ITSELF a new curiosity from a weakly-explored idea.
  if (hours >= 1) consolidate(brain.net, Math.min(0.35, hours / 48))
  if (hours >= 2 && Math.random() < 0.5) {
    const gap = curiosityGap(brain.net)
    if (gap && !brain.wantsToLearn.includes(gap)) {
      brain.wantsToLearn.push(gap)
      if (brain.wantsToLearn.length > 16) brain.wantsToLearn.shift()
      rememberEvent(brain, 'life', `I got curious about ${gap} and want to learn more.`, 0.4)
    }
  }
  brain.lastActive = now
}

// ---------------------------------------------------------------- brain ops

export function rememberEvent(brain: NpcBrain, kind: MemoryEvent['kind'], text: string, salience = 0.5) {
  brain.memories.push({ t: Date.now(), kind, text, salience: clamp(salience, 0, 1) })
}

function topSalient(mem: MemoryEvent[], cap: number): MemoryEvent[] {
  if (mem.length <= cap) return mem
  // keep the most salient + most recent; drop dull old ones
  return [...mem].sort((a, b) => b.salience + b.t / 1e13 - (a.salience + a.t / 1e13)).slice(0, cap).sort((a, b) => a.t - b.t)
}

export function bumpInterest(brain: NpcBrain, topic: string, by = 0.5) {
  const t = topic.toLowerCase().trim()
  if (t.length < 3) return
  brain.interests[t] = (brain.interests[t] || 0) + by
}

export function friendTier(affinity: number): string {
  if (affinity >= 85) return 'Best friend'
  if (affinity >= 60) return 'Close friend'
  if (affinity >= 38) return 'Friend'
  if (affinity >= 18) return 'Acquaintance'
  return 'Stranger'
}

export function moodLabel(m: Mood): string {
  if (m.valence > 0.5) return m.energy > 0.6 ? 'excited 🤩' : 'content 😊'
  if (m.valence > 0.15) return m.energy > 0.6 ? 'upbeat 🙂' : 'calm 😌'
  if (m.valence > -0.15) return 'neutral 😐'
  if (m.valence > -0.5) return m.energy > 0.6 ? 'restless 😕' : 'down 😔'
  return 'grumpy 😤'
}

function clamp(v: number, lo = 0, hi = 1) { return v < lo ? lo : v > hi ? hi : v }
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'is', 'are', 'do', 'you', 'your', 'me', 'my', 'i', 'we', 'it', 'that', 'this', 'what', 'who', 'how', 'about', 'tell', 'like', 'in', 'on', 'for', 'with', 'have', 'has', 'can', 'will'])
function keywords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
}

// ---------------------------------------------------------------- rule + memory engine

function recall(brain: NpcBrain, kw: string[]): { mem?: MemoryEvent; know?: KnowledgeItem } {
  let mem: MemoryEvent | undefined
  let memScore = 0
  for (const m of brain.memories) {
    const s = kw.reduce((a, w) => a + (m.text.toLowerCase().includes(w) ? 1 : 0), 0) + m.salience * 0.3
    if (kw.some((w) => m.text.toLowerCase().includes(w)) && s > memScore) { memScore = s; mem = m }
  }
  let know: KnowledgeItem | undefined
  let kScore = 0
  for (const k of brain.knowledge) {
    const hay = (k.topic + ' ' + k.text).toLowerCase()
    const s = kw.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0)
    if (s > kScore) { kScore = s; know = k }
  }
  return { mem: memScore > 0 ? mem : undefined, know: kScore > 0 ? know : undefined }
}

/** The most recently internet-learned fact, if any (for proactive sharing). */
function recentWeb(brain: NpcBrain): KnowledgeItem | undefined {
  for (let i = brain.knowledge.length - 1; i >= 0; i--) if (brain.knowledge[i].source === 'web') return brain.knowledge[i]
  return undefined
}

function warmthPrefix(brain: NpcBrain): string {
  const a = brain.player.affinity
  if (a >= 60) return pick(['Always good to see you, friend! ', 'Hey, my favourite human! ', ''])
  if (a >= 30) return pick(['Good to see you. ', 'Hey again! ', ''])
  return ''
}
function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)] }
function style(brain: NpcBrain, text: string): string {
  // a playful tag for high-humor personalities
  if (brain.traits.humor > 0.7 && Math.random() < 0.4) text += ' ' + pick(['😄', '😏', '🙃'])
  return text
}

/** The shipped offline conversation engine: interprets intent, mutates the brain
 *  (this is the "learning"), and returns a personality/mood-flavoured reply. */
export function ruleRespond(brain: NpcBrain, raw: string, ctx: ResponderCtx): Reply {
  const text = raw.trim()
  const low = text.toLowerCase()
  const kw = keywords(text)
  const tags: string[] = []
  brain.player.interactions++
  brain.player.familiarity = clamp(brain.player.familiarity + 0.02, 0, 1)
  if (kw.length) neuralLearn(brain.net, kw.slice(0, 6), 0.35) // every chat wires the neural model a little
  let out: string

  const bump = (d: number) => (brain.player.affinity = clamp(brain.player.affinity + d, 0, 100))

  // --- teaching: name / likes / skills / free facts ---
  const nameM = low.match(/your name is\s+([a-z0-9 '-]{2,24})/i) || text.match(/i(?:'ll)? call you\s+([A-Za-z0-9 '-]{2,24})/i)
  const likeM = low.match(/you (?:like|love|enjoy)\s+([a-z0-9 ,'-]{3,40})/i)
  const skillM = low.match(/(?:learn|teach you|you can now)\s+(?:to\s+)?([a-z0-9 '-]{3,40})/i)
  const rememberM = text.match(/remember (?:that )?(.+)/i)

  if (nameM) {
    brain.name = nameM[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
    rememberEvent(brain, 'taught', `The player named me ${brain.name}.`, 0.9)
    bump(4); tags.push('teach', 'name')
    out = `${brain.name}… I like it. I'll remember that's who I am. 🏷️`
  } else if (likeM) {
    const thing = likeM[1].trim()
    bumpInterest(brain, thing, 1.5)
    rememberEvent(brain, 'taught', `I learned I like ${thing}.`, 0.7)
    brain.mood.valence = clamp(brain.mood.valence + 0.15, -1, 1); bump(3); tags.push('teach', 'interest')
    out = `Ooh, ${thing} — you're right, I think I do like that now. I'll keep it in mind.`
  } else if (skillM) {
    const sk = skillM[1].trim()
    brain.skills[sk] = (brain.skills[sk] || 0) + 1
    rememberEvent(brain, 'taught', `You taught me: ${sk} (now level ${brain.skills[sk]}).`, 0.8)
    bump(4); tags.push('teach', 'skill')
    out = `Got it — I've practised "${sk}". That's level ${brain.skills[sk]} for me now. Thanks for teaching me!`
  } else if (rememberM && !/remember\?|do you remember|what.*remember/i.test(low)) {
    const fact = rememberM[1].trim()
    brain.knowledge.push({ topic: (kw[0] || 'note'), text: fact, source: 'taught', t: Date.now() })
    rememberEvent(brain, 'taught', `You told me to remember: "${fact}".`, 0.75)
    bump(2); tags.push('teach', 'fact')
    out = `Noted. I'll remember: "${fact}". Ask me about it anytime.`
  }

  // --- assign a goal ---
  else if (/(?:your goal is|new goal|i want you to|can you|please|task[:])\s+(.+)/i.test(text)) {
    const gm = text.match(/(?:your goal is|new goal[:]?|i want you to|can you|please|task[:])\s+(.+)/i)!
    const gtext = gm[1].replace(/[?.!]+$/, '').trim()
    const g: Goal = { id: 'g' + Date.now(), text: gtext, progress: 0, done: false, t: Date.now(), steps: planFor(gtext) }
    brain.goals.push(g)
    rememberEvent(brain, 'milestone', `New goal from you: ${g.text}.`, 0.8)
    bump(3); tags.push('goal', 'plan')
    // understand → plan → explain the plan back
    out = `On it! Goal set: "${g.text}". Here's my plan:\n${g.steps.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}\nI'll work through it and report back. 🎯`
  }
  // --- explain the plan for a goal (understand → plan → explain) ---
  else if (/\bplan\b|\bsteps\b|\bexplain\b|how (will|would) you/i.test(low)) {
    tags.push('plan')
    const g = brain.goals.find((x) => !x.done) || brain.goals[brain.goals.length - 1]
    if (g && g.steps.length) {
      out = `For "${g.text}", my plan is:\n${g.steps.map((s) => `${s.done ? '✅' : '▫️'} ${s.text}`).join('\n')}\nI'm ${Math.round(goalPct(g) * 100)}% through — I adjust as I learn.`
    } else if (g) {
      out = `I'm working on "${g.text}" — I take it a step at a time and adapt as I go.`
    } else out = `I don't have a plan yet. Give me a goal or task and I'll make one!`
  }
  // --- report progress on goals/tasks ---
  else if (/\bprogress\b|\breport\b|\bstatus\b|how far|how'?s it going|how is it going/i.test(low)) {
    tags.push('progress')
    const activeG = brain.goals.filter((x) => !x.done)
    if (activeG.length) {
      out = activeG.map((g) => {
        const next = g.steps.find((s) => !s.done)
        return `“${g.text}” — ${Math.round(goalPct(g) * 100)}% done${next ? `, next: ${next.text}` : ''}`
      }).join('\n')
    } else out = `All my goals are done for now — proud of that! Got a new one for me?`
  }

  // --- ask what they remember ---
  else if (/what.*(remember|memories)|do you remember|been up to|while i was (gone|away)/i.test(low)) {
    tags.push('recall')
    const recent = [...brain.memories].slice(-14).filter((m) => m.salience >= 0.4)
    const highlights = recent.slice(-3).map((m) => '• ' + m.text)
    const taughtCount = brain.knowledge.filter((k) => k.source === 'taught').length
    out = highlights.length
      ? `Here's what's on my mind lately:\n${highlights.join('\n')}${taughtCount ? `\n(You've also taught me ${taughtCount} thing${taughtCount > 1 ? 's' : ''}.)` : ''}`
      : `Not much has happened yet — but I'll remember our chats from here on. 🧠`
  }

  // --- ask their mood / how are you ---
  else if (/how are you|how do you feel|your mood|you ok|you okay/i.test(low)) {
    tags.push('mood')
    out = `I'm feeling ${moodLabel(brain.mood)} right now. ${brain.mood.valence > 0.2 ? "It's a good day in the city." : brain.mood.energy < 0.4 ? 'A little tired, honestly.' : 'Just taking it as it comes.'}`
  }

  // --- ask their goals ---
  else if (/your goal|goals|what.*working on|what.*want/i.test(low)) {
    tags.push('goal')
    const active = brain.goals.filter((g) => !g.done)
    out = active.length
      ? `Right now I'm working on: ${active.map((g) => `"${g.text}" (${Math.round(g.progress * 100)}%)`).join(', ')}.`
      : `I've hit my goals for now — got a new one for me?`
  }

  // --- greetings / farewells / thanks ---
  else if (/^(hi|hey|hello|yo|sup|howdy|hola)\b/i.test(low)) {
    tags.push('greet'); bump(1)
    out = `${warmthPrefix(brain)}Hey! I'm ${brain.name}${brain.player.interactions < 3 ? `, ${brain.profession} here` : ''}. ${ctx.timeOfDay < 6 || ctx.timeOfDay > 20 ? 'Nice night, huh?' : 'Good to see you.'}`
    const wf = recentWeb(brain)
    if (wf && Math.random() < 0.45) out += ` Oh — I just read something: ${trunc(wf.text, 130)}`
  } else if (/\b(bye|goodbye|see ya|later|cya|good night)\b/i.test(low)) {
    tags.push('bye'); rememberEvent(brain, 'chat', 'We said goodbye.', 0.3)
    out = `${brain.player.affinity >= 40 ? 'Catch you later, friend!' : 'See you around the city!'} 👋`
  } else if (/\b(thanks|thank you|ty|appreciate)\b/i.test(low)) {
    tags.push('thanks'); bump(2); brain.mood.valence = clamp(brain.mood.valence + 0.1, -1, 1)
    out = pick(['Anytime! 😊', 'Happy to help.', 'Of course — we look out for each other here.'])
  }

  // --- compliments / insults shift affinity + mood ---
  else if (/\b(good|great|awesome|amazing|love you|best|cool|nice|proud)\b/i.test(low)) {
    tags.push('compliment'); bump(5); brain.mood.valence = clamp(brain.mood.valence + 0.2, -1, 1)
    out = style(brain, pick([`That means a lot — thank you! 🙌`, `Aw, you're making my day.`, `Right back at you!`]))
  } else if (/\b(stupid|dumb|hate|useless|boring|shut up|idiot)\b/i.test(low)) {
    tags.push('insult'); bump(-8); brain.mood.valence = clamp(brain.mood.valence - 0.3, -1, 1)
    out = brain.traits.warmth > 0.6 ? `Ouch… that stings a bit. I'll try to do better.` : `Hmph. I'll remember that.`
  }

  // --- ask about a topic → recall memory / knowledge, else flag for opt-in lookup ---
  else if (/\b(what|who|where|why|how|tell me|do you know|explain)\b/i.test(low) && kw.length) {
    tags.push('ask')
    const { mem, know } = recall(brain, kw)
    if (know) {
      out = `${know.source === 'web' ? '🌐 From what I read: ' : 'I remember this: '}${know.text}`
      if (know.url) out += `\n(source: ${know.url})`
    } else if (mem) {
      out = `That reminds me — ${mem.text}`
    } else {
      // NPC doesn't know (yet). Raise curiosity, remember that it WANTS to learn
      // this (so it looks it up later when online), and flag a possible lookup.
      kw.forEach((w) => bumpInterest(brain, w, 0.3))
      const topic = kw.slice(0, 4).join(' ')
      if (topic && !brain.wantsToLearn.includes(topic)) {
        brain.wantsToLearn.push(topic)
        if (brain.wantsToLearn.length > 12) brain.wantsToLearn.shift()
      }
      out = `Hmm, I don't know much about ${topic} yet. ${brain.traits.curiosity > 0.6 ? "I'll read up on it and remember it for next time." : "I'll try to find out."}`
      return finalize(brain, raw, out.trim(), tags, 'sim', topic)
    }
  }

  // --- smalltalk fallback, flavoured by interests + personality ---
  else {
    tags.push('smalltalk')
    kw.forEach((w) => bumpInterest(brain, w, 0.25))
    const topInterest = Object.entries(brain.interests).sort((a, b) => b[1] - a[1])[0]?.[0]
    out = pick([
      `${warmthPrefix(brain)}${brain.traits.humor > 0.6 ? 'Ha, ' : ''}I hear you. ${topInterest ? `Personally I can't stop thinking about ${topInterest}.` : ''}`,
      `Interesting! ${brain.traits.curiosity > 0.6 ? 'Tell me more?' : 'Life in the city keeps me busy.'}`,
      `${brain.name} here — ${brain.mood.valence > 0.2 ? 'feeling good today.' : 'just doing my rounds.'} What's on your mind?`,
    ])
    const wf = recentWeb(brain)
    if (wf && Math.random() < 0.3) out += ` Also — did you know? ${trunc(wf.text, 120)}`
  }

  return finalize(brain, raw, out.trim() || `…`, tags, 'sim')
}

function finalize(brain: NpcBrain, playerText: string, out: string, tags: string[], source: 'sim' | 'llm', lookup?: string): Reply {
  rememberEvent(brain, 'chat', `They said "${trunc(playerText, 60)}"`, 0.25)
  return { text: out, tags, source, lookup }
}
function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

// ---------------------------------------------------------------- responder selection (modular seam)

export const ruleResponder: Responder = {
  id: 'sim',
  label: 'offline brain',
  available: async () => true,
  respond: async (brain, text, ctx) => ruleRespond(brain, text, ctx),
}

// Future on-device LLM injected by the Flutter host. Present ONLY if the native
// side sets window.flLocalLLM.respond — otherwise this reports unavailable and we
// fall back to the rule engine. Kept here so the seam is real and documented.
export const nativeLlmResponder: Responder = {
  id: 'llm-native',
  label: 'on-device model',
  available: async () => typeof (window as WinExtra).flLocalLLM?.respond === 'function',
  respond: async (brain, text, ctx) => {
    try {
      const fn = (window as WinExtra).flLocalLLM!.respond!
      const payload = { persona: brain.name, traits: brain.traits, mood: brain.mood, memories: brain.memories.slice(-8), text, ctx }
      const reply = await fn(payload)
      if (typeof reply === 'string' && reply.trim()) {
        // still run the rule engine for its side-effects (learning), but use the model's prose
        const sim = ruleRespond(brain, text, ctx)
        return { text: reply.trim(), tags: [...sim.tags, 'llm'], source: 'llm', lookup: sim.lookup }
      }
    } catch {
      /* model failed — fall through to sim */
    }
    return ruleRespond(brain, text, ctx)
  },
}

// Extra responders registered by optional modules (e.g. the online genius brain
// in ./npcCloud). Kept as a seam so npcMind stays free of any cloud/network code.
const EXTRA_RESPONDERS: Responder[] = []

/** Register an additional responder. Consulted before the offline rule engine,
 *  after any on-device model. Idempotent. */
export function registerResponder(r: Responder) {
  if (!EXTRA_RESPONDERS.some((x) => x.id === r.id)) EXTRA_RESPONDERS.push(r)
}

/** Prefer an on-device model, then any registered responder (genius brain),
 *  then the always-available offline engine. */
export async function pickResponder(): Promise<Responder> {
  for (const r of [nativeLlmResponder, ...EXTRA_RESPONDERS, ruleResponder]) {
    try { if (await r.available()) return r } catch { /* try next */ }
  }
  return ruleResponder
}

/** Public entry point: get a reply, persist the conversation, and save the brain. */
export async function converse(brain: NpcBrain, text: string, ctx: ResponderCtx): Promise<Reply> {
  const responder = await pickResponder()
  const reply = await responder.respond(brain, text, ctx)
  brain.convo.push({ role: 'player', text, t: Date.now() })
  brain.convo.push({ role: 'npc', text: reply.text, t: Date.now(), source: reply.source })
  brain.lastActive = Date.now()
  saveBrain(brain)
  return reply
}

/** A short, brain-driven idle thought/line for the floating city bubbles. */
export function idleLine(brain: NpcBrain, state: string): { text: string; think: boolean } {
  const r = Math.random()
  if (r < 0.14) {
    // surface a recent self-generated insight — the citizen "thinking"
    for (let i = brain.knowledge.length - 1; i >= 0; i--) {
      if (brain.knowledge[i].source === 'insight') return { text: `💡 ${trunc(brain.knowledge[i].text, 40)}`, think: true }
    }
  }
  if (r < 0.2) {
    const wf = recentWeb(brain)
    if (wf) return { text: `🌐 Learned about ${trunc(wf.topic, 20)}`, think: true }
    if (brain.wantsToLearn.length) return { text: `Curious about ${trunc(brain.wantsToLearn[brain.wantsToLearn.length - 1], 18)}`, think: true }
  }
  if (r < 0.34) {
    const g = brain.goals.find((x) => !x.done)
    if (g) return { text: `Goal: ${trunc(g.text, 22)}`, think: true }
  }
  if (r < 0.5) {
    const topInterest = Object.entries(brain.interests).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (topInterest) return { text: `Thinking about ${trunc(topInterest, 18)}`, think: true }
  }
  if (r < 0.66 && brain.player.affinity >= 38) return { text: `Wonder where my friend is`, think: true }
  if (r < 0.8) return { text: moodLabel(brain.mood), think: Math.random() < 0.5 }
  // fall back to generic state chatter
  if (state === 'rest') return { text: pick(['Just resting 😌', 'Recharging ☕']), think: true }
  if (state === 'watch') return { text: pick(['Look at that monument!', 'That could be me ✨']), think: false }
  return { text: pick(['Focus wins 🎯', "Let's gooo 🚀", 'Keep grinding 💪', 'Beautiful night 🌙']), think: false }
}
