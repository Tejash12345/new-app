/**
 * Autonomous NPC self-learning — OPT-IN, background, throttled.
 *
 * When (and only when) the player has enabled "NPC internet learning", citizens
 * quietly read up on topics they're curious about and file what they learn into
 * their LOCAL knowledge base. This is the automatic counterpart to the on-demand
 * lookups in the chat: no prompt per fetch (the master toggle is the consent),
 * but every fact is still labelled as web-sourced, logged as a memory, and
 * clearable. Heavily rate-limited (one fetch at a time, min gap) so it never
 * hammers the network, and a no-op offline or when the toggle is off.
 */
import { learnWebFact, saveBrain, type NpcBrain } from './npcMind'
import { neuralTokens } from './npcNeural'
import { learnLookup } from './npcCloud'
import { getPref } from './prefs'

// A broad concept pool so citizens grow real, wide-ranging knowledge — not just
// the app's focus/productivity themes, but science, nature, history and ideas.
// They also learn about whatever the player has made them curious about, and
// each fact sparks follow-up curiosity (chained learning), so the mind expands
// fast. Background learning uses only free, keyless Wikipedia (no AI quota).
const POOL = [
  // focus / productivity (fits the app)
  'focus', 'productivity', 'motivation', 'discipline', 'habit formation', 'meditation',
  'flow state', 'dopamine', 'time management', 'goal setting', 'sleep', 'exercise',
  'learning', 'memory', 'mindfulness', 'procrastination', 'self-improvement', 'creativity',
  // broad general knowledge (real concepts, "more concepts as soon as possible")
  'science', 'space exploration', 'the universe', 'physics', 'biology', 'history',
  'philosophy', 'mathematics', 'technology', 'artificial intelligence', 'the human brain',
  'psychology', 'nature', 'the ocean', 'animals', 'language', 'the internet', 'robotics',
  'energy', 'art', 'music', 'architecture', 'evolution', 'the future', 'emotions',
  'friendship', 'leadership', 'courage', 'teamwork', 'curiosity',
]

let lastFetch = 0
let inFlight = false
const MIN_GAP_MS = 18_000 // never auto-fetch more often than this (global) — fast but network-polite

function knownTopics(b: NpcBrain): Set<string> {
  return new Set(b.knowledge.map((k) => k.topic.toLowerCase()))
}

function pickTopic(b: NpcBrain): string | null {
  const known = knownTopics(b)
  // 1) self-directed: things the player asked about that it couldn't answer
  const queue = (b.wantsToLearn || []).filter((t) => t.length > 2 && !known.has(t.toLowerCase()))
  if (queue.length) return queue[0]
  // 2) otherwise a topic from its interests, then the curated pool
  const interests = Object.entries(b.interests).sort((a, c) => c[1] - a[1]).map((e) => e[0])
  const cands = [...interests, ...POOL].filter((t) => t.length > 2 && !known.has(t.toLowerCase()))
  if (!cands.length) return null
  const idx = Math.random() < 0.6 ? Math.floor(Math.random() * Math.min(4, cands.length)) : Math.floor(Math.random() * cands.length)
  return cands[idx]
}

function pickLearner(brains: NpcBrain[]): NpcBrain | null {
  if (!brains.length) return null
  const curious = brains.filter((b) => b.traits.curiosity > 0.45)
  const pool = curious.length ? curious : brains
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Try to advance one citizen's knowledge by one topic. Returns which NPC learned
 * what (so the city can show a "learned about X" bubble), or null if nothing ran.
 */
export async function autoLearnStep(brains: NpcBrain[]): Promise<{ id: string; topic: string } | null> {
  if (!getPref('npcInternet')) return null
  if (inFlight) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  const now = Date.now()
  if (now - lastFetch < MIN_GAP_MS) return null
  const brain = pickLearner(brains)
  if (!brain) return null
  const topic = pickTopic(brain)
  if (!topic) return null
  inFlight = true
  lastFetch = now
  try {
    const fact = await learnLookup(topic) // keyless web + live server-side scrape
    if (!fact) return null
    learnWebFact(brain, topic, fact.summary, fact.url) // also wires the neural model
    // it satisfied its curiosity — drop the topic from the self-directed queue
    if (brain.wantsToLearn?.length) brain.wantsToLearn = brain.wantsToLearn.filter((t) => t.toLowerCase() !== topic.toLowerCase())
    // CHAINED CURIOSITY: pull a couple of new concepts out of what it just read
    // and queue them — so one fact leads to the next and knowledge grows fast.
    const known = knownTopics(brain)
    const followups = neuralTokens(fact.summary)
      .filter((t) => t.length > 3 && !known.has(t) && t !== topic.toLowerCase() && !brain.wantsToLearn.includes(t))
    for (const f of followups.slice(0, 2)) brain.wantsToLearn.push(f)
    if (brain.wantsToLearn.length > 16) brain.wantsToLearn = brain.wantsToLearn.slice(-16)
    brain.skills['research'] = Math.round(((brain.skills['research'] || 0) + 0.5) * 100) / 100
    // learning about the built/natural world makes them better builders
    if (/build|architect|garden|forest|city|design|engineer|nature|tree|structure|house|tower/i.test(topic)) {
      brain.skills['building'] = Math.round(((brain.skills['building'] || 0) + 0.4) * 100) / 100
    }
    saveBrain(brain)
    return { id: brain.id, topic }
  } finally {
    inFlight = false
  }
}
